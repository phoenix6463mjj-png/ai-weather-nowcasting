# Hosting the demo (manual steps)

Nothing here has been deployed. These are the steps to do by hand. The layout:

```
Vercel (static React build)  --VITE_API_BASE / VITE_ML_API_BASE-->  Hugging Face Space (Docker, one process, port 7860)
                                                                   team backend + lgbm_v0 ML API mounted at /ml
```

- **One process.** `backend/host_app.py` mounts the ML API (`nowcast_data/serve`) inside the team backend
  at `/ml`: `/ml/<x>` is served by the ML API's `/api/<x>`, the same mapping the local `/ml` proxy
  uses. So there is no second server and no proxy hop, and `VITE_ML_API_BASE=<space>/ml` works
  unchanged.
- **RAM.** Measured locally after the full e2e run: ≈ 332 MB warm, ≈ 341 MB peak. On-demand model
  replay is **off** on the host (`ML_REPLAY_ENABLED=0`); it would add about 1 GB and needs 110 MB of
  inputs. Precomputed case studies, maps, timelines, the INSAT layer and CAP all work.

## 1. Build the Space folder (on this laptop)

```powershell
cd D:\team_app
D:\.venv\Scripts\python.exe hosting\build_space.py        # -> hosting\space\ (git-ignored), ~148 MB
```

- `hosting\space\MANIFEST.txt` lists every shipped group with sizes, and every excluded folder with the
  reason.
- The script refuses to finish if any `.h5`, `.hdf5`, `.nc4`, `.part`, `.env`, `.netrc`, `config.json`
  or `kaggle.json` file is present.
- **MOSDAC terms:** only derived PNGs and site statistics (`serve/assets/insat/`) are shipped, with the
  MOSDAC credit and DOI. Raw MOSDAC products are never uploaded (they stay in `nowcast_data/raw/insat/`,
  which is git-ignored and not copied).

## 2. Hugging Face Space (Docker)

1. Go to https://huggingface.co/new-space.
   - Owner: your account. Space name: e.g. `nowcast-api`. SDK: **Docker** (blank template).
   - Hardware: **CPU basic (free)**. Visibility: public.
2. Upload the folder with the `hf` CLI. It handles the two files over 10 MB automatically:
   `docs/sample_output_india/grids.json` (14 MB) and `docs/live_output/20260926T0330Z/grids.json` (13 MB).
   ```bash
   pip install -U huggingface_hub        # provides the `hf` command
   hf auth login                         # paste a WRITE token from https://huggingface.co/settings/tokens
   hf upload <your-hf-user>/nowcast-api D:/team_app/hosting/space . --repo-type space
   ```
   - `hosting/space/README.md` carries the Space YAML: `sdk: docker`, `app_port: 7860`. It replaces the
     template README.
   - Plain `git push` works too, but then files over 10 MB must be tracked with git-xet
     (`git xet install`).
3. **Settings → Variables and secrets** (runtime):

   | name | value | kind |
   |---|---|---|
   | `CORS_ORIGINS` | your Vercel URL, e.g. `https://ai-weather-nowcasting.vercel.app` (set it after step 3; comma-separate several) | variable |
   | `OPENWEATHER_API_KEY` | optional. Without it the backend uses Open-Meteo (no key), else sample data. | **secret** |
   | `OPEN_METEO_DISABLED` | leave unset (set `1` only to force sample data) | variable |

   Already set in the Dockerfile: `ML_REPLAY_ENABLED=0`, `NOWCAST_DATA_ROOT`. The ML API's own CORS
   list is empty on the host (`ML_CORS_ORIGINS=""`); the outer app handles CORS for `/ml` too.
4. Wait for the build (first build ≈ 5–10 min: pip installs rasterio, scikit-learn, pandas).
   - The Space URL is `https://<your-hf-user>-nowcast-api.hf.space`.
   - `/health` and `/ml/health` must return JSON.
   - A free Space sleeps after a period without traffic; the first request after that takes longer.

## 3. Vercel (frontend)

1. Go to https://vercel.com/new → Import Git Repository → `phoenix6463mjj-png/ai-weather-nowcasting`.
2. Project settings:
   - Production branch: `ml-integration` (Settings → Git after import, or pick the branch at import).
   - Root Directory: `frontend/frontend-react`.
   - Framework preset: **Vite**. Build command `npm run build`, output `dist` (defaults).
   - Node.js version: **22.x or newer** (Vite 8 needs ≥ 20.19; locally v24.19.0).
   - `vercel.json` in that folder rewrites every path to `index.html`, so deep links like
     `/nowcast/results` load.
3. Environment variables (build time; both are required, or the build points at `127.0.0.1`):

   | name | example value |
   |---|---|
   | `VITE_API_BASE` | `https://<your-hf-user>-nowcast-api.hf.space` |
   | `VITE_ML_API_BASE` | `https://<your-hf-user>-nowcast-api.hf.space/ml` |

4. Deploy. Then put the Vercel URL (no trailing slash) into the Space's `CORS_ORIGINS` and restart the
   Space ("Restart this Space" in Settings).
   - Checked locally: a build with hosted example values contains no `127.0.0.1` or localhost address.

## 4. Smoke test (after both are up)

- [ ] `https://<space>/health` and `https://<space>/ml/health` return JSON; `/ml/replay/status` has `"enabled": false`.
- [ ] `https://<vercel-app>/` loads, with no console CORS errors (browser devtools).
  - The weather badge says "Open-Meteo (model data), updated HH:MM UTC" (or "Sample data — no live
    weather feed" if Open-Meteo is unreachable), next to the Open-Meteo credit.
- [ ] Deep links: open `https://<vercel-app>/nowcast/results` and `/nowcast/approach` directly (not by
      clicking): they load.
- [ ] `/nowcast`:
  - REF045, REF051 and REF025 load with their badges (REF025 in-sample, REF051 test 2024);
  - map layers, lead switch, drawer sections (Alert, Ingredients, Event check with the INSAT rows,
    Caveats);
  - the Alert section shows "On-demand replay is disabled in the hosted demo; precomputed case studies
    are shown." instead of the Re-run button.
- [ ] Forecaster review: approve an alert → "Download CAP" saves an XML with status Exercise.
- [ ] National sample and Live (not validated) tabs load; the Live banner shows the run date.
- [ ] Results and Approach pages render; the data credits footer shows Copernicus + MOSDAC (with DOI).
- [ ] Team pages:
  - Forecast, Alerts, Analytics and Reports load;
  - with the Space stopped they show "… unavailable — backend not reachable", never invented data.
- [ ] Mobile (phone): known limitation, the layout is desktop-first.

## Hosting notes

- **Map tiles.**
  - OSM (`tile.openstreetmap.org`) is fine for light demo traffic under its tile usage policy; for
    sustained traffic use a tile provider.
  - NASA GIBS needs no key.
- **Open-Meteo.** Free non-commercial use: < 10,000 calls/day. The backend's 60-min cache keeps one
  demo well inside that. Credit "Weather data by Open-Meteo.com" (CC BY 4.0) is shown next to its
  data.
- **Local development is unchanged:** `start_demo.ps1` still runs the two APIs separately with the
  `/ml` proxy.
