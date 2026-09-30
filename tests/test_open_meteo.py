"""Open-Meteo weather source: batching, cache, fallback to sample, source order, identical weather ->
identical risk. All HTTP is mocked (httpx.MockTransport); no network is used."""
import asyncio
import json
import sys
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from utils import api_fetcher as A  # noqa: E402

T0 = 1_790_000_000.0


def om_item(lat, lon, temp=27.0, hum=80.0, wind=3.0, rain=1.2, code=61):
    return {"latitude": lat, "longitude": lon,
            "current": {"time": "2026-09-29T13:45", "interval": 900, "temperature_2m": temp, "relative_humidity_2m": hum,
                        "wind_speed_10m": wind, "weather_code": code, "pressure_msl": 1006.0},
            "hourly": {"time": ["2026-09-29T13:00", "2026-09-29T14:00"], "precipitation": [rain, 9.9]}}


class Recorder:
    def __init__(self, fail=False):
        self.calls, self.fail = [], fail

    def __call__(self, request: httpx.Request):
        q = request.url.params
        lats, lons = q["latitude"].split(","), q["longitude"].split(",")
        self.calls.append({"n": len(lats), "params": dict(q), "scheme": request.url.scheme})
        if self.fail:
            return httpx.Response(503, text="unavailable")
        body = [om_item(float(a), float(b)) for a, b in zip(lats, lons)]
        return httpx.Response(200, json=body if len(body) > 1 else body[0])


def run(points, rec, now=T0):
    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(rec)) as c:
            return await A.async_fetch_open_meteo(points, client=c, now=now)
    return asyncio.run(go())


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    A._OM_CACHE.clear()
    monkeypatch.setattr(A, "OPEN_METEO_ENABLED", True)
    yield
    A._OM_CACHE.clear()


def pts(n):
    return [(8.0 + i * 0.07, 70.0 + i * 0.09) for i in range(n)]


def test_batching_respects_the_per_request_maximum_and_https():
    rec = Recorder()
    out = run(pts(250), rec)
    assert [c["n"] for c in rec.calls] == [100, 100, 50]          # OPEN_METEO_BATCH = 100 (Open-Meteo max 1000)
    assert all(c["scheme"] == "https" for c in rec.calls)
    assert A.OPEN_METEO_URL.startswith("https://")
    p = rec.calls[0]["params"]
    assert p["wind_speed_unit"] == "ms" and p["hourly"] == "precipitation" and p["timezone"] == "GMT"
    assert all(o and o["source"] == "open-meteo" for o in out)
    assert out[0]["rainfall"] == 1.2                             # preceding-hour sum at 13:00 <= current 13:45
    assert out[0]["data_time"] == "2026-09-29T13:45Z" and out[0]["observed_at"] is None
    assert out[0]["conditions"] == "Slight rain"
    terms = json.loads((ROOT / "backend" / "assets" / "open_meteo_terms.json").read_text(encoding="utf-8"))
    mx = next(f for f in terms["facts"] if f["topic"] == "maximum locations per request")["values"]
    assert A.OPEN_METEO_BATCH == mx["used_batch_size"] <= mx["max_locations"]


def test_cache_for_at_least_30_minutes_then_refetch():
    assert A.OPEN_METEO_TTL >= 1800
    rec = Recorder()
    run(pts(120), rec)
    assert len(rec.calls) == 2
    run(pts(120), rec, now=T0 + 1799)                            # within the TTL: no request
    assert len(rec.calls) == 2
    run(pts(120), rec, now=T0 + A.OPEN_METEO_TTL + 1)            # expired: fetched again
    assert len(rec.calls) == 4


def test_any_error_leaves_points_empty_so_the_caller_uses_sample_data():
    out = run(pts(30), Recorder(fail=True))
    assert out == [None] * 30
    assert A._OM_CACHE == {}                                     # failures are not cached
    # malformed items (missing values) -> None, not a guess
    assert A.parse_open_meteo({"current": {"time": "2026-09-29T13:45"}}) is None
    bad = om_item(1, 2)
    bad["hourly"] = {"time": [], "precipitation": []}
    assert A.parse_open_meteo(bad) is None


