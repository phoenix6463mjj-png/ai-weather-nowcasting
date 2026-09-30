from dotenv import load_dotenv
import os
import requests
import httpx
import asyncio
import time
import hashlib
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

# Global in-memory weather cache (300 seconds / 5 minutes TTL)
weather_cache: Dict[str, Dict[str, Any]] = {}
CACHE_EXPIRY = 300  # 300 seconds

# Backward-compatibility alias
_WEATHER_CACHE = weather_cache
WEATHER_CACHE_TTL = CACHE_EXPIRY

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
    Fetch real-time weather data with in-memory caching and safe fallback mock.
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

    weather_res = None
    if not is_valid_api_key(API_KEY):
        # no OpenWeather key: Open-Meteo model data, else sample data
        weather_res = fetch_open_meteo_point(lat_f, lon_f) or get_fallback_mock(c_name, lat_f, lon_f)
    else:
        url = f"https://api.openweathermap.org/data/2.5/weather?lat={lat_f}&lon={lon_f}&appid={API_KEY}&units=metric"
        try:
            response = requests.get(url, timeout=3.5)
            if response.status_code == 200:
                data = response.json()
                main = data.get("main", {})
                wind = data.get("wind", {})
                rain = data.get("rain", {})

                temperature = float(main.get("temp", 30.0))
                humidity = float(main.get("humidity", 70.0))
                wind_speed = float(wind.get("speed", 2.0))
                pressure = float(main.get("pressure", 1010.0))

                rainfall = 0.0
                if isinstance(rain, dict):
                    rainfall = float(rain.get("1h", rain.get("3h", 0.0)))

                weather_res = {
                    "temperature": round(temperature, 1),
                    "humidity": round(humidity, 1),
                    "rainfall": round(rainfall, 1),
                    "wind_speed": round(wind_speed, 1),
                    "wind": round(wind_speed, 1),
                    "pressure": round(pressure, 1),
                    "source": "openweather",
                    "observed_at": observed_at(data),
                }
        except Exception:
            weather_res = None

    if weather_res is None:
        weather_res = get_fallback_mock(c_name, lat_f, lon_f)

    rainfall = weather_res.get("rainfall", 0.0)
    humidity = weather_res.get("humidity", 0.0)
    wind = weather_res.get("wind_speed", 0.0)
    print(f"[FETCH] {c_name} | Rain:{rainfall} | Hum:{humidity} | Wind:{wind}")

    weather_cache[cache_key] = {
        "data": weather_res,
        "timestamp": now,
    }
    return dict(weather_res)


async def async_fetch_weather(
    city: Any = "Location",
    lat: Optional[float] = 22.0,
    lon: Optional[float] = 79.0,
    client: Optional[httpx.AsyncClient] = None
) -> Dict[str, Any]:
    """
    Asynchronously fetch real-time weather with in-memory caching and safe fallback mock.
    Supports flexible signatures:
      - async_fetch_weather(city, lat, lon)
      - async_fetch_weather(city, lat, lon, client=client)
      - async_fetch_weather(client, lat, lon)
    """
    if isinstance(city, httpx.AsyncClient):
        actual_client = city
        actual_lat = float(lat) if lat is not None else 22.0
        actual_lon = float(lon) if lon is not None else 79.0
        actual_city = "Location"
    else:
        actual_client = client
        actual_city = str(city).strip() if city else "Location"
        actual_lat = float(lat) if lat is not None else 22.0
        actual_lon = float(lon) if lon is not None else 79.0

    cache_key = f"{actual_city.lower()}_{round(actual_lat, 2)}_{round(actual_lon, 2)}"
    now = time.time()

    if cache_key in weather_cache:
        entry = weather_cache[cache_key]
        if now - entry.get("timestamp", 0) < CACHE_EXPIRY:
            return dict(entry.get("data", {}))

    weather_res = None
    if not is_valid_api_key(API_KEY):
        print("[WARNING] No API key found, using fallback data")
        weather_res = get_fallback_mock(actual_city, actual_lat, actual_lon)
    else:
        url = f"https://api.openweathermap.org/data/2.5/weather?lat={actual_lat}&lon={actual_lon}&appid={API_KEY}&units=metric"
        try:
            if actual_client is not None:
                response = await actual_client.get(url, timeout=2.5)
            else:
                async with httpx.AsyncClient(timeout=2.5) as temp_client:
                    response = await temp_client.get(url)

            if response.status_code == 200:
                data = response.json()
                main = data.get("main", {})
                wind = data.get("wind", {})
                rain = data.get("rain", {})

                temperature = float(main.get("temp", 30.0))
                humidity = float(main.get("humidity", 70.0))
                wind_speed = float(wind.get("speed", 2.0))
                pressure = float(main.get("pressure", 1010.0))

                rainfall = 0.0
                if isinstance(rain, dict):
                    rainfall = float(rain.get("1h", rain.get("3h", 0.0)))

                weather_res = {
                    "temperature": round(temperature, 1),
                    "humidity": round(humidity, 1),
                    "rainfall": round(rainfall, 1),
                    "wind_speed": round(wind_speed, 1),
                    "wind": round(wind_speed, 1),
                    "pressure": round(pressure, 1),
                    "source": "openweather",
                    "observed_at": observed_at(data),
                }
        except Exception:
            weather_res = None

    if weather_res is None:
        weather_res = get_fallback_mock(actual_city, actual_lat, actual_lon)

    rainfall = weather_res.get("rainfall", 0.0)
    humidity = weather_res.get("humidity", 0.0)
    wind = weather_res.get("wind_speed", 0.0)
    print(f"[FETCH] {actual_city} | Rain:{rainfall} | Hum:{humidity} | Wind:{wind}")

    weather_cache[cache_key] = {
        "data": weather_res,
        "timestamp": now,
    }
    return dict(weather_res)


