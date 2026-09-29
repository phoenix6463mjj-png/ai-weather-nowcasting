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
