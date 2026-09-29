# Hosting the demo (manual steps)

Nothing here has been deployed. These are the steps to do by hand. The layout:

```
Vercel (static React build)  --VITE_API_BASE / VITE_ML_API_BASE-->  Render free web service (Docker, one process, $PORT)
                                                                   team backend + lgbm_v0 ML API mounted at /ml
```

- **One process.** `backend/host_app.py` mounts the ML API (`nowcast_data/serve`) inside the team backend
  at `/ml`: `/ml/<x>` is served by the ML API's `/api/<x>`, the same mapping the local `/ml` proxy
  uses. So there is no second server and no proxy hop, and `VITE_ML_API_BASE=<host>/ml` works
  unchanged.
- **Health check:** `GET /health` (team backend) returns a fixed JSON (`"status": "ok"`) and reads no data.
  `/ml/health` is the ML API's.
- **RAM and startup.** Measured 30 Sep 2026 on this laptop, running the app from `hosting/space` the way
  the Dockerfile does (`PORT=10000`, `ML_REPLAY_ENABLED=0`), over 885 requests to every endpoint kind:
  - first `/health` answered 2.4 s after start;
  - RSS 190 MB at start, 271 MB after warm-up, 295 MB at peak. Render free has 512 MB.
  - Startup is almost all libraries: scikit-learn 64 MB, numpy + pandas 58 MB, web stack 24 MB,
    rasterio/pillow/shapely 14 MB. The app code plus `rainfall_model_v2.pkl` add 17 MB.
  - Data files are read lazily, on first request, and cached.
  - Measured on Windows. Linux in the container may differ by some tens of MB.
  - On-demand model replay is **off** on the host (`ML_REPLAY_ENABLED=0`). It would add about 1 GB and
    needs 110 MB of inputs. Precomputed case studies, maps, timelines, the INSAT layer and CAP all work.

## 1. Build the host folder (on this laptop)

```powershell
cd D:\team_app
D:\.venv\Scripts\python.exe hosting\build_space.py        # -> hosting\space\ (~120 MB, 1,095 files)
```

- `hosting\space\` is **its own Git repo** (branch `main`), ignored by team_app.
  - A rebuild replaces every file but keeps `.git`, so an update is rebuild → commit → push (step 2h).
  - It holds only the shipped files plus `Dockerfile`, `render.yaml`, `requirements-host.txt`,
    `README.md`, `MANIFEST.txt`, `.gitignore`, `.dockerignore` and `.gitattributes`.
  - `.gitattributes` (`* -text`) makes Git store every file byte-for-byte, with no line-ending
    conversion of rasters or pickles.
  - Packed size ≈ 64 MB. The largest file is 5.7 MB (`rainfall_model_v2.pkl`).
- `hosting\space\MANIFEST.txt` lists every shipped group with sizes, and every excluded folder with the
  reason.
- The script refuses to finish if any `.h5`, `.hdf5`, `.nc4`, `.part`, `.env`, `.netrc`, `config.json`
  or `kaggle.json` file is present, or if any file is over 100 MB (GitHub's limit).
- The national-sample and live-run `grids.json` files (13–14 MB each) are not shipped. No endpoint
  reads them; those maps come from `prob_L*h.tif` and the manifest.
- **MOSDAC terms:** only derived PNGs and site statistics (`serve/assets/insat/`) are shipped, with the
  MOSDAC credit and DOI. Raw MOSDAC products are never uploaded (they stay in `nowcast_data/raw/insat/`,
  which is git-ignored and not copied).

## 2. Render (backend, free web service)

Render free: 512 MB RAM, 0.1 CPU. It spins down after 15 min without traffic, and the next request
waits while it starts. The frontend shows "Starting the server — this can take up to a minute on the
free host…" and retries meanwhile. Step g keeps it awake.

**a. Create the GitHub repo.** Go to https://github.com/new:
- Owner `phoenix6463mjj-png`, name **`nowcast-host`**, visibility **Private**.
- Do **not** add a README, .gitignore or licence (the repo must be empty).

**b. Push the host folder** (the first push opens a browser sign-in via Git Credential Manager):

```powershell
cd D:\team_app\hosting\space
git remote add origin https://github.com/phoenix6463mjj-png/nowcast-host.git
git push -u origin main
```

**c. Create the service on Render:**
1. https://dashboard.render.com → **Sign up with GitHub**.
   - When GitHub asks which repositories Render may access, include `nowcast-host` (it is private).
2. **New → Blueprint** → pick `phoenix6463mjj-png/nowcast-host`. Render reads `render.yaml`:
   - one web service `nowcast-api`: runtime Docker, plan **Free**, region Singapore;
   - health check `/health`, auto-deploy on push.
3. Render asks for the `sync: false` variables.
   - `CORS_ORIGINS` and `ML_CORS_ORIGINS`: the Vercel URL is not known yet, so enter
     `https://placeholder.invalid` for now. You replace it in step f.
   - Set in `render.yaml` / the Dockerfile already: `ML_REPLAY_ENABLED=0`, `NOWCAST_DATA_ROOT`,
     `PYTHONUNBUFFERED`.
   - Optional, under the service's **Environment** tab: `OPENWEATHER_API_KEY` (as a secret). Without
     it the backend uses Open-Meteo (no key), else sample data.
