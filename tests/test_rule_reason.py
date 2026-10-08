"""Rule reason wording (8 Oct 2026): every reason names the rule that fired, with the existing thresholds,
and never says "observed" / "detected". Forced MODERATE / HIGH / LOW zone lists (Open-Meteo mocked), so the
result does not depend on the day's weather. No network is used."""
import asyncio
import itertools
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from utils import api_fetcher as A  # noqa: E402
import backend.main as M  # noqa: E402

THRESHOLDS = {"20", "5", "70", "90", "8", "6", "10"}       # the team's existing rule thresholds
BANNED = re.compile(r"\b(observed|detected)\b", re.I)


def om_item(lat, lon, hum, wind, rain):
    return {"latitude": lat, "longitude": lon,
            "current": {"time": "2026-10-08T06:15", "interval": 900, "temperature_2m": 27.0, "relative_humidity_2m": hum,
                        "wind_speed_10m": wind, "weather_code": 61, "pressure_msl": 1006.0},
            "hourly": {"time": ["2026-10-08T06:00", "2026-10-08T07:00"], "precipitation": [rain, 0.0]}}


def zone_list(monkeypatch, hum, wind, rain, n=20):
    monkeypatch.setattr(M, "API_KEY", None)
    monkeypatch.setattr(A, "OPEN_METEO_ENABLED", True)

    async def fake(points, client=None, now=None):
        return [A.parse_open_meteo(om_item(la, lo, hum, wind, rain)) for la, lo in points]
    monkeypatch.setattr(M, "async_fetch_open_meteo", fake)
    M._UNIFIED_ALERTS_CACHE.clear()
    try:
        return asyncio.run(M.get_unified_alerts_dataset(limit=n))["alerts"]
    finally:
        M._UNIFIED_ALERTS_CACHE.clear()


@pytest.mark.parametrize("hum,wind,rain,level,reason,fired", [
    # MODERATE from the humidity rule alone (the usual case): no rain, so the flash-flood note follows
    (80.0, 3.0, 0.0, "MODERATE", "Rule-based Moderate: humidity above 70 %; flash flood Low (no rain in the last hour)",
     ["Humidity above 70 %"]),
    (50.0, 3.0, 7.0, "MODERATE", "Rule-based Moderate: rain above 5 mm in the last hour", ["Rain above 5 mm in the last hour"]),
    (50.0, 3.0, 24.0, "HIGH", "Rule-based High: rain above 20 mm in the last hour", ["Rain above 20 mm in the last hour"]),
    (95.0, 9.0, 0.4, "HIGH", "Rule-based High: humidity above 90 % with wind above 8 m/s", ["Humidity above 90 % with wind above 8 m/s"]),
    (40.0, 2.0, 0.5, "LOW", "Rule-based Low: no rule fired", []),
])
def test_forced_zone_list_reason_names_the_rule_that_fired(monkeypatch, hum, wind, rain, level, reason, fired):
    zones = zone_list(monkeypatch, hum, wind, rain)
    assert zones and all(z["zone_source"] == "open_meteo" for z in zones)
    for z in zones:
        assert z["risk_level"] == level
        assert z["reason"] == reason
        assert z["prediction"]["reason"] == reason
        assert z["rules_fired"] == fired
        assert not BANNED.search(z["reason"]) and not BANNED.search(z.get("action") or "")


def numbers(text):
    return set(re.findall(r"\d+(?:\.\d+)?", text))


def test_every_reason_on_a_grid_lists_only_fired_rules_with_existing_thresholds():
    seen = set()
    for hum, wind, rain in itertools.product([40, 71, 85, 91, 99], [0, 5, 7, 9, 11], [0, 0.5, 6, 21, 30]):
        f = M.engineer_features({"humidity": hum, "wind_speed": wind, "rainfall": rain, "temperature": 28})
        risk = M.predict_nowcast(f)["risk_level"]
        fired = M.rules_fired(f, risk)
        r = M.rule_reason(risk, fired)
        assert r.startswith(f"Rule-based {risk.capitalize()}: ")
        assert (r == "Rule-based Low: no rule fired") == (not fired)
        assert risk == "LOW" or fired                               # a MODERATE / HIGH level always names its rule
        assert not BANNED.search(r)
        assert numbers(r) <= THRESHOLDS, r
        alert = M.generate_actionable_alert(risk, rain, hum, wind)
        assert not BANNED.search(alert["action"]) and not BANNED.search(alert["type"])
        seen.add(r)
    assert len(seen) > 5


def test_predict_reason_uses_its_own_rules_and_says_when_the_combined_score_raised_the_level():
    # /predict levels: calculate_rule_risk (HIGH: rain > 20, humidity > 90, wind > 10; MODERATE: rain > 5, humidity > 70)
    assert M.calculate_rules_fired(0.0, 92.0, 11.0, "HIGH") == ["Humidity above 90 %", "Wind above 10 m/s"]
    assert M.calculate_rules_fired(6.0, 75.0, 3.0, "MODERATE") == ["Rain above 5 mm in the last hour", "Humidity above 70 %"]
    lvl, _ = M.calculate_rule_risk(0.0, 75.0, 3.0)
    assert M.rule_reason(lvl, M.calculate_rules_fired(0.0, 75.0, 3.0, lvl)) == "Rule-based Moderate: humidity above 70 %"
    # the hybrid score raised the level above the rules: no rule is named for that level
    assert M.rule_reason("HIGH", [], "MODERATE", ["Humidity above 70 %"]) == \
        "High from the team's combined weather score; the rules alone give Moderate: humidity above 70 %"
    assert M.rule_reason("MODERATE", [], "LOW", []) == \
        "Moderate from the team's combined weather score; the rules alone give Low (no rule fired)"


def test_no_observed_or_detected_wording_left_in_the_rule_texts():
    src = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")
    for old in ("Moderate convective indicators observed", "Severe atmospheric instability detected",
                "Heavy rainfall indicates flood risk", "High humidity supports storm formation",
                "Strong wind indicates thunderstorm", "Normal atmospheric conditions", "indicators observed"):
        assert old not in src
    assert "rainfall detected" not in (ROOT / "utils" / "v2_predictor.py").read_text(encoding="utf-8")
    assert "risk detected" not in (ROOT / "utils" / "alert_system.py").read_text(encoding="utf-8-sig")