def get_coordinates(city: str) -> Tuple[Optional[float], Optional[float]]:
    """
    Dynamically resolves latitude and longitude for any city or place using OpenWeather Geo API.

    Endpoint:
    https://api.openweathermap.org/geo/1.0/direct?q={city},IN&limit=1&appid={API_KEY}

    Returns:
        (lat, lon) as floats if found, otherwise (None, None).
    """
    if not city or not isinstance(city, str):
        return None, None

    cleaned_city = city.strip()
    if not cleaned_city:
        return None, None

    cache_key = cleaned_city.lower()
    if cache_key in _GEO_CACHE:
        return _GEO_CACHE[cache_key]

    if not is_valid_api_key(API_KEY):
        return None, None

    try:
        # 1. Primary lookup: query with ',IN' for India location coverage
        geo_url = f"https://api.openweathermap.org/geo/1.0/direct?q={cleaned_city},IN&limit=1&appid={API_KEY}"
        response = requests.get(geo_url, timeout=4)

        if response.status_code == 200:
            data = response.json()
            if data and len(data) > 0 and "lat" in data[0] and "lon" in data[0]:
                lat = float(data[0]["lat"])
                lon = float(data[0]["lon"])
                _GEO_CACHE[cache_key] = (lat, lon)
                return lat, lon

        # 2. Fallback lookup: query without ',IN' in case of regional differences
        geo_url_fb = f"https://api.openweathermap.org/geo/1.0/direct?q={cleaned_city}&limit=1&appid={API_KEY}"
        response_fb = requests.get(geo_url_fb, timeout=4)
        if response_fb.status_code == 200:
            data_fb = response_fb.json()
            if data_fb and len(data_fb) > 0 and "lat" in data_fb[0] and "lon" in data_fb[0]:
                lat = float(data_fb[0]["lat"])
                lon = float(data_fb[0]["lon"])
                _GEO_CACHE[cache_key] = (lat, lon)
                return lat, lon

    except Exception as e:
        print(f"[Geo API Error] Failed to resolve coordinates for '{cleaned_city}': {e}")

    # Not found or error occurred
    _GEO_CACHE[cache_key] = (None, None)
    return None, None


