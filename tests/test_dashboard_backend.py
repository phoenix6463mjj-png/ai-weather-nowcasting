"""Dashboard backend honesty checks (option A): no name-based randomness, weather source labelled, https.

Run from the team_app root:  D:\\.venv\\Scripts\\python.exe -m pytest tests -q
"""
import inspect
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from utils import api_fetcher  # noqa: E402
from utils.v2_predictor import compute_hybrid_risk  # noqa: E402

NAMES = ["Abohar", "Shillong", "Testplace Alpha", "Testplace Beta", "Mumbai", "Kochi", "Ranchi"]
WEATHERS = [  # (rainfall mm, wind m/s, temperature C, humidity %)
    (0.0, 2.0, 28.0, 55.0), (3.0, 6.5, 31.0, 82.0), (12.0, 9.0, 32.0, 88.0), (25.0, 11.0, 30.0, 93.0),
]


@pytest.mark.parametrize("state", ["Uttarakhand", "Meghalaya", "Kerala", "Unknown"])
def test_identical_weather_gives_identical_risk_for_any_place_name(state):
    ml = {"confidence": 0.62}
    for rain, wind, temp, hum in WEATHERS:
        out = [compute_hybrid_risk(rain, ml, wind, temp, hum, state, name) for name in NAMES
               if name.lower() not in ("shillong", "mumbai", "kochi")]          # listed region cities: see below
        ref = out[0]
        for o in out[1:]:
            assert o == ref, (state, rain, o, ref)
        # repeated calls are identical too
        assert compute_hybrid_risk(rain, ml, wind, temp, hum, state, "Testplace Alpha") == ref


def test_no_name_hash_left_in_the_risk_function():
    src = inspect.getsource(compute_hybrid_risk)
    assert "hashlib" not in src and "md5" not in src and "h %" not in src
    assert "%)" not in src                                                # no percentages in explanations


def test_named_region_cities_are_a_rule_not_randomness():
    # a city on the function's Northeast / coastal lists is classified by that list (a fixed rule): the
    # same name always gives the same result, and it no longer varies with a hash of the name
    ml = {"confidence": 0.62}
    a = compute_hybrid_risk(12.0, ml, 9.0, 32.0, 88.0, "Meghalaya", "Shillong")
    assert all(compute_hybrid_risk(12.0, ml, 9.0, 32.0, 88.0, "Meghalaya", "Shillong") == a for _ in range(3))


def test_weather_source_is_labelled_and_https_only(monkeypatch):
    monkeypatch.setattr(api_fetcher, "API_KEY", None)
    monkeypatch.setattr(api_fetcher, "fetch_open_meteo_point", lambda la, lo: None)   # no network; Open-Meteo "down"
    api_fetcher.weather_cache.clear()
    w = api_fetcher.fetch_weather(25.5, 91.3, "Anywhere")
    assert w["source"] == "sample" and w["observed_at"] is None
    src = Path(api_fetcher.__file__).read_text(encoding="utf-8")
    assert "http://api.openweathermap.org" not in src and "https://api.openweathermap.org" in src
    assert api_fetcher.observed_at({"dt": 1722450600}) == "2024-07-31T18:30:00Z"
    assert api_fetcher.observed_at({}) is None


def test_zone_list_cache_is_30_min_with_a_key():
    main_src = (ROOT / "backend" / "main.py").read_text(encoding="utf-8")
    assert "UNIFIED_CACHE_TTL = 1800.0 if is_valid_api_key(API_KEY) else 300.0" in main_src
