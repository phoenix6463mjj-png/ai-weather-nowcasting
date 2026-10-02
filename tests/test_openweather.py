"""OpenWeather path (OPENWEATHER_API_KEY set): Current Weather API calls, throttle (<= 50/min), 60-min
cache, 429/timeout retry, stale data, cooldown, fallback to Open-Meteo then sample, diagnostics without
the key. All HTTP is mocked (httpx.MockTransport) and the clock is simulated; no network, no real key."""
import asyncio
import json
import sys
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from utils import api_fetcher as A  # noqa: E402
from tests.test_open_meteo import om_item  # noqa: E402

KEY = "TESTKEY" + "0123456789abcdef" * 2        # a fake key; must never appear in any output
T0 = 1_790_000_000.0


def ow_body(lat, lon, rain=None, hum=60.0, wind=2.0, dt=1790000000):
    b = {"coord": {"lat": lat, "lon": lon}, "dt": dt, "name": "X",
         "main": {"temp": 30.0, "humidity": hum, "pressure": 1008},
         "wind": {"speed": wind}, "weather": [{"main": "Rain", "description": "light rain"}]}
    if rain is not None:
        b["rain"] = {"1h": rain}
    return b


class Clock:
    def __init__(self):
        self.t = T0

    def __call__(self):
        return self.t

    async def sleep(self, s):
        self.t += s

    def sleep_sync(self, s):
        self.t += s


class OW:
    """Mock OpenWeather: scripted outcomes ('ok', int status, 'timeout'), then 'ok'."""

    def __init__(self, clock, outcomes=(), retry_after=None, default="ok"):
        self.clock, self.outcomes, self.retry_after, self.default = clock, list(outcomes), retry_after, default
        self.times, self.params = [], []

    def __call__(self, request: httpx.Request):
        self.times.append(self.clock())
        self.params.append((request.url.path, dict(request.url.params)))
        o = self.outcomes.pop(0) if self.outcomes else self.default
        if o == "timeout":
            raise httpx.ReadTimeout("timed out", request=request)
        if o == "connect-with-key":          # an exception whose text contains the request URL (and key)
            raise httpx.ConnectError(f"cannot connect to {request.url}", request=request)
        if o != "ok":
            h = {"Retry-After": str(self.retry_after)} if self.retry_after is not None else {}
            return httpx.Response(o, headers=h, json={"cod": o, "message": "Your account is temporary blocked"})
        q = request.url.params
        return httpx.Response(200, json=ow_body(float(q["lat"]), float(q["lon"])))


@pytest.fixture
def env(monkeypatch):
    clock = Clock()
    monkeypatch.setattr(A, "API_KEY", KEY)
    monkeypatch.setattr(A, "_ow_clock", clock)
    monkeypatch.setattr(A, "_ow_sleep", clock.sleep)
    monkeypatch.setattr(A, "_ow_sleep_sync", clock.sleep_sync)
    monkeypatch.setattr(A, "OW_THROTTLE", A.CallThrottle(A.OPENWEATHER_MAX_PER_MIN, 60.0))
    A._OW_CACHE.clear()
    A._OW_WANTED.clear()
    A._OW_FIRST.clear()
    A._OW_TASK["task"] = None
    for k in list(A.OPENWEATHER_STATUS):
        A.OPENWEATHER_STATUS[k] = None
    A.OPENWEATHER_STATUS["refresh_running"] = False
    A.OPENWEATHER_STATUS.pop("cooldown_ts", None)
    A._OM_CACHE.clear()
    A.OPEN_METEO_STATUS.pop("cooldown_ts", None)
    yield clock
    A._OW_CACHE.clear()
    A._OW_WANTED.clear()
    A._OW_FIRST.clear()
    A._OW_TASK["task"] = None
    A.OPENWEATHER_STATUS.pop("cooldown_ts", None)


