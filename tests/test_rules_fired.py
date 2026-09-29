"""/alerts lists the predict_nowcast rule(s) that put each zone at its level (Alerts card reason sentence).
Open-Meteo is mocked; no network."""
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import backend.main as M  # noqa: E402
from tests.test_flash_flood_gate import _zones  # noqa: E402


@pytest.mark.parametrize("weather,risk,fired", [
    (dict(hum=84.0, wind=1.8, rain=0.0), "MODERATE", ["Humidity above 70 %"]),              # Mumbai-like
    (dict(hum=50.0, wind=1.8, rain=6.0), "MODERATE", ["Rain above 5 mm in the last hour"]),
    (dict(hum=50.0, wind=7.0, rain=0.0), "MODERATE", ["Wind above 6 m/s"]),
    (dict(hum=75.0, wind=7.0, rain=6.0), "MODERATE",
     ["Rain above 5 mm in the last hour", "Humidity above 70 %", "Wind above 6 m/s"]),
    (dict(hum=95.0, wind=9.0, rain=0.0), "HIGH", ["Humidity above 90 % with wind above 8 m/s"]),
    (dict(hum=60.0, wind=2.0, rain=24.0), "HIGH", ["Rain above 20 mm in the last hour"]),
    (dict(hum=50.0, wind=2.0, rain=0.0), "LOW", []),
])
def test_rules_fired_per_zone(monkeypatch, weather, risk, fired):
    d = _zones(monkeypatch, **weather)
    for a in d["alerts"]:
        assert a["risk_level"] == risk
        assert a["rules_fired"] == fired


def test_every_non_low_level_has_a_rule():
    # the rule list mirrors predict_nowcast: a HIGH/MODERATE result always names at least one rule
    for rain in (0.0, 5.1, 20.1, 25.1):
        for hum in (50.0, 70.1, 90.1):
            for wind in (1.0, 6.1, 8.1, 10.1):
                f = {"rainfall": rain, "humidity": hum, "wind_speed": wind}
                risk = M.predict_nowcast(f)["risk_level"]
                assert bool(M.rules_fired(f, risk)) == (risk != "LOW"), (f, risk)
