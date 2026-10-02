from dotenv import load_dotenv
import os
import httpx
import asyncio
import time
import hashlib
import re
import threading
from collections import deque
from datetime import datetime, timezone
from typing import Tuple, Optional, Dict, Any, List

load_dotenv()
# Also check backend/.env or root .env if not found in current working directory
_backend_env = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend", ".env")
if os.path.exists(_backend_env):
    load_dotenv(_backend_env)
_root_env = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
if os.path.exists(_root_env):
    load_dotenv(_root_env)

API_KEY = os.getenv("OPENWEATHER_API_KEY")

def observed_at(data: Dict[str, Any]) -> Optional[str]:
    """OpenWeather's own observation time (`dt`, unix UTC) as ISO 8601, or None."""
    try:
        return datetime.fromtimestamp(int(data["dt"]), tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except (KeyError, TypeError, ValueError):
        return None


def is_valid_api_key(key: Optional[str]) -> bool:
    if not key or not isinstance(key, str):
        return False
    k = key.strip()
    if not k or k.lower() in ["your_actual_api_key_here", "your_api_key", "your_openweather_api_key_here", "none", "null"]:
        return False
    return True
# Key: normalized city name (lowercase stripped), Value: (lat, lon)
_GEO_CACHE: Dict[str, Tuple[Optional[float], Optional[float]]] = {}

# Per-place cache of fetch_weather results (5 min); OpenWeather points have their own 60-min cache below
weather_cache: Dict[str, Dict[str, Any]] = {}
CACHE_EXPIRY = 300  # 300 seconds

FALLBACK_WEATHER = {
    "temperature": 30.0,
    "humidity": 70.0,
    "rainfall": 0.0,
    "wind_speed": 2.0,
    "wind": 2.0,
    "pressure": 1010.0,
}


def get_fallback_mock(city: str, lat: float, lon: float) -> Dict[str, Any]:
    """
    Realistic, deterministic climatological fallback mock for Indian locations.
    ZERO randomness (no random.uniform), completely consistent across requests.
    Calibrated to SIH standards:
      ~13% High risk (Rain > 20mm, Hum > 90%, Wind > 10m/s)
      ~25% Moderate risk (Rain > 5mm, Hum > 70%, Wind > 6m/s)
      ~62% Low risk (Rain 0mm, Hum 45-68%, Wind 2-5m/s)
    """
    c_name = str(city).strip() if city else "Location"
    lat_f = float(lat) if lat is not None else 22.0
    lon_f = float(lon) if lon is not None else 79.0

    seed_str = f"{c_name.lower()}_{round(lat_f, 1)}_{round(lon_f, 1)}"
    h = int(hashlib.md5(seed_str.encode("utf-8")).hexdigest()[:8], 16)
    bucket = h % 100

    # Temperature based on latitude and regional deviation
    base_temp = 32.0 - (lat_f - 15.0) * 0.35 + ((h >> 4) % 7 - 3) * 0.8
    temperature = round(max(18.0, min(40.0, base_temp)), 1)
    pressure = round(1008.0 + ((h >> 8) % 8) * 0.8, 1)

    if bucket < 13:
        # Severe convective weather / active monsoon zone
        rainfall = round(21.0 + (h % 18) * 0.9, 1)
        humidity = round(91.0 + ((h >> 2) % 8) * 0.9, 1)
        wind_speed = round(10.5 + ((h >> 5) % 6) * 0.8, 1)
    elif bucket < 38:
        # Moderate precipitation / overcast convective zone
        rainfall = round(6.0 + (h % 10) * 0.9, 1)
        humidity = round(72.0 + ((h >> 2) % 15) * 0.9, 1)
        wind_speed = round(6.5 + ((h >> 5) % 4) * 0.8, 1)
    else:
        # Clear / stable conditions
        rainfall = 0.0
        humidity = round(45.0 + ((h >> 2) % 22) * 1.0, 1)
        wind_speed = round(2.0 + ((h >> 5) % 4) * 0.9, 1)

    return {
        "temperature": temperature,
        "humidity": min(100.0, max(20.0, humidity)),
        "rainfall": max(0.0, rainfall),
        "wind_speed": max(0.5, wind_speed),
        "wind": max(0.5, wind_speed),
        "pressure": pressure,
        # deterministic sample values, NOT a weather observation (no API key or the API failed)
        "source": "sample",
        "observed_at": None,
    }


def fetch_weather(lat: Any = 22.0, lon: Any = 79.0, city: Optional[str] = None) -> Dict[str, Any]:
    """
    Weather for one point (the /predict search): OpenWeather when a key is set, else (or when it
    fails) Open-Meteo, else sample values. Cached per point.
    """
    if isinstance(lat, str):
        city = lat
        lat = 22.0
        lon = 79.0

    c_name = str(city).strip() if city else "Location"
    lat_f = float(lat) if lat is not None else 22.0
    lon_f = float(lon) if lon is not None else 79.0

    cache_key = f"{c_name.lower()}_{round(lat_f, 2)}_{round(lon_f, 2)}"
    now = time.time()

    if cache_key in weather_cache:
        entry = weather_cache[cache_key]
        if now - entry.get("timestamp", 0) < CACHE_EXPIRY:
            return dict(entry.get("data", {}))

    weather_res = fetch_openweather_point(lat_f, lon_f) if is_valid_api_key(API_KEY) else None
    if weather_res is None:
        weather_res = fetch_open_meteo_point(lat_f, lon_f) or get_fallback_mock(c_name, lat_f, lon_f)

    print(f"[FETCH] {c_name} | source:{weather_res.get('source')}")

    weather_cache[cache_key] = {
        "data": weather_res,
        "timestamp": now,
    }
    return dict(weather_res)


def get_coordinates(city: str) -> Tuple[Optional[float], Optional[float]]:
    """
    Resolves a place name to (lat, lon) with the OpenWeather Geocoding API (throttled, like every
    OpenWeather call); first "<name>,IN", then "<name>". (None, None) if not found or no key.
    """
    if not city or not isinstance(city, str):
        return None, None

    cleaned_city = city.strip()
    if not cleaned_city:
        return None, None

    cache_key = cleaned_city.lower()
    if cache_key in _GEO_CACHE:
        return _GEO_CACHE[cache_key]

    if not is_valid_api_key(API_KEY) or _ow_cooling_down(_ow_clock()):
        return None, None

    try:
        for q in (f"{cleaned_city},IN", cleaned_city):
            data = _ow_request_sync(OPENWEATHER_GEO_URL, {"q": q, "limit": 1})
            if data and isinstance(data, list) and "lat" in data[0] and "lon" in data[0]:
                _GEO_CACHE[cache_key] = (float(data[0]["lat"]), float(data[0]["lon"]))
                return _GEO_CACHE[cache_key]
    except _OWFailed:
        return None, None                 # not cached: a later search may succeed

    _GEO_CACHE[cache_key] = (None, None)
    return None, None


def get_weather_by_coords(lat: float, lon: float, city_name: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """OpenWeather current weather for one point (the /nowcast search), or None."""
    if lat is None or lon is None or not is_valid_api_key(API_KEY):
        return None
    w = fetch_openweather_point(lat, lon)
    if w is None:
        return None
    return {**w, "lat": float(lat), "lon": float(lon), "city_name": city_name or "Unknown"}


def get_weather_data(city_name: str) -> Optional[Dict[str, Any]]:
    """Weather for a place name (utils/run_pipeline.py): geocode, then OpenWeather for that point."""
    if not city_name or not city_name.strip() or not is_valid_api_key(API_KEY):
        return None
    cleaned_name = city_name.strip()
    lat, lon = get_coordinates(cleaned_name)
    if lat is None or lon is None:
        return None
    return get_weather_by_coords(lat, lon, city_name=cleaned_name)


# ============================================================
# Open-Meteo (no key): weather MODEL data, used when OPENWEATHER_API_KEY is not set.
# Terms, limits and attribution: backend/assets/open_meteo_terms.json (CC BY 4.0,
# "Weather data by Open-Meteo.com"). Current values are 15-minutely model data, not
# observations; rain = the hourly precipitation sum of the preceding hour.
# ============================================================
OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
OPEN_METEO_ENABLED = os.getenv("OPEN_METEO_DISABLED", "") != "1"
OPEN_METEO_BATCH = 100          # locations per request (Open-Meteo accepts up to 1000)
OPEN_METEO_TTL = 3600.0         # s; >= 30 min keeps 380 zones within the free 10,000 calls/day
OPEN_METEO_TIMEOUT = 25.0       # s per request (the free host is slow; 10 s timed out there)
OPEN_METEO_RETRIES = 2          # extra attempts per batch, only after HTTP 429 or a timeout
OPEN_METEO_BACKOFF = 2.0        # s; attempt k waits BACKOFF * 2**(k-1) unless Retry-After says otherwise
OPEN_METEO_MAX_RETRY_AFTER = 60.0   # s; a longer Retry-After (e.g. a daily limit) is not waited for
OPEN_METEO_COOLDOWN = 1800.0    # s; after a batch finally fails, no new requests for this long
OPEN_METEO_CURRENT = "temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,pressure_msl"
# Every successful result stays here: fresh for OPEN_METEO_TTL, and after that it is still served
# (flagged stale, with its real model time) when a new request fails, before falling back to sample.
_OM_CACHE: Dict[Tuple[float, float], Tuple[Dict[str, Any], float]] = {}
OPEN_METEO_STATS = {"requests": 0, "locations_requested": 0, "cache_hits": 0, "errors": 0,
                    "retries": 0, "stale_served": 0}
# Diagnostics for /weather_source (no secrets: an HTTP status or exception class plus a short message)
OPEN_METEO_STATUS: Dict[str, Any] = {"last_error": None, "last_error_at": None, "last_success_at": None,
                                     "cooldown_until": None}
_om_sleep = asyncio.sleep         # replaced in tests


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _describe_error(e: Exception) -> str:
    """'HTTP 429: <reason>' or '<ExceptionClass>: <message>', at most 160 characters."""
    if isinstance(e, httpx.HTTPStatusError):
        reason = ""
        try:
            body = e.response.json()
            reason = str(body.get("reason") or body.get("message") or "") if isinstance(body, dict) else ""
        except Exception:  # noqa: BLE001 -- body is not JSON
            reason = e.response.text or ""
        return f"HTTP {e.response.status_code}: {reason.strip()}"[:160].rstrip(": ")
    msg = str(e).strip()
    return f"{type(e).__name__}: {msg}"[:160] if msg else type(e).__name__


def _retry_wait(e: Exception, attempt: int) -> Optional[float]:
    """Seconds to wait before retrying after `e`, or None when it must not be retried."""
    if isinstance(e, httpx.TimeoutException):
        return OPEN_METEO_BACKOFF * 2 ** (attempt - 1)
    if isinstance(e, httpx.HTTPStatusError) and e.response.status_code == 429:
        ra = e.response.headers.get("Retry-After")
        if ra is not None:
            try:
                wait = float(ra)
            except ValueError:
                wait = OPEN_METEO_BACKOFF * 2 ** (attempt - 1)
            return wait if wait <= OPEN_METEO_MAX_RETRY_AFTER else None
        return OPEN_METEO_BACKOFF * 2 ** (attempt - 1)
    return None

# WMO weather interpretation codes (Open-Meteo docs) -> short text
WMO_TEXT = {
    0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Depositing rime fog",
    51: "Light drizzle", 53: "Moderate drizzle", 55: "Dense drizzle", 56: "Light freezing drizzle",
    57: "Dense freezing drizzle", 61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
    66: "Light freezing rain", 67: "Heavy freezing rain", 71: "Slight snow fall", 73: "Moderate snow fall",
    75: "Heavy snow fall", 77: "Snow grains", 80: "Slight rain showers", 81: "Moderate rain showers",
    82: "Violent rain showers", 85: "Slight snow showers", 86: "Heavy snow showers", 95: "Thunderstorm",
    96: "Thunderstorm with slight hail", 99: "Thunderstorm with heavy hail",
}


def _om_key(lat: float, lon: float) -> Tuple[float, float]:
    return (round(float(lat), 2), round(float(lon), 2))


def open_meteo_params(points: List[Tuple[float, float]]) -> Dict[str, Any]:
    return {
        "latitude": ",".join(f"{float(la):.4f}" for la, _ in points),
        "longitude": ",".join(f"{float(lo):.4f}" for _, lo in points),
        "current": OPEN_METEO_CURRENT, "hourly": "precipitation",
        "past_hours": 1, "forecast_hours": 1, "wind_speed_unit": "ms", "timezone": "GMT",
    }


def parse_open_meteo(item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """One location of an Open-Meteo response -> the inputs the rules use; None if incomplete."""
    try:
        cur = item["current"]
        t = cur["time"]
        temp, hum, ws = cur["temperature_2m"], cur["relative_humidity_2m"], cur["wind_speed_10m"]
        if temp is None or hum is None or ws is None:
            return None
        # rain: the hourly precipitation sum of the preceding hour, at the latest hour not after "current"
        rain = None
        hourly = item.get("hourly", {})
        for ht, v in zip(hourly.get("time", []), hourly.get("precipitation", [])):
            if ht <= t and v is not None:
                rain = float(v)
        if rain is None:
            return None
        code = cur.get("weather_code")
        out = {
            "temperature": round(float(temp), 1), "humidity": round(float(hum), 1),
            "rainfall": round(rain, 1), "wind_speed": round(float(ws), 1), "wind": round(float(ws), 1),
            "conditions": WMO_TEXT.get(code) if code is not None else None, "weather_code": code,
            "source": "open-meteo", "data_time": f"{t}Z" if not t.endswith("Z") else t, "observed_at": None,
        }
        if cur.get("pressure_msl") is not None:
            out["pressure"] = round(float(cur["pressure_msl"]), 1)
        return out
    except (KeyError, TypeError, ValueError):
        return None


async def async_fetch_open_meteo(points: List[Tuple[float, float]], client: Optional[httpx.AsyncClient] = None,
                                 now: Optional[float] = None) -> List[Optional[Dict[str, Any]]]:
    """Weather for many points: cached (OPEN_METEO_TTL), else batched requests of <= OPEN_METEO_BATCH
    locations. HTTP 429 and timeouts are retried (OPEN_METEO_RETRIES, backoff / Retry-After). When a
    batch still fails, the last successful Open-Meteo result of each point is served (stale, flagged,
    with its real model time); points with none stay None (the caller falls back to sample data), and
    no new request is made for OPEN_METEO_COOLDOWN s so the call limits are kept."""
    now = time.time() if now is None else now
    out: List[Optional[Dict[str, Any]]] = [None] * len(points)
    todo = []
    for i, (la, lo) in enumerate(points):
        hit = _OM_CACHE.get(_om_key(la, lo))
        if hit and now - hit[1] < OPEN_METEO_TTL:
            out[i] = dict(hit[0])
            OPEN_METEO_STATS["cache_hits"] += 1
        else:
            todo.append(i)
    if not todo or not OPEN_METEO_ENABLED:
        return out
    failed: List[int] = []
    cooldown = OPEN_METEO_STATUS.get("cooldown_ts")
    if cooldown is not None and now < cooldown:
        failed = list(todo)                    # still cooling down after a failure: no request
    else:
        own = client is None
        cl = client or httpx.AsyncClient(timeout=OPEN_METEO_TIMEOUT)
        try:
            for s in range(0, len(todo), OPEN_METEO_BATCH):
                idx = todo[s:s + OPEN_METEO_BATCH]
                if failed:                         # an earlier batch failed: don't send the rest
                    failed.extend(idx)
                    continue
                pts = [points[i] for i in idx]
                attempt = 0
                while True:
                    attempt += 1
                    OPEN_METEO_STATS["requests"] += 1
                    OPEN_METEO_STATS["locations_requested"] += len(idx)
                    try:
                        r = await cl.get(OPEN_METEO_URL, params=open_meteo_params(pts), timeout=OPEN_METEO_TIMEOUT)
                        r.raise_for_status()
                        data = r.json()
                        items = data if isinstance(data, list) else [data]
                        if len(items) != len(idx):
                            raise ValueError(f"{len(items)} results for {len(idx)} locations")
                        for i, it in zip(idx, items):
                            w = parse_open_meteo(it)
                            if w:
                                out[i] = w
                                _OM_CACHE[_om_key(*points[i])] = (w, now)
                        OPEN_METEO_STATUS["last_success_at"] = _iso(time.time())
                        break
                    except Exception as e:  # noqa: BLE001 -- any failure -> stale, else sample data
                        OPEN_METEO_STATS["errors"] += 1
                        desc = _describe_error(e)
                        OPEN_METEO_STATUS["last_error"] = desc
                        OPEN_METEO_STATUS["last_error_at"] = _iso(time.time())
                        wait = _retry_wait(e, attempt) if attempt <= OPEN_METEO_RETRIES else None
                        print(f"[OPEN-METEO] batch of {len(idx)} failed (attempt {attempt}): {desc}"
                              + (f"; retrying in {wait:.0f} s" if wait is not None else ""))
                        if wait is None:
                            failed.extend(idx)
                            break
                        OPEN_METEO_STATS["retries"] += 1
                        await _om_sleep(wait)
        finally:
            if own:
                await cl.aclose()
        if failed:
            OPEN_METEO_STATUS["cooldown_ts"] = now + OPEN_METEO_COOLDOWN
            OPEN_METEO_STATUS["cooldown_until"] = _iso(now + OPEN_METEO_COOLDOWN)
    for i in failed:                           # last successful Open-Meteo data, labelled stale
        hit = _OM_CACHE.get(_om_key(*points[i]))
        if hit:
            out[i] = {**hit[0], "stale": True}
            OPEN_METEO_STATS["stale_served"] += 1
    return out


def fetch_open_meteo_point(lat: float, lon: float) -> Optional[Dict[str, Any]]:
    """One point (sync endpoints): same cache and fallback rules."""
    try:
        return asyncio.run(async_fetch_open_meteo([(lat, lon)]))[0]
    except RuntimeError:          # called inside a running loop: skip rather than block it
        return None


# ============================================================
# OpenWeather (OPENWEATHER_API_KEY set): Current Weather API 2.5, one call per point
# (https://api.openweathermap.org/data/2.5/weather); place search uses the Geocoding API (geo/1.0/direct).
# Free tier: 60 calls/minute, 1,000,000 calls/month (backend/assets/openweather_terms.json).
# - Every call goes through one throttle: at most OPENWEATHER_MAX_PER_MIN in any rolling 60 s.
# - Results are cached OPENWEATHER_TTL per point. The zone lists never wait for the network: they read
#   this cache, and a background refresher fetches missing/expired points under the throttle.
# - HTTP 429 and timeouts are retried like Open-Meteo; a final failure stops the refresh and starts a
#   cooldown. Expired data is then served flagged stale; points with none fall back to Open-Meteo, then
#   sample.
# - The key goes only into the request parameters. It is never logged or returned: every error text is
#   redacted before it is printed or stored.
# ============================================================
OPENWEATHER_URL = "https://api.openweathermap.org/data/2.5/weather"
OPENWEATHER_GEO_URL = "https://api.openweathermap.org/geo/1.0/direct"
OPENWEATHER_MAX_PER_MIN = 50       # the free tier allows 60/min
OPENWEATHER_TTL = 3600.0           # s per point
OPENWEATHER_TIMEOUT = 25.0
OPENWEATHER_RETRIES = 2
OPENWEATHER_COOLDOWN = 1800.0
_OW_CACHE: Dict[Tuple[float, float], Tuple[Dict[str, Any], float]] = {}
_OW_WANTED: Dict[Tuple[float, float], Tuple[float, float]] = {}      # points the zone lists need
# points a page is showing (openweather_first): the refresher fetches these before the rest, newest
# request first; same throttle, same cache
_OW_FIRST: Dict[Tuple[float, float], float] = {}
OPENWEATHER_STATS = {"requests": 0, "errors": 0, "retries": 0, "cache_hits": 0, "stale_served": 0}
OPENWEATHER_STATUS: Dict[str, Any] = {"last_error": None, "last_error_at": None, "last_success_at": None,
                                      "cooldown_until": None, "refresh_running": False}
_ow_clock = time.time              # replaced in tests
_ow_sleep = asyncio.sleep
_ow_sleep_sync = time.sleep
_ow_client_factory = lambda: httpx.AsyncClient(timeout=OPENWEATHER_TIMEOUT)   # noqa: E731
_OW_TASK: Dict[str, Any] = {"task": None}


class _OWFailed(Exception):
    """An OpenWeather request failed after its retries (message already redacted)."""


class CallThrottle:
    """At most `n` calls in any rolling `window` seconds. reserve() books the earliest allowed slot and
    returns how long to wait for it; thread-safe, so sync and async callers share one budget."""

    def __init__(self, n: int, window: float = 60.0):
        self.n, self.window = n, window
        self.slots: deque = deque()
        self.lock = threading.Lock()

    def reserve(self, now: float) -> float:
        with self.lock:
            while self.slots and self.slots[0] <= now - self.window:
                self.slots.popleft()
            t = now if len(self.slots) < self.n else max(now, self.slots[-self.n] + self.window)
            self.slots.append(t)
            return t - now


OW_THROTTLE = CallThrottle(OPENWEATHER_MAX_PER_MIN, 60.0)


def _redact(text: str) -> str:
    if is_valid_api_key(API_KEY):
        text = text.replace(API_KEY.strip(), "***")
    return re.sub(r"(appid=)[^&\s'\"]+", r"\1***", text)


def _ow_cooling_down(now: float) -> bool:
    until = OPENWEATHER_STATUS.get("cooldown_ts")
    return until is not None and now < until


def _ow_fail(desc: str) -> None:
    now = _ow_clock()
    OPENWEATHER_STATUS["cooldown_ts"] = now + OPENWEATHER_COOLDOWN
    OPENWEATHER_STATUS["cooldown_until"] = _iso(now + OPENWEATHER_COOLDOWN)
    raise _OWFailed(desc)


def _ow_error(e: Exception, attempt: int) -> Optional[float]:
    """Record one failed attempt; return the wait before retrying, or None when it must not be retried."""
    OPENWEATHER_STATS["errors"] += 1
    desc = _redact(_describe_error(e))
    OPENWEATHER_STATUS["last_error"] = desc
    OPENWEATHER_STATUS["last_error_at"] = _iso(time.time())
    wait = _retry_wait(e, attempt) if attempt <= OPENWEATHER_RETRIES else None
    print(f"[OPENWEATHER] request failed (attempt {attempt}): {desc}"
          + (f"; retrying in {wait:.0f} s" if wait is not None else ""))
    return wait


def _ow_params(params: Dict[str, Any]) -> Dict[str, Any]:
    return {**params, "appid": API_KEY.strip(), "units": "metric"}


async def _ow_request(client: httpx.AsyncClient, url: str, params: Dict[str, Any]) -> Any:
    attempt = 0
    while True:
        attempt += 1
        wait = OW_THROTTLE.reserve(_ow_clock())
        if wait > 0:
            await _ow_sleep(wait)
        OPENWEATHER_STATS["requests"] += 1
        try:
            r = await client.get(url, params=_ow_params(params), timeout=OPENWEATHER_TIMEOUT)
            r.raise_for_status()
            data = r.json()
            OPENWEATHER_STATUS["last_success_at"] = _iso(time.time())
            return data
        except Exception as e:  # noqa: BLE001
            wait = _ow_error(e, attempt)
            if wait is None:
                _ow_fail(OPENWEATHER_STATUS["last_error"])
            OPENWEATHER_STATS["retries"] += 1
            await _ow_sleep(wait)


def _ow_request_sync(url: str, params: Dict[str, Any]) -> Any:
    attempt = 0
    while True:
        attempt += 1
        wait = OW_THROTTLE.reserve(_ow_clock())
        if wait > 0:
            _ow_sleep_sync(wait)
        OPENWEATHER_STATS["requests"] += 1
        try:
            r = httpx.get(url, params=_ow_params(params), timeout=OPENWEATHER_TIMEOUT)
            r.raise_for_status()
            data = r.json()
            OPENWEATHER_STATUS["last_success_at"] = _iso(time.time())
            return data
        except Exception as e:  # noqa: BLE001
            wait = _ow_error(e, attempt)
            if wait is None:
                _ow_fail(OPENWEATHER_STATUS["last_error"])
            OPENWEATHER_STATS["retries"] += 1
            _ow_sleep_sync(wait)


def parse_openweather(data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """One Current Weather response -> the inputs the rules use; None if incomplete.
    Rain: `rain.1h` (mm in the last hour); the key is absent when there is no rain (-> 0.0). A response
    with only `rain.3h` (a 3-hour sum) is not used as a one-hour value."""
    try:
        main, wind = data["main"], data.get("wind") or {}
        temp, hum, ws = main.get("temp"), main.get("humidity"), wind.get("speed")
        if temp is None or hum is None or ws is None:
            return None
        rain_obj = data.get("rain") or {}
        if "1h" in rain_obj:
            rain = float(rain_obj["1h"])
        elif rain_obj:
            return None
        else:
            rain = 0.0
        t = observed_at(data)
        desc = ((data.get("weather") or [{}])[0] or {}).get("description")
        out = {
            "temperature": round(float(temp), 1), "humidity": round(float(hum), 1), "rainfall": round(rain, 1),
            "wind_speed": round(float(ws), 1), "wind": round(float(ws), 1),
            "conditions": desc[:1].upper() + desc[1:] if desc else None,
            "source": "openweather", "observed_at": t, "data_time": t,
        }
        if main.get("pressure") is not None:
            out["pressure"] = round(float(main["pressure"]), 1)
        return out
    except (KeyError, TypeError, ValueError, IndexError, AttributeError):
        return None


def fetch_openweather_point(lat: float, lon: float) -> Optional[Dict[str, Any]]:
    """One point, synchronously (searches): cache, else one throttled request; None on failure,
    in cooldown, or without a key (the caller then uses Open-Meteo, then sample)."""
    if not is_valid_api_key(API_KEY):
        return None
    key = _om_key(lat, lon)
    now = _ow_clock()
    hit = _OW_CACHE.get(key)
    if hit and now - hit[1] < OPENWEATHER_TTL:
        OPENWEATHER_STATS["cache_hits"] += 1
        return dict(hit[0])
    if not _ow_cooling_down(now):
        try:
            w = parse_openweather(_ow_request_sync(OPENWEATHER_URL, {"lat": float(lat), "lon": float(lon)}))
            if w:
                _OW_CACHE[key] = (w, _ow_clock())
                return dict(w)
        except _OWFailed:
            pass
    if hit:
        OPENWEATHER_STATS["stale_served"] += 1
        return {**hit[0], "stale": True}
    return None


async def _ow_refresh() -> None:
    """Fetch every wanted point whose data is missing or expired, under the throttle; stop at the
    first final failure (cooldown)."""
    OPENWEATHER_STATUS["refresh_running"] = True
    tried: set = set()            # one attempt per point per run (a point OpenWeather cannot parse is not retried)
    try:
        async with _ow_client_factory() as cl:
            while True:
                # the next point is picked before every request, so zones a page asks for jump the queue
                k = _ow_next(_ow_clock(), tried)
                if k is None or _ow_cooling_down(_ow_clock()):
                    return
                tried.add(k)
                la, lo = _OW_WANTED[k]
                try:
                    data = await _ow_request(cl, OPENWEATHER_URL, {"lat": la, "lon": lo})
                except _OWFailed:
                    return
                w = parse_openweather(data)
                if w:
                    _OW_CACHE[k] = (w, _ow_clock())
                    _OW_FIRST.pop(k, None)
    finally:
        OPENWEATHER_STATUS["refresh_running"] = False


def _ow_fresh(k: Tuple[float, float], now: float) -> bool:
    hit = _OW_CACHE.get(k)
    return bool(hit and now - hit[1] < OPENWEATHER_TTL)


def _ow_next(now: float, tried: set) -> Optional[Tuple[float, float]]:
    """The next point to fetch: the newest-requested shown point that is missing/expired, else the
    first missing/expired point of the zone lists (their order)."""
    first = sorted((t, k) for k, t in _OW_FIRST.items() if k in _OW_WANTED and k not in tried)
    for _, k in reversed(first):
        if not _ow_fresh(k, now):
            return k
    for k in list(_OW_WANTED):
        if k not in tried and not _ow_fresh(k, now):
            return k
    return None


def _ow_start_refresh(now: float) -> bool:
    task = _OW_TASK["task"]
    if is_valid_api_key(API_KEY) and not _ow_cooling_down(now) and (task is None or task.done()):
        try:
            _OW_TASK["task"] = asyncio.get_running_loop().create_task(_ow_refresh())
            return True
        except RuntimeError:        # no running loop (sync caller): nothing is started
            pass
    return False


def openweather_first(points: List[Tuple[float, float]]) -> int:
    """Points a page is showing: fetched before the rest of the zone lists (newest request first).
    Returns how many of them still wait for fresh OpenWeather data."""
    now = _ow_clock()
    n = 0
    for i, (la, lo) in enumerate(points):
        k = _om_key(la, lo)
        _OW_WANTED.setdefault(k, (float(la), float(lo)))
        if not _ow_fresh(k, now):
            _OW_FIRST[k] = now - i * 1e-6        # keeps the page's own order among its points
            n += 1
    if n:
        _ow_start_refresh(now)
    return n


def openweather_pending() -> int:
    """Zone-list points without fresh OpenWeather data (0 without a key)."""
    if not is_valid_api_key(API_KEY):
        return 0
    now = _ow_clock()
    return sum(not _ow_fresh(k, now) for k in list(_OW_WANTED))


def openweather_filling() -> bool:
    """True while the refresher is still filling the zone lists (key set, points pending, no cooldown)."""
    return is_valid_api_key(API_KEY) and not _ow_cooling_down(_ow_clock()) and openweather_pending() > 0


def openweather_zones(points: List[Tuple[float, float]]) -> List[Optional[Dict[str, Any]]]:
    """The zone lists' OpenWeather values, from the cache only (never waits for the network): fresh,
    else expired flagged stale, else None. Starts the background refresher for missing/expired points."""
    now = _ow_clock()
    out: List[Optional[Dict[str, Any]]] = []
    need = False
    for la, lo in points:
        k = _om_key(la, lo)
        _OW_WANTED.setdefault(k, (float(la), float(lo)))
        hit = _OW_CACHE.get(k)
        if hit and now - hit[1] < OPENWEATHER_TTL:
            out.append(dict(hit[0]))
            OPENWEATHER_STATS["cache_hits"] += 1
        else:
            need = True
            if hit:
                out.append({**hit[0], "stale": True})
                OPENWEATHER_STATS["stale_served"] += 1
            else:
                out.append(None)
    if need:
        _ow_start_refresh(now)
    return out
