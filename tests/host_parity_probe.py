"""Subprocess helper for tests/test_host_parity.py: request every ML-API path the frontend calls
(services/nowcastApi.js) from ONE app and print {path: [status, bytes, seconds]} as JSON.

    python tests/host_parity_probe.py full <nowcast_data>            -> discovers the path list itself
    python tests/host_parity_probe.py host <space folder> <paths.json> -> the same paths on the host app

`full` = nowcast_data/serve (the local ML API, reached by the frontend through /ml -> /api).
`host` = hosting/space/team_app backend.host_app (one process, ML API mounted at /ml), with the host's
environment (PORT=10000, ML_REPLAY_ENABLED=0) and rasterio made unimportable, as in the container
(requirements-host.txt has no rasterio).
"""
import json
import os
import sys
import time
from pathlib import Path

LEADS = [1, 2, 3, 4, 6]
FIELDS = ["thunderstorm", "cloudburst_index", "flash_flood", "rain_p10", "rain_p1", "rain_p30"]


def discover(get):
    paths = ["health", "episodes", "caveats", "credits", "results", "approach", "terrain", "insat",
             "replay/status", "india/meta", "live", "shelters", "live-insat", "analytics", "cap/approvals", "cap/feed.atom"]
    lay = get("live-insat").json()                        # live INSAT: the latest frame only (the host ships one snapshot)
    if lay.get("available"):
        paths.append(f"live-insat/frames/{lay['latest']['id']}.png")
    # nearby shelter options: inside the covered states (Pipalkoti, Malana) and outside (Mumbai)
    pts = ["lat=30.4335&lon=79.4284", "lat=32.0618&lon=77.2600", "lat=19.0700&lon=72.8800"]
    # 3D view terrain blocks (25 / 50 km half-width) inside the covered states, and outside them
    paths += [f"shelters/terrain?{p}" for p in pts] + [f"shelters/terrain?{pts[0]}&half_km=50"]
    for layer in get("terrain").json()["layers"]:
        paths.append(f"terrain/{layer}.png")
    paths += [f"india/map/{L}/{f}.png" for L in LEADS for f in FIELDS]
    for r in get("live").json()["runs"]:
        run = r["run"]
        paths += [f"live/{run}/meta", f"live/{run}/ui-alerts?level=all", f"live/{run}/alerts.cap.xml"]
        paths += [f"live/{run}/map/{L}/{f}.png" for L in LEADS for f in FIELDS]
        paths += [f"live/{run}/shelters?{p}" for p in pts]
        paths.append(f"live/{run}/insat")
    eps = get("episodes").json()
    for e in (eps["episodes"] if isinstance(eps, dict) else eps):
        ep = e["episode"]
        paths += [f"episodes/{ep}/event-check", f"episodes/{ep}/timeline", f"insat/{ep}"]
        ins = get(f"insat/{ep}")
        if ins.status_code == 200:
            for s in (ins.json().get("slots") or [])[:2]:
                paths.append(f"insat/{ep}/{s['id']}.png")
        for i, it in enumerate(e["issues"]):
            ts = it["ts"]
            base = f"issues/{ep}/{ts}"
            paths += [f"{base}/meta", f"{base}/ui-alerts?level=all", f"{base}/insat", f"{base}/files/manifest.json",
                      f"{base}/alerts.cap.xml"]
            paths += [f"{base}/shelters?{p}" for p in pts]
            paths += [f"{base}/shelters/default-point", f"{base}/shelters?{pts[0]}&radius=50"]
            alerts = get(f"{base}/ui-alerts?level=all").json().get("alerts", [])
            if alerts:
                paths += [f"{base}/alerts/{alerts[0]['alert_id']}",
                          f"{base}/alerts.cap.xml?alert_id={alerts[0]['alert_id']}"]
            leads = get(f"{base}/meta").json().get("leads_available", LEADS)
            fields = FIELDS if i == 0 else ["thunderstorm", "cloudburst_index"]     # every field on the first issue
            paths += [f"{base}/map/{L}/{f}.png" for L in leads for f in fields]
            paths += [f"{base}/map/{L}/observed_ge30.png" for L in leads]
            paths += [f"{base}/map/{L}/missed_ge30.png?level=all&hazard=thunderstorm%2Ccloudburst%2Cflash_flood"
                      for L in leads]
    return list(dict.fromkeys(paths))


def main():
    kind, root = sys.argv[1], Path(sys.argv[2]).resolve()
    if kind == "full":
        os.environ.setdefault("NOWCAST_DATA_ROOT", str(root))
        sys.path.insert(0, str(root))
        from serve.app import app
        prefix = "/api"
    else:
        os.environ.update({"NOWCAST_DATA_ROOT": str(root / "nowcast_data"), "ML_REPLAY_ENABLED": "0",
                           "PORT": "10000", "WEATHER_WARMUP": "0", "OPEN_METEO_DISABLED": "1"})
        sys.modules["rasterio"] = None                      # not installed on the host
        os.chdir(root / "team_app")
        sys.path.insert(0, str(root / "team_app"))
        from backend.host_app import app
        prefix = "/ml"
    from fastapi.testclient import TestClient
    c = TestClient(app, raise_server_exceptions=False)

    def get(p):
        return c.get(f"{prefix}/{p}")

    paths = discover(get) if kind == "full" else json.loads(Path(sys.argv[3]).read_text(encoding="utf-8"))
    out = {}
    for p in paths:
        t = time.perf_counter()
        r = get(p)
        out[p] = [r.status_code, len(r.content), round(time.perf_counter() - t, 3)]
    print("PARITY_JSON " + json.dumps(out))


if __name__ == "__main__":
    main()
