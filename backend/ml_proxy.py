"""
ML Nowcast Proxy
============================================================
Forwards /ml/* to the lgbm_v0 serving API (D:\\nowcast_data\\serve, default :8001/api/*).
  - responses are streamed through unbuffered (PNGs, GeoTIFFs, JSON)
  - status codes and content types pass through unchanged
  - timeouts: 10 s per request, 30 s for /ml/replay* (a cold model replay takes ~8-13 s)
The upstream base URL comes only from the ML_API_URL environment variable.
============================================================
"""
import os

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.background import BackgroundTask

ML_API_URL = os.environ.get("ML_API_URL", "http://127.0.0.1:8001/api").rstrip("/")
DEFAULT_TIMEOUT_S = float(os.environ.get("ML_PROXY_TIMEOUT_S", "10"))
REPLAY_TIMEOUT_S = float(os.environ.get("ML_PROXY_REPLAY_TIMEOUT_S", "30"))

# response headers worth keeping; hop-by-hop headers are dropped
_PASS_HEADERS = {"content-type", "content-length", "content-encoding", "cache-control",
                 "etag", "last-modified", "content-disposition"}

_client = httpx.AsyncClient()

router = APIRouter(prefix="/ml", tags=["ml-nowcast"])


@router.api_route("/{path:path}", methods=["GET", "POST"])
async def proxy_ml(path: str, request: Request):
    timeout = REPLAY_TIMEOUT_S if path.startswith("replay") else DEFAULT_TIMEOUT_S
    headers = {}
    if "content-type" in request.headers:
        headers["content-type"] = request.headers["content-type"]
    upstream = _client.build_request(
        request.method,
        f"{ML_API_URL}/{path}",
        params=request.query_params,
        content=await request.body() if request.method == "POST" else None,
        headers=headers,
        timeout=httpx.Timeout(timeout),
    )
    try:
        resp = await _client.send(upstream, stream=True)
    except httpx.TimeoutException:
        return JSONResponse({"detail": f"ML API timed out after {timeout:.0f} s ({ML_API_URL})"},
                            status_code=504)
    except httpx.RequestError as e:
        return JSONResponse({"detail": f"ML API unreachable at {ML_API_URL}: {type(e).__name__}"},
                            status_code=502)
    return StreamingResponse(
        resp.aiter_raw(),
        status_code=resp.status_code,
        headers={k: v for k, v in resp.headers.items() if k.lower() in _PASS_HEADERS},
        background=BackgroundTask(resp.aclose),
    )