def test_source_order_openweather_then_open_meteo_then_sample(monkeypatch):
    A.weather_cache.clear()
    # no key + Open-Meteo answers -> open-meteo
    monkeypatch.setattr(A, "API_KEY", None)
    monkeypatch.setattr(A, "fetch_open_meteo_point", lambda la, lo: A.parse_open_meteo(om_item(la, lo)))
    assert A.fetch_weather(25.5, 91.3, "X")["source"] == "open-meteo"
    # no key + Open-Meteo fails -> sample
    A.weather_cache.clear()
    monkeypatch.setattr(A, "fetch_open_meteo_point", lambda la, lo: None)
    assert A.fetch_weather(25.5, 91.3, "X")["source"] == "sample"
    # a key is set -> OpenWeather is tried first (mocked), Open-Meteo is not called
    A.weather_cache.clear()
    monkeypatch.setattr(A, "API_KEY", "k" * 32)
    called = []
    monkeypatch.setattr(A, "fetch_open_meteo_point", lambda la, lo: called.append(1))

    class R:
        status_code = 200

        @staticmethod
        def json():
            return {"dt": 1790000000, "main": {"temp": 30, "humidity": 60, "pressure": 1008}, "wind": {"speed": 2}}
    monkeypatch.setattr(A.requests, "get", lambda url, timeout=None: R())
    w = A.fetch_weather(25.5, 91.3, "Y")
    assert w["source"] == "openweather" and not called


def test_zone_list_falls_back_to_sample_when_open_meteo_fails(monkeypatch):
    import backend.main as M
    monkeypatch.setattr(M, "API_KEY", None)

    async def failing(points, client=None, now=None):
        return [None] * len(points)
    monkeypatch.setattr(M, "async_fetch_open_meteo", failing)
    M._UNIFIED_ALERTS_CACHE.clear()
    d = asyncio.run(M.get_unified_alerts_dataset(limit=50))
    assert d["summary"]["source"] == "sample" and d["summary"]["data_time"] is None

    async def ok(points, client=None, now=None):
        return [A.parse_open_meteo(om_item(la, lo)) for la, lo in points]
    monkeypatch.setattr(M, "async_fetch_open_meteo", ok)
    M._UNIFIED_ALERTS_CACHE.clear()
    d = asyncio.run(M.get_unified_alerts_dataset(limit=50))
    assert d["summary"]["source"] == "open-meteo" and d["summary"]["data_time"] == "2026-09-29T13:45Z"
    assert all(a["weather"]["conditions"] == "Slight rain" for a in d["alerts"])
    M._UNIFIED_ALERTS_CACHE.clear()


def test_identical_open_meteo_weather_gives_identical_rule_risk():
    import backend.main as M
    w = A.parse_open_meteo(om_item(1, 2, temp=31, hum=88, wind=9.5, rain=12.0))
    res = []
    for name in ("Place A", "Place B", "Shillong"):
        f = M.engineer_features({**w, "city": name, "lat": 1, "lon": 2})
        res.append((M.predict_nowcast(f), M.generate_explainable_reason(w["rainfall"], w["humidity"], w["wind_speed"])))
    assert res[0] == res[1] == res[2]


# ---- retries, stale data, cooldown and diagnostics (Render: 4 requests, 4 errors -> sample) ----

@pytest.fixture
def no_sleep(monkeypatch):
    waits = []

    async def fake_sleep(s):
        waits.append(s)
    monkeypatch.setattr(A, "_om_sleep", fake_sleep)
    for k in A.OPEN_METEO_STATUS:
        A.OPEN_METEO_STATUS[k] = None
    A.OPEN_METEO_STATUS.pop("cooldown_ts", None)
    yield waits
    A.OPEN_METEO_STATUS.pop("cooldown_ts", None)


class Script(Recorder):
    """Answers each request with the next scripted outcome: 'ok', an int status, or 'timeout'."""

    def __init__(self, outcomes, retry_after=None):
        super().__init__()
        self.outcomes, self.retry_after = list(outcomes), retry_after

    def __call__(self, request):
        o = self.outcomes.pop(0) if self.outcomes else "ok"
        if o == "timeout":
            self.calls.append({"n": 0})
            raise httpx.ReadTimeout("timed out", request=request)
        if o == "ok":
            return super().__call__(request)
        self.calls.append({"n": 0})
        h = {"Retry-After": str(self.retry_after)} if self.retry_after is not None else {}
        return httpx.Response(o, headers=h, json={"error": True, "reason": "Minutely API request limit exceeded"})


