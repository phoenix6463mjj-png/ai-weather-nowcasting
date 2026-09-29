---
title: AI Weather Nowcasting API
emoji: 🌧️
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# AI Weather Nowcasting: backend API (demo)

One process serves the team backend (rule-based weather indicators) and the frozen lgbm_v0 ML nowcast
API (precomputed case studies, national sample, one live run; mounted at `/ml`). The web UI is hosted
separately.

- Health: `/health` (team backend, static, used by the host's health check), `/ml/health` (ML API).
- Hosting: Render free web service via `render.yaml` (Docker, listens on `$PORT`), or a Hugging Face
  Docker Space (port 7860; the header above is for that). Built by `team_app/hosting/build_space.py`;
  do not edit this repo by hand.
- On-demand model replay is disabled here (`ML_REPLAY_ENABLED=0`). Precomputed case studies are shown.
- Data credits: Copernicus DEM GLO-90; INSAT-3DR via MOSDAC (Data Source MOSDAC/SAC/ISRO,
  https://mosdac.gov.in, DOI https://doi.org/10.19038/SAC/10/3RIMG_L1C_ASIA_MER; only derived PNGs and
  statistics are included, no raw MOSDAC files); Open-Meteo weather data (CC BY 4.0) when no
  OpenWeather key is set; OpenStreetMap and NASA GIBS tiles in the UI.
- Not an official warning service; no integration with IMD, NDMA or Sachet.
