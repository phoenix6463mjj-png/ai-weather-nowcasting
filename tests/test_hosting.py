"""Hosting config: CORS_ORIGINS env var (credentials off), the one-process host app (/ml mounted
in-process, /ml/<x> = ML API /api/<x>), and ML_REPLAY_ENABLED=0. Each case runs in a fresh interpreter
so the environment is read at import, as on the host. No network (Open-Meteo disabled)."""
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NOWCAST = ROOT.parent / "nowcast_data"

PROBE = r"""
import json, sys, warnings
warnings.filterwarnings("ignore")
sys.path.insert(0, ".")
from fastapi.testclient import TestClient
mod = __import__(sys.argv[1], fromlist=["app"])
c = TestClient(mod.app)
out = {}
for origin in sys.argv[2:]:
    r = c.options("/health", headers={"Origin": origin, "Access-Control-Request-Method": "GET"})
    out[origin] = [r.status_code, r.headers.get("access-control-allow-origin"), r.headers.get("access-control-allow-credentials")]
if sys.argv[1] == "backend.host_app":
    out["ml_health"] = c.get("/ml/health").status_code
    out["ml_episodes"] = len(c.get("/ml/episodes").json()["episodes"])
    out["replay_status"] = c.get("/ml/replay/status").json()
    out["replay_post"] = c.post("/ml/replay", json={"issue_time": "2023-08-13T15:00Z", "episode": "REF045"}).status_code
    out["root"] = c.get("/").status_code
    out["health"] = c.get("/health").json().get("status")
print("JSON" + json.dumps(out))
"""


def probe(module, origins, **env):
    e = {**os.environ, "OPEN_METEO_DISABLED": "1", "PYTHONIOENCODING": "utf-8", **env}
    for k in ("CORS_ORIGINS", "ML_REPLAY_ENABLED", "ML_CORS_ORIGINS"):
        if k not in env:
            e.pop(k, None)
    r = subprocess.run([sys.executable, "-c", PROBE, module, *origins], cwd=ROOT, env=e,
                       capture_output=True, text=True, timeout=240)
    line = next((l for l in r.stdout.splitlines() if l.startswith("JSON")), None)
    assert line, r.stdout[-800:] + r.stderr[-800:]
    return json.loads(line[4:])


def test_cors_default_is_the_local_dev_origins_without_credentials():
    out = probe("backend.main", ["http://localhost:5173", "https://evil.example"])
    assert out["http://localhost:5173"][:2] == [200, "http://localhost:5173"]
    assert out["http://localhost:5173"][2] is None                  # credentials off
    assert out["https://evil.example"][1] is None


def test_cors_origins_env_var():
    out = probe("backend.main", ["https://my-demo.vercel.app", "http://localhost:5173"],
                CORS_ORIGINS="https://my-demo.vercel.app, https://other.example")
    assert out["https://my-demo.vercel.app"][:2] == [200, "https://my-demo.vercel.app"]
    assert out["http://localhost:5173"][1] is None                  # the dev default is replaced, not added to


def test_host_app_one_process_with_replay_disabled():
    out = probe("backend.host_app", ["https://my-demo.vercel.app"], CORS_ORIGINS="https://my-demo.vercel.app",
                ML_REPLAY_ENABLED="0", NOWCAST_DATA_ROOT=str(NOWCAST))
    assert out["https://my-demo.vercel.app"][1] == "https://my-demo.vercel.app"
    assert out["ml_health"] == 200 and out["ml_episodes"] == 3 and out["root"] == 200
    note = "On-demand replay is disabled in the hosted demo; precomputed case studies are shown."
    assert out["replay_status"]["enabled"] is False and out["replay_status"]["note"] == note
    assert out["replay_post"] == 403


def test_hosting_files_ship_no_secrets_or_raw_data():
    build = (ROOT / "hosting" / "build_space.py").read_text(encoding="utf-8")
    assert '".h5"' in build and '".env"' in build and "refusing" in build
    req = (ROOT / "hosting" / "requirements-host.txt").read_text(encoding="utf-8")
    pins = [l.split("==")[0].lower() for l in req.splitlines() if "==" in l]
    for pkg in ("pytest", "xmlschema", "pypdf", "h5py", "pyproj", "lightgbm"):
        assert pkg not in pins
    df = (ROOT / "hosting" / "Dockerfile").read_text(encoding="utf-8")
    assert "7860" in df and "ML_REPLAY_ENABLED=0" in df and "backend.host_app:app" in df
    assert json.loads((ROOT / "frontend" / "frontend-react" / "vercel.json").read_text())["rewrites"][0]["destination"] == "/index.html"


def test_render_blueprint_and_port():
    import yaml
    df = (ROOT / "hosting" / "Dockerfile").read_text(encoding="utf-8")
    assert "--port ${PORT:-7860}" in df and 'CMD ["sh", "-c", "exec uvicorn backend.host_app:app' in df
    svc = yaml.safe_load((ROOT / "hosting" / "render.yaml").read_text(encoding="utf-8"))["services"]
    assert len(svc) == 1
    s = svc[0]
    assert (s["type"], s["runtime"], s["plan"], s["healthCheckPath"]) == ("web", "docker", "free", "/health")
    env = {e["key"]: e for e in s["envVars"]}
    assert env["ML_REPLAY_ENABLED"]["value"] == "0"
    assert env["CORS_ORIGINS"]["sync"] is False and env["ML_CORS_ORIGINS"]["sync"] is False


def test_host_repo_build_rules():
    build = (ROOT / "hosting" / "build_space.py").read_text(encoding="utf-8")
    assert 'if p.name == ".git":' in build                      # a rebuild keeps the host repo's history
    assert "100e6" in build and "GitHub limit" in build          # files over 100 MB are refused
    for f in ("render.yaml", "space.gitignore", "space.dockerignore", "space.gitattributes"):
        assert (ROOT / "hosting" / f).is_file() and f'"{f}"' in build
    assert "* -text" in (ROOT / "hosting" / "space.gitattributes").read_text(encoding="utf-8")
    assert ".env" in (ROOT / "hosting" / "space.gitignore").read_text(encoding="utf-8")
    assert "hosting/space/" in (ROOT / ".gitignore").read_text(encoding="utf-8")


def test_health_is_static():
    out = probe("backend.host_app", [], ML_REPLAY_ENABLED="0", NOWCAST_DATA_ROOT=str(NOWCAST))
    assert out["health"] == "ok"