async def async_get_weather_by_coords(
    client: httpx.AsyncClient,
    lat: float,
    lon: float,
    city_name: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """
    Asynchronously fetches weather data from OpenWeather using httpx with TTL caching.
    Safely times out and catches errors to prevent blocking.
    """
    if lat is None or lon is None or not is_valid_api_key(API_KEY):
        return None

    cache_key = f"{round(lat, 2)},{round(lon, 2)}"
    now = time.time()

    # Check cache
    if cache_key in _WEATHER_CACHE:
        cached_data, timestamp = _WEATHER_CACHE[cache_key]
        if now - timestamp < WEATHER_CACHE_TTL:
            return cached_data

    url = f"https://api.openweathermap.org/data/2.5/weather?lat={lat}&lon={lon}&appid={API_KEY}&units=metric"
    try:
        response = await client.get(url, timeout=2.5)
        if response.status_code == 200:
            data = response.json()
            temperature = float(data["main"]["temp"])
            humidity = float(data["main"]["humidity"])
            wind_speed = float(data["wind"]["speed"])
            pressure = float(data["main"].get("pressure", 1010))

            rainfall = 0.0
            if "rain" in data and isinstance(data["rain"], dict) and "1h" in data["rain"]:
                rainfall = float(data["rain"]["1h"])

            coord = data.get("coord", {})
            res_lat = float(coord.get("lat", lat))
            res_lon = float(coord.get("lon", lon))
            res_name = data.get("name") or city_name or "Unknown"

            weather_dict = {
                "temperature": temperature,
                "humidity": humidity,
                "wind_speed": wind_speed,
                "pressure": pressure,
                "rainfall": rainfall,
                "lat": res_lat,
                "lon": res_lon,
                "city_name": res_name
            }
            _WEATHER_CACHE[cache_key] = (weather_dict, now)
            return weather_dict
    except Exception:
        pass

    return None


def get_weather_by_coords(lat: float, lon: float, city_name: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Synchronously fetches live weather data from OpenWeather using coordinates with TTL caching.
    """
    if lat is None or lon is None or not is_valid_api_key(API_KEY):
        return None

    cache_key = f"{round(lat, 2)},{round(lon, 2)}"
    now = time.time()
    if cache_key in _WEATHER_CACHE:
        cached_data, timestamp = _WEATHER_CACHE[cache_key]
        if now - timestamp < WEATHER_CACHE_TTL:
            return cached_data

    url = f"https://api.openweathermap.org/data/2.5/weather?lat={lat}&lon={lon}&appid={API_KEY}&units=metric"
    try:
        response = requests.get(url, timeout=4)
        if response.status_code == 200:
            data = response.json()
            temperature = float(data["main"]["temp"])
            humidity = float(data["main"]["humidity"])
            wind_speed = float(data["wind"]["speed"])
            pressure = float(data["main"].get("pressure", 1010))

            rainfall = 0.0
            if "rain" in data and isinstance(data["rain"], dict) and "1h" in data["rain"]:
                rainfall = float(data["rain"]["1h"])

            coord = data.get("coord", {})
            res_lat = float(coord.get("lat", lat))
            res_lon = float(coord.get("lon", lon))
            res_name = data.get("name") or city_name or "Unknown"

            weather_dict = {
                "temperature": temperature,
                "humidity": humidity,
                "wind_speed": wind_speed,
                "pressure": pressure,
                "rainfall": rainfall,
                "lat": res_lat,
                "lon": res_lon,
                "city_name": res_name
            }
            _WEATHER_CACHE[cache_key] = (weather_dict, now)
            return weather_dict
    except Exception as e:
        print(f"[Weather API Coords Error] lat={lat}, lon={lon}: {e}")

    return None


def get_weather_data(city_name: str) -> Optional[Dict[str, Any]]:
    """
    Fetches weather data for a given city name.
    1. First resolves coordinates dynamically via get_coordinates(city_name).
    2. If coordinates are found, fetches weather via coordinates.
    3. If coordinates are not found, falls back to direct city-name query.
    """
    if not city_name or not city_name.strip() or not is_valid_api_key(API_KEY):
        return None

    cleaned_name = city_name.strip()

    # 1. Dynamic Geolocation
    lat, lon = get_coordinates(cleaned_name)
    if lat is not None and lon is not None:
        weather = get_weather_by_coords(lat, lon, city_name=cleaned_name)
        if weather:
            return weather

    # 2. Fallback to direct query by city name
    url = f"https://api.openweathermap.org/data/2.5/weather?q={cleaned_name}&appid={API_KEY}&units=metric"
    try:
        response = requests.get(url, timeout=4)
        if response.status_code == 200:
            data = response.json()
            temperature = float(data["main"]["temp"])
            humidity = float(data["main"]["humidity"])
            wind_speed = float(data["wind"]["speed"])
            pressure = float(data["main"].get("pressure", 1010))

            rainfall = 0.0
            if "rain" in data and isinstance(data["rain"], dict) and "1h" in data["rain"]:
                rainfall = float(data["rain"]["1h"])

            coord = data.get("coord", {})
            res_lat = float(coord.get("lat")) if coord.get("lat") is not None else lat
            res_lon = float(coord.get("lon")) if coord.get("lon") is not None else lon
            res_name = data.get("name", cleaned_name)

            return {
                "temperature": temperature,
                "humidity": humidity,
                "wind_speed": wind_speed,
                "pressure": pressure,
                "rainfall": rainfall,
                "lat": res_lat,
                "lon": res_lon,
                "city_name": res_name
            }
    except Exception as e:
        print(f"[Weather API Name Error] Failed to fetch weather for '{cleaned_name}': {e}")

    return None


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
            reason = str(body.get("reason", "")) if isinstance(body, dict) else ""
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
