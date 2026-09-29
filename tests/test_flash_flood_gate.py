"""Team rule change (calm-down fix): with 0 mm rain in the last hour the flash-flood indicator cannot be
above Low, and the explanation says "(no rain in the last hour)". The humidity rule (and so the zone's
risk level) is unchanged. Open-Meteo is mocked; no network."""
import asyncio
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from utils import api_fetcher as A  # noqa: E402
import backend.main as M  # noqa: E402
from tests.test_open_meteo import om_item  # noqa: E402

UI_MODERATE_CUT = 0.40          # frontend dashboardRisk.hazardLevels: >= 0.40 is Moderate


def test_gate_function():
    assert M.flash_flood_gate(0.0, 0.45, "Moderate convective indicators observed") == (
        0.08, "Moderate convective indicators observed; flash flood Low (no rain in the last hour)", "no rain in the last hour")
    assert M.flash_flood_gate(0.04, 0.85, "r")[0] == 0.08            # shown as 0.0 mm -> gated
    assert M.flash_flood_gate(0.1, 0.45, "r") == (0.45, "r", None)     # any rain -> unchanged
    assert M.flash_flood_gate(None, 0.45, "r")[0] == 0.08


def _zones(monkeypatch, **weather):
    monkeypatch.setattr(M, "API_KEY", None)

    async def om(points, client=None, now=None):
        return [A.parse_open_meteo(om_item(la, lo, **weather)) for la, lo in points]
    monkeypatch.setattr(M, "async_fetch_open_meteo", om)
    M._UNIFIED_ALERTS_CACHE.clear()
    try:
        return asyncio.run(M.get_unified_alerts_dataset(limit=20))
    finally:
        M._UNIFIED_ALERTS_CACHE.clear()


def test_no_rain_humid_zone_stays_moderate_but_flash_flood_is_low(monkeypatch):
    d = _zones(monkeypatch, hum=84.0, wind=1.8, rain=0.0)            # Mumbai-like: humidity rule only
    for a in d["alerts"]:
        assert a["risk_level"] == "MODERATE"                          # humidity rule unchanged
        assert a["prediction"]["prob_flood"] == a["probabilities"]["flash_flood"] == 0.08 < UI_MODERATE_CUT
        assert a["prediction"]["flood_note"] == "no rain in the last hour"
        assert a["reason"].endswith("(no rain in the last hour)") and a["prediction"]["reason"] == a["reason"]
        assert a["prediction"]["prob_thunderstorm"] == 0.40 and a["prediction"]["prob_cloudburst"] == 0.35


def test_high_zone_without_rain_has_low_flash_flood(monkeypatch):
    d = _zones(monkeypatch, hum=95.0, wind=9.0, rain=0.0)
    assert {a["risk_level"] for a in d["alerts"]} == {"HIGH"}
    assert all(a["prediction"]["prob_flood"] == 0.08 and a["prediction"]["flood_note"] for a in d["alerts"])


@pytest.mark.parametrize("rain,expect", [(1.2, 0.45), (6.0, 0.45)])
def test_rain_leaves_flash_flood_unchanged(monkeypatch, rain, expect):
    d = _zones(monkeypatch, hum=84.0, wind=1.8, rain=rain)
    for a in d["alerts"]:
        assert a["prediction"]["prob_flood"] == expect and a["prediction"]["flood_note"] is None
        assert "no rain" not in a["reason"]