4. **Apply**. The first build takes about 5–10 min (pip installs rasterio, scikit-learn and pandas).
   - The service URL is `https://nowcast-api.onrender.com`, or with a suffix if that name is taken.
     Render shows it at the top of the service page.
   - Alternative to a Blueprint: **New → Web Service** → the repo → Language **Docker** → Instance
     type **Free** → Advanced: health check path `/health` → add the same three env vars.

**d. Check the backend** (browser or `curl`):
- `https://<service>.onrender.com/health` → `{"status": "ok", …}`;
- `https://<service>.onrender.com/ml/credits` → JSON list of data credits;
- `https://<service>.onrender.com/ml/episodes` → 3 case studies;
- `https://<service>.onrender.com/ml/replay/status` → `"enabled": false`.

**e. Vercel environment variables** (see section 3):
- `VITE_API_BASE=https://<service>.onrender.com`
- `VITE_ML_API_BASE=https://<service>.onrender.com/ml`

**f. CORS.** After Vercel has deployed, go to Render → the service → **Environment**.
- Set `CORS_ORIGINS` and `ML_CORS_ORIGINS` to the Vercel URL, with no trailing slash, e.g.
  `https://ai-weather-nowcasting.vercel.app`. Comma-separate several.
- **Save and deploy** (a redeploy is needed for the change to apply).

**g. Keep-alive** (one of these; free):
- **UptimeRobot** (https://uptimerobot.com): Add New Monitor → HTTP(s) → URL
  `https://<service>.onrender.com/health` → interval 10 minutes.
- **cron-job.org** (https://cron-job.org): Create cronjob → URL `https://<service>.onrender.com/health`
  → every 10 minutes.

Kept awake all month, one service uses about 744 instance hours. That is within Render's free 750 hours
per workspace, so run only this one free service.

**h. Updating later** (after code or data changes in team_app / nowcast_data):

```powershell
cd D:\team_app
D:\.venv\Scripts\python.exe hosting\build_space.py
cd hosting\space
git add -A
git commit -m "Update host bundle"
git push
```

Render redeploys automatically on push. Check `/health` again afterwards.

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

   | name | value |
   |---|---|
   | `VITE_API_BASE` | `https://<service>.onrender.com` |
   | `VITE_ML_API_BASE` | `https://<service>.onrender.com/ml` |

4. Deploy. Then do step 2f: the Vercel URL into Render's CORS variables, then redeploy.
   - If the Vercel variables change later, redeploy on Vercel too, because they are baked in at build
     time.
   - Checked locally: a build with hosted example values contains no `127.0.0.1` or localhost address.

## 4. Smoke test (after both are up)

- [ ] `https://<service>.onrender.com/health` and `/ml/health` return JSON; `/ml/replay/status` has
      `"enabled": false`.
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
  - Forecast, Alerts, Analytics and Reports load.
  - After the service has slept, the first page shows "Starting the server …", then loads.
  - If the backend stays down for 90 s, pages show "Server unavailable — please refresh in a
    minute.", never invented data.
- [ ] Mobile (phone): known limitation, the layout is desktop-first.

## 5. Hugging Face Space (Docker) — needs PRO since July 2026

Docker Spaces no longer run on the free tier, so the Render route above replaces this one. The same
host folder still works on a Space (it listens on 7860 when `PORT` is unset).

1. Go to https://huggingface.co/new-space.
   - Owner: your account. Space name: e.g. `nowcast-api`. SDK: **Docker** (blank template).
   - Hardware: a CPU tier your plan allows. Visibility: public.
2. Upload the folder with the `hf` CLI:
   ```bash
   pip install -U huggingface_hub        # provides the `hf` command
   hf auth login                         # paste a WRITE token from https://huggingface.co/settings/tokens
   hf upload <your-hf-user>/nowcast-api D:/team_app/hosting/space . --repo-type space
   ```
   - `hosting/space/README.md` carries the Space YAML: `sdk: docker`, `app_port: 7860`.
   - No file is over 10 MB any more, so a plain `git push` to the Space works without git-xet.
3. **Settings → Variables and secrets** (runtime):

   | name | value | kind |
   |---|---|---|
   | `CORS_ORIGINS` | your Vercel URL (comma-separate several) | variable |
   | `OPENWEATHER_API_KEY` | optional. Without it the backend uses Open-Meteo (no key), else sample data. | **secret** |
   | `OPEN_METEO_DISABLED` | leave unset (set `1` only to force sample data) | variable |

   Already set in the Dockerfile: `ML_REPLAY_ENABLED=0`, `NOWCAST_DATA_ROOT`.
4. The Space URL is `https://<your-hf-user>-nowcast-api.hf.space`. Use it for the two Vercel
   variables instead of the Render URL.

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