def test_timeout_is_25_s_and_429_is_retried_with_retry_after_then_succeeds(no_sleep):
    assert A.OPEN_METEO_TIMEOUT == 25.0 and A.OPEN_METEO_RETRIES == 2
    rec = Script([429, 429, "ok"], retry_after=7)
    out = run(pts(20), rec)
    assert len(rec.calls) == 3 and no_sleep == [7.0, 7.0]         # Retry-After respected
    assert all(o and o["source"] == "open-meteo" and not o.get("stale") for o in out)
    assert A.OPEN_METEO_STATUS["last_error"] == "HTTP 429: Minutely API request limit exceeded"
    assert A.OPEN_METEO_STATUS["last_success_at"] and A.OPEN_METEO_STATUS["cooldown_until"] is None


def test_429_without_retry_after_uses_backoff_and_a_long_retry_after_is_not_waited(no_sleep):
    run(pts(5), Script([429, "ok"]))
    assert no_sleep == [A.OPEN_METEO_BACKOFF]
    no_sleep.clear()
    rec = Script([429], retry_after=3600)                        # daily limit: give up at once
    other = [(20.0 + i * 0.1, 80.0) for i in range(5)]           # not cached by the call above
    assert run(other, rec) == [None] * 5 and len(rec.calls) == 1 and no_sleep == []


def test_other_http_errors_are_not_retried(no_sleep):
    rec = Script([503])
    assert run(pts(5), rec) == [None] * 5 and len(rec.calls) == 1
    assert A.OPEN_METEO_STATUS["last_error"].startswith("HTTP 503")


def test_timeouts_keep_the_last_successful_data_labelled_stale_with_its_real_time(no_sleep):
    P = pts(120)
    run(P, Recorder())                                           # fresh data at T0
    rec = Script(["timeout"] * 3)
    out = run(P, rec, now=T0 + A.OPEN_METEO_TTL + 5)             # expired -> refetch -> times out 3x
    assert len(rec.calls) == 3                                   # 1 + 2 retries; the 2nd batch is not sent
    assert no_sleep == [A.OPEN_METEO_BACKOFF, 2 * A.OPEN_METEO_BACKOFF]
    assert all(o and o["source"] == "open-meteo" and o["stale"] is True for o in out)
    assert out[0]["data_time"] == "2026-09-29T13:45Z"            # the real model time, not "now"
    assert A.OPEN_METEO_STATUS["last_error"].startswith("ReadTimeout")
    assert A.OPEN_METEO_STATUS["cooldown_until"]


def test_cooldown_after_a_failure_sends_no_requests(no_sleep):
    run(pts(5), Script([503]))
    rec = Recorder()
    assert run(pts(5), rec, now=T0 + 60) == [None] * 5 and rec.calls == []
    run(pts(5), rec, now=T0 + A.OPEN_METEO_COOLDOWN + 1)
    assert len(rec.calls) == 1


def test_everything_fails_zone_list_is_sample_and_weather_source_exposes_last_error(no_sleep, monkeypatch):
    import backend.main as M
    from fastapi.testclient import TestClient
    monkeypatch.setattr(M, "API_KEY", None)
    real = A.async_fetch_open_meteo

    async def failing(points, client=None, now=None):
        async with httpx.AsyncClient(transport=httpx.MockTransport(Script(["timeout"] * 9))) as c:
            return await real(points, client=c, now=T0)
    monkeypatch.setattr(M, "async_fetch_open_meteo", failing)
    M._UNIFIED_ALERTS_CACHE.clear()
    d = asyncio.run(M.get_unified_alerts_dataset(limit=50))
    assert d["summary"]["source"] == "sample" and d["summary"]["stale"] is False
    om = TestClient(M.app).get("/weather_source").json()["open_meteo"]
    assert om["last_error"] == "ReadTimeout: timed out" and om["last_error_at"].endswith("Z")
    assert om["errors"] >= 3 and "cooldown_ts" not in om
    M._UNIFIED_ALERTS_CACHE.clear()


