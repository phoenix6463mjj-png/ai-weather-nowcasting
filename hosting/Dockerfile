# One process serving the team backend and the lgbm_v0 ML API (mounted in-process at /ml).
# Build context = the folder made by hosting/build_space.py (its own Git repo).
# Render (free web service): listens on $PORT (Render sets 10000). Hugging Face Space / local: 7860.
FROM python:3.10-slim

RUN useradd -m -u 1000 user
WORKDIR /home/user/app

COPY --chown=user requirements-host.txt .
RUN pip install --no-cache-dir -r requirements-host.txt

COPY --chown=user nowcast_data ./nowcast_data
COPY --chown=user team_app ./team_app

USER user
ENV NOWCAST_DATA_ROOT=/home/user/app/nowcast_data \
    ML_REPLAY_ENABLED=0 \
    PYTHONUNBUFFERED=1
# CORS_ORIGINS / ML_CORS_ORIGINS are set in the host's settings (the deployed frontend's URL).

WORKDIR /home/user/app/team_app
EXPOSE 7860
# health check: GET /health (static JSON, reads no data)
CMD ["sh", "-c", "exec uvicorn backend.host_app:app --host 0.0.0.0 --port ${PORT:-7860}"]
