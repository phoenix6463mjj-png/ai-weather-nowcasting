# ML nowcast integration (lgbm_v0 → this app)

The **ML Nowcast** page (`/nowcast`, link in the top header) shows the outputs of the frozen
`lgbm_v0` nowcasting model from the `nowcast_data` repo: alert polygons, probability/index/ratio
maps, observed rain for verification, per-alert explanations, the national sample, and one
live run. The existing pages (Dashboard, Forecast, Analytics, Alerts, Reports) are unchanged and
still run on this app's own OpenWeather + rule/`rainfall_model_v2.pkl` pipeline.

```
browser (Vite :5173)  --VITE_ML_API_BASE-->  team backend (:8000) /ml/*  --ML_API_URL-->  nowcast serve (:8001) /api/*
                                                                                          reads nowcast_data/docs/ (precomputed, read-only)
```

The frontend normally talks only to this app's backend, which proxies `/ml/*` to the ML serving
API. If the backend is down, the frontend can point straight at `:8001` (see *Fallback*).

## 1. How to run (Windows, three terminals)

Prerequisites:
- the Python venv `D:\.venv` (3.10) with `nowcast_data/requirements.txt` + `serve/requirements.txt`
  and this repo's `requirements.txt`;
- Node **v24.19.0**. An older Node 20.18 may still be first on PATH, and Vite 8 needs ≥ 20.19. In
  every terminal you use for npm, run this first:

```powershell
$env:Path = "C:\Program Files\nodejs;" + $env:Path; node -v    # must print v24.19.0
```

**Terminal 1: ML serving API (port 8001)**
```powershell
cd D:\nowcast_data
D:\.venv\Scripts\python.exe -m uvicorn serve.app:app --port 8001
```

**Terminal 2: team backend (port 8000)**
```powershell
cd D:\team_app\backend
D:\.venv\Scripts\python.exe -m uvicorn main:app --port 8000
```
It prints `ML Ready: ...` once its own model has loaded. The `/ml/*` proxy needs no extra setup.
The OpenWeather key for the other pages comes only from the environment / `.env`
(`OPENWEATHER_API_KEY`, see `.env.example`). Without a key, those pages use their built-in fallback.

**Terminal 3: frontend (port 5173)**
```powershell
$env:Path = "C:\Program Files\nodejs;" + $env:Path
cd D:\team_app\frontend\frontend-react
npm ci          # first time only
npm run dev     # then open http://localhost:5173/nowcast
```

**Check that the chain works:** `http://127.0.0.1:8001/api/health` and `http://127.0.0.1:8000/ml/health`
must both return `{"status": "ok", ...}`.

### Fallback: frontend straight to the ML API (team backend down)

This is one setting, with no code change. The ML API allows the Vite dev origins through CORS.
```powershell
$env:VITE_ML_API_BASE = "http://127.0.0.1:8001/api"; npm run dev
```
The default is `http://127.0.0.1:8000/ml` (`src/config.js`). Only the ML Nowcast page uses it;
the other pages still need the team backend.

### Optional: warm the replay model

The first "Re-run model now" click loads the model (≈ 4 s) and runs it (≈ 2–9 s). To pay that cost up
front, call `Invoke-RestMethod -Method Post http://127.0.0.1:8000/ml/replay/warm`.

## 2. Configuration (environment variables)

| variable | where | default | meaning |
|---|---|---|---|
| `VITE_ML_API_BASE` | frontend (build/dev time) | `http://127.0.0.1:8000/ml` | ML API base URL as seen by the browser |
| `ML_API_URL` | team backend | `http://127.0.0.1:8001/api` | upstream for the `/ml/*` proxy |
| `ML_PROXY_TIMEOUT_S` / `ML_PROXY_REPLAY_TIMEOUT_S` | team backend | `10` / `30` | proxy timeouts (replay gets longer) |
| `NOWCAST_DATA_ROOT` | ML serve | the `nowcast_data` repo root | where `docs/` and `catalog/` are read from |
| `ML_CORS_ORIGINS` | ML serve | `http://localhost:5173,http://127.0.0.1:5173` | browser origins allowed to call `:8001` directly |
| `NOWCAST_REPLAY_INPUTS` | ML serve | `<root>/raw`, else `<root>/demo_inputs` | archived inputs for on-demand replay |
| `NOWCAST_REPLAY_TIMEOUT_S` | ML serve | `25` | replay request timeout (the run itself completes and is cached) |
| `OPENWEATHER_API_KEY` | team backend | none | existing pages only; never in code |

`VITE_ML_API_BASE` and `ML_API_URL` are the only service URLs; nothing else is hard-coded for the
ML integration.

## 3. What was added