def use(monkeypatch, handler):
    monkeypatch.setattr(A, "_ow_client_factory", lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    real = httpx.get
    client = httpx.Client(transport=httpx.MockTransport(handler))
    monkeypatch.setattr(A.httpx, "get", lambda url, params=None, timeout=None: client.get(url, params=params))
    return real


def pts(n):
    return [(8.0 + i * 0.07, 70.0 + i * 0.09) for i in range(n)]


def refresh(points):
    async def go():
        A.openweather_zones(points)                   # registers the points and starts the refresher
        t = A._OW_TASK["task"]
        if t:
            await t
        return A.openweather_zones(points)
    return asyncio.run(go())


def max_in_window(times, window=60.0):
    times = sorted(times)
    best, j = 0, 0
    for i, t in enumerate(times):
        while times[j] <= t - window:
            j += 1
        best = max(best, i - j + 1)
    return best


def test_success_uses_the_current_weather_endpoint_with_the_key_as_a_parameter(env, monkeypatch):
    ow = OW(env)
    use(monkeypatch, ow)
    out = refresh(pts(5))
    assert all(o and o["source"] == "openweather" for o in out)
    assert out[0]["observed_at"] == out[0]["data_time"] == "2026-09-21T14:13:20Z"
    assert out[0]["rainfall"] == 0.0 and out[0]["conditions"] == "Light rain"        # no 'rain' key -> 0
    path, params = ow.params[0]
    assert path == "/data/2.5/weather" and params["units"] == "metric" and params["appid"] == KEY
    assert A.OPENWEATHER_URL == "https://api.openweathermap.org/data/2.5/weather"
    assert len(ow.times) == 5
    # cached for >= 60 min: the next read makes no request
    refresh(pts(5))
    assert len(ow.times) == 5
    env.t += A.OPENWEATHER_TTL + 1
    refresh(pts(5))
    assert len(ow.times) == 10


def test_rain_is_the_last_hour_value_or_the_point_is_not_used():
    assert A.parse_openweather(ow_body(1, 2, rain=0.4))["rainfall"] == 0.4
    three_h = ow_body(1, 2)
    three_h["rain"] = {"3h": 6.0}
    assert A.parse_openweather(three_h) is None                                  # a 3 h sum is not "last hour"
    assert A.parse_openweather({"main": {"temp": 1}}) is None


def test_429_is_retried_with_retry_after_then_succeeds(env, monkeypatch):
    ow = OW(env, [429, 429, "ok"], retry_after=7)
    use(monkeypatch, ow)
    out = refresh(pts(1))
    assert out[0]["source"] == "openweather" and len(ow.times) == 3
    assert ow.times[1] - ow.times[0] >= 7 and ow.times[2] - ow.times[1] >= 7
    assert A.OPENWEATHER_STATUS["last_error"] == "HTTP 429: Your account is temporary blocked"   # OpenWeather: "message"
    assert A.OPENWEATHER_STATS["retries"] >= 2 and A.OPENWEATHER_STATUS["cooldown_until"] is None


def test_throttle_at_most_50_calls_in_any_60_s(env, monkeypatch):
    ow = OW(env)
    use(monkeypatch, ow)
    out = refresh(pts(380))                                                      # one full zone list
    assert all(o for o in out) and len(ow.times) == 380
    assert max_in_window(ow.times) <= 50
    assert ow.times[-1] - ow.times[0] >= 7 * 60                                   # 380 calls take > 7 min
    # sync callers (searches) share the same budget
    th = A.CallThrottle(50, 60.0)
    waits = [th.reserve(T0) for _ in range(120)]
    assert max_in_window([T0 + w for w in waits]) <= 50


def test_timeouts_keep_expired_data_as_stale_and_start_a_cooldown(env, monkeypatch):
    use(monkeypatch, OW(env))
    refresh(pts(3))
    env.t += A.OPENWEATHER_TTL + 1
    ow = OW(env, default="timeout")
    use(monkeypatch, ow)
    out = refresh(pts(3))
    assert len(ow.times) == 3                                                    # 1 + 2 retries, then stop
    assert all(o["source"] == "openweather" and o["stale"] is True for o in out)
    assert out[0]["data_time"] == "2026-09-21T14:13:20Z"                         # the real time, not now
    assert A.OPENWEATHER_STATUS["last_error"].startswith("ReadTimeout")
    assert A.OPENWEATHER_STATUS["cooldown_until"]
    # during the cooldown nothing is requested
    refresh(pts(3))
    assert len(ow.times) == 3


def test_all_fail_falls_back_to_open_meteo_then_sample(env, monkeypatch):
    import backend.main as M
    monkeypatch.setattr(M, "API_KEY", KEY)
    ow = OW(env, default=429, retry_after=3600)                                  # daily limit: no retry
    use(monkeypatch, ow)

    async def om_ok(points, client=None, now=None):
        return [A.parse_open_meteo(om_item(la, lo)) for la, lo in points]

    async def om_fail(points, client=None, now=None):
        return [None] * len(points)

    async def build():
        M._UNIFIED_ALERTS_CACHE.clear()
        d = await M.get_unified_alerts_dataset(limit=50)
        t = A._OW_TASK["task"]
        if t:
            await t
        return d

    monkeypatch.setattr(M, "async_fetch_open_meteo", om_ok)
    d = asyncio.run(build())
    assert d["summary"]["source"] == "open-meteo"                                # no OpenWeather data yet
    asyncio.run(build())                                                          # refresher: 429 -> cooldown
    assert len(ow.times) == 1 and A.OPENWEATHER_STATUS["cooldown_until"]
    d = asyncio.run(build())
    assert d["summary"]["zone_sources"]["open_meteo"] == 50 and len(ow.times) == 1
    monkeypatch.setattr(M, "async_fetch_open_meteo", om_fail)
    d = asyncio.run(build())
    assert d["summary"]["source"] == "sample" and d["summary"]["n_rated"] == 0
    M._UNIFIED_ALERTS_CACHE.clear()


def test_zone_list_with_openweather_data_and_the_badge_fields(env, monkeypatch):
    import backend.main as M
    monkeypatch.setattr(M, "API_KEY", KEY)
    use(monkeypatch, OW(env))

    async def om_fail(points, client=None, now=None):
        return [None] * len(points)
    monkeypatch.setattr(M, "async_fetch_open_meteo", om_fail)
    refresh([(l["lat"], l["lon"]) for l in M.get_sampled_locations(limit=75)][:30])

    async def build():
        M._UNIFIED_ALERTS_CACHE.clear()
        return await M.get_unified_alerts_dataset(limit=50)
    d = asyncio.run(build())
    s = d["summary"]
    zs = s["zone_sources"]
    assert zs["openweather"] > 0 and zs["sample"] > 0 and zs["openweather"] + zs["sample"] == 50
    assert s["source"] == "mixed"
    assert s["source_times"]["openweather"] == {"min": "2026-09-21T14:13:20Z", "max": "2026-09-21T14:13:20Z"}
    for a in d["alerts"]:
        if a["zone_source"] == "openweather":
            assert a["risk_level"] in ("LOW", "MODERATE", "HIGH")
        else:
            assert a["zone_source"] == "sample" and a["risk_level"] is None
    M._UNIFIED_ALERTS_CACHE.clear()
    A._OW_TASK["task"] = None


def test_search_point_falls_back_to_open_meteo_when_openweather_fails(env, monkeypatch):
    use(monkeypatch, OW(env, default=401))
    A.weather_cache.clear()
    monkeypatch.setattr(A, "fetch_open_meteo_point", lambda la, lo: A.parse_open_meteo(om_item(la, lo)))
    assert A.fetch_weather(25.5, 91.3, "X")["source"] == "open-meteo"
    A.weather_cache.clear()
    monkeypatch.setattr(A, "fetch_open_meteo_point", lambda la, lo: None)
    assert A.fetch_weather(25.6, 91.3, "Y")["source"] == "sample"


def test_weather_source_reports_openweather_errors_and_never_the_key(env, monkeypatch, capsys):
    import backend.main as M
    from fastapi.testclient import TestClient
    use(monkeypatch, OW(env, default="connect-with-key"))
    refresh(pts(1))
    out = capsys.readouterr().out
    body = TestClient(M.app).get("/weather_source").json()
    ow = body["openweather"]
    assert ow["last_error"].startswith("ConnectError: cannot connect to https://api.openweathermap.org/data/2.5/weather")
    assert "appid=***" in ow["last_error"] and ow["last_error_at"] and ow["cooldown_until"]
    assert ow["max_calls_per_min"] == 50 and ow["cache_s"] >= 3600 and "cooldown_ts" not in ow
    assert KEY not in json.dumps(body) and KEY not in out and KEY not in A.OPENWEATHER_STATUS["last_error"]


def test_warmup_with_a_key_does_not_burst(env, monkeypatch):
    import backend.main as M
    from fastapi.testclient import TestClient
    monkeypatch.setattr(M, "API_KEY", KEY)
    monkeypatch.setenv("WEATHER_WARMUP", "1")
    ow = OW(env)
    use(monkeypatch, ow)

    async def om_fail(points, client=None, now=None):
        return [None] * len(points)
    monkeypatch.setattr(M, "async_fetch_open_meteo", om_fail)
    M._UNIFIED_ALERTS_CACHE.clear()
    with TestClient(M.app) as c:
        assert c.get("/health").json()["status"] == "ok"
        for _ in range(200):                           # the simulated clock makes the refresh instant
            if len(ow.times) >= 380 and not A.OPENWEATHER_STATUS["refresh_running"]:
                break
            import time as _t
            _t.sleep(0.05)
    assert len(ow.times) == 380 and max_in_window(ow.times) <= 50
    M._UNIFIED_ALERTS_CACHE.clear()
    A._OW_TASK["task"] = None


def test_shown_zones_are_fetched_first_then_the_rest_and_380_zones_fill_in_7_min(env, monkeypatch):
    ow = OW(env)
    use(monkeypatch, ow)
    points = pts(380)
    shown = points[300:305]

    async def go():
        A.openweather_zones(points)                    # cold start: nothing cached, the refresher starts
        assert A.openweather_first(shown) == 5         # a page shows these 5 zones
        await A._OW_TASK["task"]
    asyncio.run(go())
    got = [(float(q["lat"]), float(q["lon"])) for _, q in ow.params]
    assert [A._om_key(*g) for g in got[:5]] == [A._om_key(*p) for p in shown]     # page order, before the rest
    assert len(got) == 380 and len(set(A._om_key(*g) for g in got)) == 380
    assert max_in_window(ow.times) <= 50
    # 380 zones at 50 calls/min: the last call 7 min after the first (slots at 0, 60, ..., 420 s)
    assert max(ow.times) - min(ow.times) == 420.0
    assert A.openweather_pending() == 0 and A.openweather_first(shown) == 0


def test_zones_first_endpoint_and_filling_fields(env, monkeypatch):
    import backend.main as M
    from fastapi.testclient import TestClient
    monkeypatch.setattr(M, "API_KEY", KEY)
    use(monkeypatch, OW(env))
    started = []
    monkeypatch.setattr(A, "_ow_start_refresh", lambda now: started.append(now) or False)
    c = TestClient(M.app)
    names = [l["city"] for l in M.get_sampled_locations(limit=405)[:3]]
    body = c.get("/zones/first", params={"names": "|".join(names + ["Not a zone"])}).json()
    assert body["queued"] == 3 and body["pending"] >= 3
    assert len(A._OW_FIRST) == 3 and len(started) == 1          # the refresher is (re)started for them
    assert M.openweather_filling() is True and M.unified_ttl() == M.UNIFIED_CACHE_TTL_FILLING
    monkeypatch.setattr(A, "API_KEY", None)
    monkeypatch.setattr(M, "API_KEY", None)
    assert c.get("/zones/first", params={"names": names[0]}).json() == {"queued": 0, "pending": 0}
    assert M.unified_ttl() == M.UNIFIED_CACHE_TTL


def test_terms_record_matches_the_limits():
    terms = json.loads((ROOT / "backend" / "assets" / "openweather_terms.json").read_text(encoding="utf-8"))
    facts = {f["topic"]: f for f in terms["facts"]}
    lim = facts["free tier limits (Current Weather API)"]["values"]
    assert A.OPENWEATHER_MAX_PER_MIN < lim["per_minute"]
    # worst case: every point of the 380 list and the 100 list (27 extra) refreshed every hour, all month
    assert (380 + 27) * 24 * 31 < lim["per_month"]
    assert facts["attribution line"]["quote"] == "Weather data © OpenWeather"
