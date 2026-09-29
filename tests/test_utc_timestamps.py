"""The team backend emits timezone-aware UTC ISO times ("...Z"), whatever the server's time zone.

The same frozen instant is run in two subprocesses, one with the server in UTC and one in India time
(Asia/Kolkata; on Windows the CRT form IST-5:30). The local clock differs between them (checked), and
every emitted timestamp is identical and ends in Z. Sample weather only (no network)."""
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ZONES = ("UTC0", "IST-5:30") if os.name == "nt" else ("UTC", "Asia/Kolkata")
FIXED = 1790792882          # 2026-09-30T18:28:02Z

PROBE = r"""
import asyncio, json, sys, time
from datetime import datetime
sys.path.insert(0, sys.argv[1])
if hasattr(time, "tzset"):
    time.tzset()
import backend.main as M

FIXED = int(sys.argv[2])

class Frozen(datetime):
    @classmethod
    def now(cls, tz=None):
        return datetime.fromtimestamp(FIXED, tz)

M.datetime = Frozen
M.API_KEY = None
d = asyncio.run(M.get_unified_alerts_dataset(limit=3))
legacy = M.generate_alerts([{"city": "X", "risk_level": "HIGH", "rainfall": 30.0, "wind_speed": 13.0}])
print(json.dumps({
    "local_clock": datetime.fromtimestamp(FIXED).isoformat(),
    "utc_now_iso": M.utc_now_iso(),
    "last_updated": d["last_updated"],
    "alert_timestamps": sorted({a["timestamp"] for a in d["alerts"]}),
    "legacy_alert_timestamps": sorted({a["timestamp"] for a in legacy}),
}))
"""


def _run(tz):
    env = {**os.environ, "TZ": tz, "OPEN_METEO_DISABLED": "1", "OPENWEATHER_API_KEY": ""}
    out = subprocess.run([sys.executable, "-c", PROBE, str(ROOT), str(FIXED)], env=env, cwd=ROOT,
                         capture_output=True, text=True, timeout=300)
    assert out.returncode == 0, out.stderr[-2000:]
    return json.loads(out.stdout.strip().splitlines()[-1])


def test_same_utc_output_with_server_in_utc_and_in_india():
    utc, ist = (_run(tz) for tz in ZONES)
    assert utc["local_clock"] != ist["local_clock"]                   # the TZ setting took effect
    for r in (utc, ist):
        assert r["utc_now_iso"] == "2026-09-30T18:28:02Z"
        assert r["last_updated"] == r["utc_now_iso"]
        assert r["alert_timestamps"] == r["legacy_alert_timestamps"] == ["2026-09-30T18:28:02Z"]
    assert {k: v for k, v in utc.items() if k != "local_clock"} == {k: v for k, v in ist.items() if k != "local_clock"}