**team_app** (branch `ml-integration`):
- `backend/ml_proxy.py`, plus 2 lines in `backend/main.py` (`include_router`).
  - Streams responses through unbuffered and passes status codes and content types unchanged.
  - Returns 502 when the ML API is unreachable and 504 on timeout.
- `requirements.txt`: pinned backend dependencies (from the actual imports of `backend/` and `utils/`).
- `frontend/frontend-react/src/`:
  - `config.js`
  - `services/nowcastApi.js`
  - `utils/hazardLabels.js`
  - `pages/Nowcast.jsx`
  - `components/nowcast/*`
  - route in `App.jsx`, nav link in `components/TopHeader.jsx`
- `package.json`, `playwright.config.js`, `e2e/nowcast.spec.js`: browser tests. Screenshots go to
  `e2e/screenshots/`, which is gitignored.

**nowcast_data** (branch `integration`): the new folder `serve/` only. The model, pipeline,
thresholds, configs and docs are untouched.

## 4. Endpoints

Through the proxy, use `http://127.0.0.1:8000/ml/<path>`; directly, `http://127.0.0.1:8001/api/<path>`.
The paths are identical.

| method | path | returns |
|---|---|---|
| GET | `health` | status, episodes, replay state |
| GET | `labels` | hazard names, value kinds, raster legends, Watch/Warning definitions |
| GET | `caveats` | caveats shown on the page, each with a verbatim quote and source doc |
| GET | `episodes` | REF045 (validation, out-of-sample), REF051 Malana (**test (2024)** descriptive case study, both documented sites) and REF025 (training, **in-sample**): issue times with alert / verified / false-alarm counts (REF051 13:00Z is forecast-only); default REF045 13 Aug 2023 15:00Z |
| GET | `episodes/{ep}/event-check` | documented-event check for REF045 / REF051 (report-based; not a model output): see §5 |
| GET | `issues/{ep}/{ts}/meta` | grid, Leaflet bounds, per-lead valid time, radius, observed-frame availability and verification counts, method card, legends |
| GET | `issues/{ep}/{ts}/ui-alerts?level=warning\|all&hazard=&lead=` | normalized alerts (GeoJSON geometry + `display` + `level` + `verification`); Warnings only by default |
| GET | `issues/{ep}/{ts}/alerts/{alert_id}` | full explanation: calculation trace, SHAP top-5 waterfall, confidence, basin block |
| GET | `issues/{ep}/{ts}/map/{lead}/{field}.png` | overlay PNG (`rain_p1`, `rain_p10`, `rain_p30`, `thunderstorm`, `cloudburst_index`, `flash_flood`, `observed_ge30`) |
| GET | `issues/{ep}/{ts}/map/{lead}/missed_ge30.png?level=&hazard=` | observed ≥30 mm/hr cells outside the alerts currently displayed (derived; no counts) |
| GET | `issues/{ep}/{ts}/files/{name}` | raw files: `manifest.json`, `alerts.geojson`, `explain.json`, `grids.json`, `prob_L{1,2,3,4,6}h.tif`, figure PNGs |
| GET | `india/meta`, `india/map/{lead}/{field}.png` | national sample (probability maps only) |
| GET | `live`, `live/{run}/meta`, `live/{run}/ui-alerts`, `live/{run}/map/{lead}/{field}.png` | live run(s), labelled **not validated** |
| GET / POST | `replay/status`, `replay/warm`, `replay` (`{"issue_time": "2023-08-13T21:00Z", "episode": "REF045"}` or `"bbox": [N, W, S, E]`) | on-demand run of `Nowcaster().predict`: one at a time, cached, with a timeout, and a byte comparison with the precomputed files |

The PNGs are resampled to Web-Mercator rows by the API, so they sit correctly in a Leaflet
`ImageOverlay` at `meta.bounds`.

## 5. Labelling rules (enforced in `nowcast_data/serve/labels.py`, rendered by `src/utils/hazardLabels.js`)

| hazard | value | shown as | never |
|---|---|---|---|
| Thunderstorm | calibrated **probability** of ≥30 mm/hr within r (10 km at 1 h, 25 km at 2–3 h, 50 km at 4–6 h) | `35%` | — |
| Cloudburst | **risk index** 0–1 (P≥30 boosted by upslope lift) | `index 0.18`, "NOT a probability" | a `%` |
| Flash flood | **risk ratio** = basin forecast rain ÷ basin threshold | `ratio 1.06` | a `%` |

- **Watch / Warning** don't appear in the model files; they're mapped for display. Flash flood:
  `risk_band` moderate (ratio 0.5–1) → **Watch**, high (ratio ≥ 1) → **Warning**. Thunderstorm and
  cloudburst: severity moderate → Watch, severe/extreme → Warning (the rule `explain.json` uses).
