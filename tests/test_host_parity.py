"""Host parity: every ML-API path the frontend calls must answer with the same HTTP status on the hosted
package (hosting/space, host environment, no rasterio) as on the full local app. Each app runs in its own
subprocess (tests/host_parity_probe.py). Skipped when hosting/space has not been built."""
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SPACE = ROOT / "hosting" / "space"
NOWCAST = Path(os.environ.get("NOWCAST_DATA_ROOT") or ROOT.parent / "nowcast_data")
PROBE = ROOT / "tests" / "host_parity_probe.py"


def _run(*args):
    out = subprocess.run([sys.executable, str(PROBE), *map(str, args)], capture_output=True, text=True,
                         timeout=1800, encoding="utf-8")
    assert out.returncode == 0, out.stderr[-3000:]
    line = next(l for l in out.stdout.splitlines() if l.startswith("PARITY_JSON "))
    return json.loads(line[len("PARITY_JSON "):])


@pytest.mark.skipif(not (SPACE / "team_app" / "backend" / "host_app.py").is_file(), reason="hosting/space not built")
def test_every_frontend_ml_path_has_the_same_status_on_the_host_package(tmp_path):
    full = _run("full", NOWCAST)
    assert len(full) > 500
    paths = tmp_path / "paths.json"
    paths.write_text(json.dumps(list(full)), encoding="utf-8")
    host = _run("host", SPACE, paths)
    diff = {p: (full[p][0], host[p][0]) for p in full if full[p][0] != host[p][0]}
    assert not diff, f"{len(diff)} paths differ (full, host): {dict(list(diff.items())[:20])}"
    # nothing the frontend shows fails on either side
    assert not [p for p, v in full.items() if v[0] >= 500]
    (ROOT / "e2e" / "screenshots" / "host_parity_probe.json").write_text(   # gitignored
        json.dumps({"full": full, "host": host}, indent=0), encoding="utf-8")