def test_zone_list_marks_stale_open_meteo_data(monkeypatch):
    import backend.main as M
    monkeypatch.setattr(M, "API_KEY", None)

    async def stale(points, client=None, now=None):
        return [{**A.parse_open_meteo(om_item(la, lo)), "stale": True} for la, lo in points]
    monkeypatch.setattr(M, "async_fetch_open_meteo", stale)
    M._UNIFIED_ALERTS_CACHE.clear()
    d = asyncio.run(M.get_unified_alerts_dataset(limit=50))
    assert d["summary"]["source"] == "open-meteo" and d["summary"]["stale"] is True
    assert d["summary"]["data_time"] == "2026-09-29T13:45Z" and d["alerts"][0]["weather"]["stale"] is True
    M._UNIFIED_ALERTS_CACHE.clear()


def test_startup_warmup_runs_in_the_background_and_health_does_not_wait(monkeypatch):
    import backend.main as M
    from fastapi.testclient import TestClient
    monkeypatch.setattr(M, "API_KEY", None)
    monkeypatch.setenv("WEATHER_WARMUP", "1")
    started = []

    async def slow(limit=380):
        started.append(limit)
        await asyncio.sleep(30)
    monkeypatch.setattr(M, "get_unified_alerts_dataset", slow)
    with TestClient(M.app) as c:
        import time as _t
        t = _t.time()
        assert c.get("/health").json()["status"] == "ok"
        assert _t.time() - t < 5
    assert started == [380]


# ---- mixed zone lists: sample zones carry no risk and are left out of the counts ----

def test_mixed_list_sample_zones_have_no_risk_and_are_excluded_from_counts(monkeypatch):
    import backend.main as M
    monkeypatch.setattr(M, "API_KEY", None)

    async def mixed(points, client=None, now=None):
        out = []
        for k, (la, lo) in enumerate(points):
            w = A.parse_open_meteo(om_item(la, lo, hum=95.0, wind=9.0, rain=24.0))     # HIGH weather everywhere
            out.append(None if k % 3 == 0 else ({**w, "stale": True} if k % 3 == 1 else w))
        return out
    monkeypatch.setattr(M, "async_fetch_open_meteo", mixed)
    M._UNIFIED_ALERTS_CACHE.clear()
    d = asyncio.run(M.get_unified_alerts_dataset(limit=60))
    M._UNIFIED_ALERTS_CACHE.clear()
    s, alerts = d["summary"], d["alerts"]
    sample = [a for a in alerts if a["zone_source"] == "sample"]
    rated = [a for a in alerts if a["zone_source"] != "sample"]
    assert len(sample) == 20 and len(rated) == 40
    for a in sample:                                   # the sample fallback gives ~13 % HIGH values: none shown
        assert a["source"] == "sample" and a["weather"]["source"] == "sample"
        assert a["risk_level"] is None and a["risk"] is None and a["severity"] is None
        assert a["prediction"] is None and a["probabilities"] is None and a["alert"] is None
        assert a["rules_fired"] == [] and a["reason"] is None and a["type"] is None
        assert a["message"] == "Sample data — risk not shown"
    assert {a["risk_level"] for a in rated} == {"HIGH"}
    assert s["source"] == "mixed" and s["total"] == 60
    assert s["high"] == 40 and s["moderate"] == 0 and s["low"] == 0 and s["n_rated"] == 40
    assert s["n_sample"] == 20
    assert s["zone_sources"] == {"openweather": 0, "open_meteo": 20, "open_meteo_stale": 20, "sample": 20}
    assert all(a["zone_source"] == "sample" for a in alerts[-20:])      # listed after every rated zone
    assert s["data_time"] == s["data_time_min"] == "2026-09-29T13:45Z"


def test_all_sample_list_has_no_risk_at_all(monkeypatch):
    import backend.main as M
    monkeypatch.setattr(M, "API_KEY", None)

    async def failing(points, client=None, now=None):
        return [None] * len(points)
    monkeypatch.setattr(M, "async_fetch_open_meteo", failing)
    M._UNIFIED_ALERTS_CACHE.clear()
    d = asyncio.run(M.get_unified_alerts_dataset(limit=380))
    M._UNIFIED_ALERTS_CACHE.clear()
    s = d["summary"]
    assert s["source"] == "sample" and s["total"] == 380 and s["n_rated"] == 0
    assert s["high"] == s["moderate"] == s["low"] == 0
    assert all(a["risk_level"] is None and a["prediction"] is None for a in d["alerts"])
