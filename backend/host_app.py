"""Hosted entry point: ONE process serving both APIs.

    uvicorn backend.host_app:app --host 0.0.0.0 --port 7860      (run from the team_app root)

The team backend (this repo's backend/main.py) plus the lgbm_v0 serving API (nowcast_data/serve)
mounted in-process at /ml. /ml/<x> is served by the ML API's /api/<x>, exactly what the /ml proxy
forwards to locally, so the frontend's VITE_ML_API_BASE=<host>/ml works unchanged and no second
server is needed.

Environment (see HOSTING.md): NOWCAST_DATA_ROOT (where nowcast_data's served files are),
CORS_ORIGINS (the frontend URL), ML_REPLAY_ENABLED=0 (no on-demand model runs on the host).
The outer app's CORS middleware covers /ml too, so the ML API's own list is left empty here.
"""
import os
import sys
from pathlib import Path

from starlette.routing import Mount

_default_root = Path(__file__).resolve().parents[2] / "nowcast_data"
DATA_ROOT = Path(os.environ.get("NOWCAST_DATA_ROOT") or _default_root).resolve()
os.environ["NOWCAST_DATA_ROOT"] = str(DATA_ROOT)
os.environ.setdefault("ML_CORS_ORIGINS", "")          # CORS is handled once, by the outer app
if str(DATA_ROOT) not in sys.path:
    sys.path.insert(0, str(DATA_ROOT))

from serve.app import app as ml_app                     # noqa: E402  (nowcast_data/serve)
from backend.main import app                            # noqa: E402  (team backend, incl. its CORS)


class _ApiPrefix:
    """ASGI wrapper: a request for <mount>/<x> reaches the ML API as /api/<x>."""

    def __init__(self, inner):
        self.inner = inner

    async def __call__(self, scope, receive, send):
        if scope["type"] in ("http", "websocket"):
            root = scope.get("root_path", "")
            path = scope["path"]
            sub = path[len(root):] if root and path.startswith(root) else path
            new_path = "/api" + (sub if sub.startswith("/") else "/" + sub)
            scope = dict(scope, path=new_path, raw_path=new_path.encode(), root_path="")
        await self.inner(scope, receive, send)


# in front of the /ml proxy route that backend.main registers (routes are matched in order)
app.router.routes.insert(0, Mount("/ml", app=_ApiPrefix(ml_app)))


@app.get("/")
def root():
    """Landing JSON for the Space URL (the web UI is the separately hosted frontend)."""
    return {"service": "AI Weather Nowcasting System: team backend + lgbm_v0 ML API (one process)",
            "ml_api": "/ml/health", "team_backend": "/health", "weather_source": "/weather_source"}