- **Warnings are shown by default.** "Also show Watch" adds the Watch alerts.
- **IMD colour chips**: a small dot next to every Watch/Warning badge (map legend, alert cards,
  explain panel, documented-event check cards) — Watch = orange, Warning = red, no alert = no chip.
  Title/legend text: "Indicative mapping to IMD colour codes; not an official IMD warning." This is
  our own display convention on top of the model's own Watch/Warning; it is not an IMD product and
  is never described as one.
- **Verification** follows the contract (§7): an alert is *verified* when at least one observed
  ≥30 mm/hr cell (within r) lies inside it. Otherwise it is *not verified (false alarm)*. Flash-flood
  alerts use the same rain-overlap check; basin totals are not verified (there are no gauges).
- **Observed ≥30 mm/hr** (lime) is always drawn in replays. **Purple** is heavy rain outside every
  alert currently displayed. It follows the lead, Watch and hazard toggles, is derived by the UI
  layer, is not a model-verification output, and is shown without counts.
- **REF025** always carries a red "IN-SAMPLE, training-period event, illustration only" badge.
  REF045 is labelled out-of-sample (validation split).
- **National sample:** probability maps only. The page states that no national alerts are
  produced and that the flash-flood band is a placeholder (so it isn't offered as a layer).
- **Live:** a permanent "System running operationally, NOT validated" banner. Alerts are never
  presented as validated warnings. There is no verification. Nothing is filtered by country: the
  current run has an alert off the Myanmar coast.
- **REF051 Malana (2024 test)** carries the badge "test (2024)" and the label "2024 test period —
  descriptive case study; model frozen before this run; not a new test score." Both documented
  sites (Malana, Tosh) are marked. Issue 31 Jul 13:00Z is forecast-only ("no explanation
  available: input window starts 12:00Z").
- **Documented-event check** (the "Documented-event check" tab in the alert panel, REF045 and REF051):
  - Event times come from the cited reports (`nowcast_data/catalog/documented_event_times.csv`).
    Label: "Checked against the documented event location, not satellite rain; IMERG may not
    resolve cloudbursts." and "IMERG verification and documented-report check can disagree;
    both are shown."
  - An early warning is an alert that covers the site, was ISSUED before the event window
    starts and is VALID during it (± 1 h tolerance).
  - Each alert shows hours of warning, area, peak→site distance, "precise" (≤ 25 km and
    ≤ 5,000 km²) or "broad area", and its IMERG status.
  - Date-only reports (Tosh) make no before/after claim.
  - The forecast-only 13:00Z issue is shown under a separate criterion: "nearby alert cells
    (≤25 km), not a site-covering alert".
- **Caveats bar** (always visible): low absolute severe-rain skill (val CSI at ≥30 mm/hr 0.20 at 1 h
  down to 0.06 at 6 h), 1 h persistence tie, flash-flood areas 1.2–2.4× too broad, 3 of 7 test
  cloudbursts invisible in IMERG, neighbourhood probabilities, top-scale overconfidence, the
  uncalibrated cloudburst index, replay inputs not real-time, and unofficial boundaries.

## 6. Tests

```powershell
# ML API (no servers needed); NOWCAST_TEST_REPLAY=1 also runs one real replay
cd D:\nowcast_data; D:\.venv\Scripts\python.exe -m pytest serve/tests -q

# browser end-to-end (all three servers running; first time: npm ci; npx playwright install chromium)
$env:Path = "C:\Program Files\nodejs;" + $env:Path
cd D:\team_app; npx playwright test        # E2E_APP_URL overrides http://localhost:5173
```

The e2e tests assert on the DOM:
- the number of alert polygons equals the API's alerts at every lead, with and without Watch, for
  REF045 12 Aug 21:00Z, 13 Aug 15:00Z and 13 Aug 21:00Z;
- no `%` appears next to any cloudburst or flash-flood value;
- the REF025 in-sample badge, the national notes and the live not-validated banner are present;
- the explain panels, overlays and legends are correct;
- the replay button matches the precomputed files;
- every Watch/Warning badge (alert cards, explain panel, documented-event check cards) carries the
  matching orange/red IMD chip, and the legend states the "not an official IMD warning" note.

## 7. Troubleshooting

| symptom | cause / fix |
|---|---|
| page shows "Cannot reach the nowcast API" | the team backend isn't running on :8000. Start it, or use the fallback |
| `502 ML API unreachable` | ML serve isn't running on :8001 |
| `504` on replay | a cold replay exceeded the timeout. It keeps running and is cached, so click again after a few seconds |
| `503 a replay is already running` | only one replay runs at a time (8 GB laptop) |
| `npm run dev` fails with an engine or syntax error | the wrong Node is on PATH. Run the PATH line above; `node -v` must print v24.19.0 |
| tiles missing | the base map uses OpenStreetMap tiles and needs internet access |
