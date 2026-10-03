# ML nowcast integration (lgbm_v0 → this app)

The **ML Nowcast** page (`/nowcast`, link in the top header) shows the outputs of the frozen
`lgbm_v0` nowcasting model from the `nowcast_data` repo: alert polygons, probability/index/ratio
maps, observed rain for verification, per-alert explanations, the national sample, and one
live run. The other pages (Dashboard, Forecast, Analytics, Alerts, Reports) still run on this app's
own OpenWeather + rule/`rainfall_model_v2.pkl` pipeline. The Dashboard got honest labels (option A,
see "Dashboard" in §6). The other pages changed only in reading their backend URL from
`VITE_API_BASE`.

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

**One command instead (same commands and variables as above):**
```powershell
powershell -ExecutionPolicy Bypass -File D:\team_app\start_demo.ps1   # 3 windows, waits for each (60 s), opens /nowcast
powershell -ExecutionPolicy Bypass -File D:\team_app\stop_demo.ps1    # stops only what listens on 8001, 8000, 5173
```
`start_demo.ps1` refuses to start (and names the process) if a port is already taken. It finds
`nowcast_data`, `.venv` and Node next to this repo / in Program Files; override with
`NOWCAST_DATA_ROOT`, `NOWCAST_PYTHON`, `NODE_DIR`. `-NoBrowser` skips opening the browser.

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
| `VITE_API_BASE` | frontend (build/dev time) | `http://127.0.0.1:8000` | team backend base URL as seen by the browser (Dashboard `/alerts`, `/predict`; `services/api.js`) |
| `CORS_ORIGINS` | team backend | `http://localhost:5173,http://127.0.0.1:5173` | browser origins allowed to call the backend (comma-separated); set to the Vercel URL on the host. Credentials are off. |
| `ML_REPLAY_ENABLED` | ML serve | `1` | `0` disables on-demand replay (POST `/replay`, `/replay/warm` → 403 with a note; the UI shows "On-demand replay is disabled in the hosted demo; precomputed case studies are shown."). Hosted: `0`. |
| `ML_API_URL` | team backend | `http://127.0.0.1:8001/api` | upstream for the `/ml/*` proxy |
| `ML_PROXY_TIMEOUT_S` / `ML_PROXY_REPLAY_TIMEOUT_S` | team backend | `10` / `30` | proxy timeouts (replay gets longer) |
| `NOWCAST_DATA_ROOT` | ML serve | the `nowcast_data` repo root | where `docs/` and `catalog/` are read from |
| `ML_CORS_ORIGINS` | ML serve | `http://localhost:5173,http://127.0.0.1:5173` | browser origins allowed to call `:8001` directly |
| `NOWCAST_REPLAY_INPUTS` | ML serve | `<root>/raw`, else `<root>/demo_inputs` | archived inputs for on-demand replay |
| `NOWCAST_REPLAY_TIMEOUT_S` | ML serve | `25` | replay request timeout (the run itself completes and is cached) |
| `OPENWEATHER_API_KEY` | team backend | none | team pages only; never in code, never logged. Weather source order per zone: OpenWeather if this key is set, else **Open-Meteo** (no key, model data), else **sample data**. With a key: ≤ 50 calls/min, each point cached 60 min (A3) |
| `OPEN_METEO_DISABLED` | team backend | unset | set to `1` to skip Open-Meteo (then: sample data without a key) |

`VITE_ML_API_BASE`, `VITE_API_BASE` and `ML_API_URL` are the only service URLs. The defaults are the
local addresses above; nothing else is hard-coded. The only external URLs are the map tiles (OSM, NASA
GIBS), place search (Nominatim, Dashboard; throttled, see §8) and the team pages' Unsplash background photos.

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
thresholds, configs and docs are untouched. `serve/assets/terrain/` holds the derived terrain
assets (≈ 13 MB, see `serve/README.md`).

**Terrain (DEM) layer**: hillshade from the Copernicus DEM GLO-90, drawn in its own map pane
(z 300) *under* the forecast/observed rasters (z 350) and the alert polygons (z 400).
- Replay tab: the detailed 15″ hillshade of the episode's patch (REF045, REF051, REF025); it has
  the same bounds as the forecast rasters, so it also fits forecast-only issues.
- National and Live tabs: the 0.025° national hillshade at the India grid bounds.
- Map controls: "Terrain (DEM)" toggle (on by default) with an opacity slider. It is independent
  of the lead, level and hazard filters.
- Map attribution "Terrain: Copernicus DEM GLO-90". The full required notice, verbatim from
  `serve/assets/terrain/ATTRIBUTION.md`, is always visible in the **Data credits** footer at the
  bottom of the Nowcast page (the demo is public): "produced using Copernicus WorldDEM-90 © DLR
  e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the
  European Union and ESA; all rights reserved".
- **Data credits footer** (`components/nowcast/DataCredits.jsx`): renders the `GET credits` entries
  with `shown_on` "ml", in order: ERA5, IMERG, GFS, IMD, Copernicus DEM, MOSDAC, NASA GIBS, OSM,
  Open-Meteo. The data lives in `nowcast_data/serve/assets/credits/SOURCES.json` (Batch 3): each
  entry has the provider's wording, a ≤ 15-word quote with its URL, and whether it was verified. New
  sources go there; the footer needs no change.
- Elevation and slope GeoTIFFs for REF045/REF051 are stored for later refuge-point screening. They
  are not drawn yet.

**Results page** (`/nowcast/results`) and **Approach & live readiness** (`/nowcast/approach`), linked from
the Nowcast page header ("Nowcast map · Results · Approach & live readiness"):
- Results: CSI of v0 vs advection vs persistence per lead × threshold, validation and 2024 test side by
  side, with FAR-caveat markers (v0's FAR above advection's) and the 1 h ≥30 persistence tie; ≥30
  mm/hr reliability (bins with < 100 cells hidden); two case studies built from the event-check API
  (Pipalkoti 2023 validation, Malana 2024 test/descriptive), each linking to its warning timeline
  (`/nowcast?ep=…&ts=…&tab=event`); negative results (v1 pressure levels incl. shear, U-Net);
  limitations from `caveats`. Charts are plain SVG (`SvgPlot.jsx`): recharts 2.8 does not render
  axes/scales correctly under React 19, and upgrading it would change a shared dependency.
- Approach: proposal item → implemented feature → status; IMERG evidence (24 documented val/test
  cloudbursts, median peak 17.6 mm/hr; Pipalkoti 17.5); live readiness (IMERG Early ~318 min, GFS
  ~528 min; INSAT-3DR 46 min / 3DS 61 min, 30 min each, 15 min combined; 6 h lead ≈ 0.7 h of real
  warning on IMERG Early vs ≈ 5 h on ~1 h-old INSAT). Every text is a verbatim quote with its source.

**Page layout (checkpoint U1, map first)**: the same frame on all three tabs (Event replay,
National sample, Live).
- **Map** fills the page. Zoom control top-right.
- **Badges** in a slim strip at the top of the map, never inside the drawer: split badge
  (out-of-sample / IN-SAMPLE / test (2024)), the case-study label, the forecast-only note, the
  replay-inputs note; on Live the "NOT validated" banner, on National the "probability map only" banner.
- **Layers panel** (top-left, `LayersPanel.jsx`, collapsible; open by default at ≥ 1400×900, else
  collapsed with a one-line summary of the selection): episode and issue selectors, lead, forecast
  map layer, terrain + opacity, hazards, "Also show Watch".
- **Legend** (bottom-right, one compact box, collapsible, open by default at ≥ 1400 px): only the
  layers that are visible now (alert levels + the switched-on hazards, verification dots, site
  marker, observed / heavy-rain-outside overlays when drawn, the forecast layer when selected,
  terrain when on).
- **Drawer** (right, `Drawer.jsx`): an icon rail is always visible; the drawer is collapsed by
  default and shows one section at a time; Esc, × or the section's icon close it. It sits beside
  the map and pushes it (the map keeps its centre), so it never covers the map controls.
  Sections: **Alert** (replay button, issue summary, alert list; click an alert → its explanation;
  "List" goes back), **Ingredients** (for the selected alert), **Event check** (REF045 / REF051;
  wider, up to 900 px, for the timeline), **Caveats**. National: **About map**, **Caveats**.
  Clicking an alert on the map or in a list opens the Alert section; `?ep=…&ts=…&tab=event` opens
  Event check.
- **Data credits** footer unchanged.

| feature | before U1 | after U1 (clicks from the default view) |
|---|---|---|
| episode / issue selectors | row above the map | Layers panel (0; 1 when collapsed) |
| split / in-sample / case-study badges, forecast-only note | row + banners above the map | badge strip at the top of the map (0) |
| lead, forecast layer, terrain + opacity, hazards, Watch toggle | panel top-right of the map | Layers panel (0; 1 when collapsed) |
| legend | bottom-left of the map | bottom-right, visible layers only (0; 1 when collapsed) |
| replay button, issue summary, alert list | right-hand panel | drawer → Alert (1) |
| explain panel (reasons, trace, SHAP, confidence, basin) | right-hand panel after clicking an alert | drawer → Alert, opens on alert click (1) |
| ingredients | inside the explain panel | drawer → Ingredients (2: alert + tab; or the link in the Alert section) |
| documented-event check + warning timeline | "Documented-event check" tab of the right-hand panel | drawer → Event check (1) |
| caveats | bar under the map (5 shown, "All 10" to expand) | drawer → Caveats, all with their quote and source (1) |
| forecaster review + CAP download (checkpoint 05) | — | drawer → Alert → "Forecaster review (CAP 1.2, demo)" (1: click an alert) |
| INSAT-3DR cloud-top temperature (observation, checkpoint I2b) | — | Layers panel toggle, off by default, with opacity (1); legend entry only while on; drawer → Event check → INSAT rows (1) |
| Live "NOT validated" banner | row above the map | badge strip (0) |
| Live alert panel, top reasons | right-hand panel | drawer → Alert (1); ingredients "not available" → drawer → Ingredients |
| National notes | right-hand panel | drawer → About map (1) |
| Results / Approach pages | header links | unchanged (1) |

**Forecaster review + CAP 1.2 (checkpoint 05)**: this is in the drawer's Alert section, when an
alert is open (`CapReview.jsx`). There is no new panel.
- It shows the alert's CAP message: status Exercise (replay) / Test (live), severity, certainty,
  urgency, headline and description.
- **Approve** marks the alert "approved for issue (demo)". **Edit** changes the headline and
  description only, and sends the alert back to review. **Reject**.
- **Download CAP** is enabled only for an approved alert. It saves a CAP 1.2 file to this computer.
- The review lives only in the open page. It is not stored, and nothing is ever sent anywhere; the
  UI says so.
- Wording: "CAP 1.2 compatible (format used by India's Sachet alerting platform)". There is no
  integration with Sachet, IMD or NDMA.
- CAP rules: `nowcast_data/serve/README.md`, "CAP 1.2 output".

**INSAT-3DR case-study layer (checkpoint I2b)**: satellite observation (INSAT via MOSDAC) for
REF045 and REF051 only. It is **not a model input** (models/v0 is frozen). There is no new panel.
- **Layers panel:** "INSAT-3DR cloud-top temperature (observation)", off by default, with opacity.
  When on, the map shows only the scan usable at the issue time (acquisition end + latency ≤ issue
  time; 45 min default latency), labelled "INSAT-3DR image available at issue time: acquired HH:MMZ,
  ~N min latency". Earlier issues say that no image is available. For REF025 the toggle is replaced by
  "not available for this event".
- **Legend:** an INSAT entry only while the layer is on (a colour strip in K; the colours are display
  classes, not thresholds), with the two required lines.
- **Drawer → Event check:** two timeline rows [satellite: INSAT-3DR via MOSDAC]: the site-patch
  10th-percentile BT and its 30-min change, per scan, at the acquisition time.
  - Hatched = no file: REF045 18:15, 18:45 and 19:15Z. No change is computed across a gap or a
    look-up-table-floor value (≤ 180).
  - Numbers appear in the cells when they fit (1920). "Show INSAT values per scan" opens the exact
    values and the method.
  - No threshold line: "No verified severe-storm threshold shown." The verified 0 °C value stays in
    `serve/assets/insat/thresholds.json` with `shown: false` and the reason.
  - Everywhere INSAT values appear (legend, timeline, table): "≤180 K = at or below the coldest value
    in the product's lookup table (179.9 K); cooling rate not computable." The legend's coldest colour
    is labelled "≤180 K".
- **Required lines** wherever INSAT values appear: "INSAT position uncertainty ≈ 5–10 km (navigation +
  parallax); site values use a 25 km patch." and "Observation only — not used by the model."
- **Data credits footer:** "Data Source MOSDAC/SAC/ISRO. https://mosdac.gov.in" + DOI link.
- Neutral labels only; no sentence about early signals. Details: `nowcast_data/serve/README.md`,
  "INSAT-3DR case-study layer".

## 4. Endpoints

Through the proxy, use `http://127.0.0.1:8000/ml/<path>`; directly, `http://127.0.0.1:8001/api/<path>`.
The paths are identical.

| method | path | returns |
|---|---|---|
| GET | `health` | status, episodes, replay state |
| GET | `labels` | hazard names, value kinds, raster legends, Watch/Warning definitions |
| GET | `caveats` | caveats shown on the page, each with a verbatim quote and source doc |
| GET | `ingredients/aggregate` | descriptive demo SHAP aggregate per model and its UI sentences (the per-alert bars come with `issues/{ep}/{ts}/alerts/{id}` as `ingredients`) |
| GET | `episodes/{ep}/timeline` | warning-timeline ingredient inputs per issue + IMERG site series (REF045, REF051) |
| GET | `results`, `approach` | data and verbatim quotes for the Results and Approach pages |
| GET | `credits` | data credits for the footer, each notice verbatim from its attribution file |
| GET | `insat`, `insat/{ep}`, `insat/{ep}/{slot}.png`, `issues/{ep}/{ts}/insat` | INSAT-3DR case-study observation layer (REF045, REF051): scans, colour scale, the scan usable at an issue time (availability rule) |
| GET | `terrain`, `terrain/{layer}.png` | terrain (Copernicus DEM GLO-90) hillshade layers with bounds and attribution; layer = `national`, `REF045`, `REF051`, `REF025` |
| GET | `episodes` | REF045 (validation, out-of-sample), REF051 Malana (**test (2024)** descriptive case study, both documented sites) and REF025 (training, **in-sample**): issue times with alert / verified / false-alarm counts (REF051 13:00Z is forecast-only); default REF045 13 Aug 2023 15:00Z |
| GET | `episodes/{ep}/event-check` | documented-event check for REF045 / REF051 (report-based; not a model output): see §5 |
| GET | `issues/{ep}/{ts}/meta` | grid, Leaflet bounds, per-lead valid time, radius, observed-frame availability and verification counts, method card, legends |
| GET | `issues/{ep}/{ts}/ui-alerts?level=warning\|all&hazard=&lead=` | normalized alerts (GeoJSON geometry + `display` + `level` + `verification`); Warnings only by default |
| GET | `issues/{ep}/{ts}/alerts/{alert_id}` | full explanation: calculation trace, SHAP top-5 waterfall, confidence, basin block |
| GET | `issues/{ep}/{ts}/map/{lead}/{field}.png` | overlay PNG (`rain_p1`, `rain_p10`, `rain_p30`, `thunderstorm`, `cloudburst_index`, `flash_flood`, `observed_ge30`) |
| GET | `issues/{ep}/{ts}/map/{lead}/missed_ge30.png?level=&hazard=` | observed ≥30 mm/hr cells outside the alerts currently displayed (derived; no counts) |
| GET | `issues/{ep}/{ts}/files/{name}` | raw files: `manifest.json`, `alerts.geojson`, `explain.json`, `grids.json`, `prob_L{1,2,3,4,6}h.tif`, figure PNGs |
| GET | `india/meta`, `india/map/{lead}/{field}.png` | national sample (probability maps only) |
| GET | `issues/{ep}/{ts}/alerts.cap.xml`, `live/{run}/alerts.cap.xml` | CAP 1.2 messages (replay Exercise / live Test; `?alert_id=` for one) |
| POST | `issues/{ep}/{ts}/alerts/{id}/cap.xml`, `live/{run}/alerts/{id}/cap.xml` | one approved alert as a CAP file (body `{"review":"approved", headline?, description?}`) |
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
- **IMD colour pills**: a labelled pill next to every Watch/Warning badge (map legend, alert cards,
  explain panel, live alert panel, documented-event check cards) — Watch = "Orange", Warning = "Red",
  no alert = no pill. (A plain 10 px dot was replaced because it looked like the hazard dot and its
  orange was close to the thunderstorm colour.)
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
- **Ingredients panel** (drawer → Ingredients, `IngredientsTab.jsx` + `IngredientsPanel.jsx`): summed SHAP per ingredient group
  (moisture, instability, lift & wind, observed rain & motion, terrain, ground wetness) as a
  diverging bar each, plus "lead time (not weather)" separately; heading "Ingredients: contribution
  to this alert (log-odds, ranking not magnitude)".
  - Thunderstorm/cloudburst: "explains the ≥30 mm/hr rain probability behind this alert (log-odds,
    before calibration)"; cloudburst adds "+ orographic boost applied after the model (not in
    SHAP): …" quoting the index formula from the alert's calculation trace.
  - Flash flood: the ≥10 mm/hr model at the basin's strongest-inflow cell, labelled that the basin
    ratio itself is not explained by SHAP.
  - Below the bars, two descriptive demo lines (lead-time trend; moisture split) and the scope line,
    generated by the API from `serve/assets/ingredients/AGGREGATE.json` (REF045 + REF051 only).
  - Below that, a **Validation 2022–23 (descriptive)** block from `AGGREGATE_VAL.json`: the same
    two statements over validation alert-selected rows, each stated only if it holds in both 2022
    and 2023 (otherwise "mixed across years"), with the scope "Validation 2022–23, alert-selected
    rows; ≥30 model: all 343,851 rows; ≥10 model: estimated from a 25% deterministic sample
    (373,636 of 1,498,609 selected rows). Descriptive."
  - Forecast-only issues (REF051 13:00Z) and live alerts show "Not available".
- **Documented-event check** (drawer → Event check, REF045 and REF051):
  - Event times come from the cited reports (`nowcast_data/catalog/documented_event_times.csv`).
    Label: "Checked against the documented event location, not satellite rain; IMERG may not
    resolve cloudbursts." and "IMERG verification and documented-report check can disagree;
    both are shown."
  - An early warning is an alert that covers the site, was ISSUED before the event window
    starts and is VALID during it (± 1 h tolerance).
  - Each alert shows hours of warning, area, peak→site distance, "precise" (≤ 25 km and
    ≤ 5,000 km²) or "broad area", and its IMERG status.
  - Date-only reports (Tosh) make no before/after claim.
  - **Warning timeline** (`WarningTimeline.jsx`, top of the timed site; the section is up to 900 px wide, narrower on small screens, with the hour axis labelled every 2 h):
    a UTC time bar with rows for the reported event window [reports], the IMERG ≥30 mm/hr onset and
    peak within 25 km of the site [satellite] (Pipalkoti: "never reached 30 mm/hr", peak 17.52),
    the ERA5 TCWV anomaly, its change since the previous issue and the CAPE anomaly per issue
    [model inputs] ("n/a" gap for the forecast-only 13:00Z issue), one lane per qualifying alert
    [model] from issue time to the window start labelled with its hours of warning, IMD pill,
    precise/broad and IMERG status, and the 13:00Z nearby-cells lanes under their separate
    criterion. Alerts, nearby cells and the window come unchanged from the event-check API.
    Clicking a lane or an ingredient cell opens that issue (and lead/alert) on the map.
  - The forecast-only 13:00Z issue is shown under a separate criterion: "nearby alert cells
    (≤25 km), not a site-covering alert".
- **Caveats** (drawer → Caveats, each with its verbatim quote and source): low absolute severe-rain skill (val CSI at ≥30 mm/hr 0.20 at 1 h
  down to 0.06 at 6 h), 1 h persistence tie, flash-flood areas 1.2–2.4× too broad, 3 of 7 test
  cloudbursts invisible in IMERG, neighbourhood probabilities, top-scale overconfidence, the
  uncalibrated cloudburst index, replay inputs not real-time, and unofficial boundaries.

## 6. Tests

```powershell
# ML API (no servers needed); NOWCAST_TEST_REPLAY=1 also runs the real-replay tests (none skipped)
cd D:\nowcast_data; $env:NOWCAST_TEST_REPLAY = "1"; D:\.venv\Scripts\python.exe -m pytest serve/tests -q

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
  matching "Orange"/"Red" IMD pill (≥ 10 px tall), and the legend states the "not an official IMD
  warning" note;
- terrain: on by default; placed at exactly the same screen rectangle as the forecast/observed
  rasters (replay and national); its pane is below the raster pane, which is below the alerts;
  the toggle removes it (and its attribution); the opacity slider changes it; it follows the
  episode, including the forecast-only REF051 13:00Z issue and REF025;
- the Data credits footer shows the full Copernicus notice, visible and fully on screen without
  hover, on all three tabs and with the Caveats section open; at 1280×720 and 1366×768 it is not
  clipped, not overlapped and at least 10 px;
- ingredients: the 6 bars and the lead bar equal the API values, and groups + lead + base = the
  raw log-odds; labels per hazard (≥30 vs ≥10), the cloudburst boost line, the demo aggregate
  lines; "Not available" on the forecast-only issue and on live alerts; REF025 keeps its badge;
- validation lines equal the API (per model) next to the demo statement;
- Results page: every plotted v0 CSI point equals the API (which equals the score CSVs), the caveat
  markers match the flags, case-study texts use the event-check numbers, the timeline link opens the
  issue; Approach page: 9 rows with the API statuses, IWV attribution with its validation scope, the
  IMERG evidence and the latency arithmetic;
- warning timeline (REF045, REF051 at 1920×1080): the alert and nearby-cells markers equal the
  event-check API (ids and hours of warning = window start − issue time), every row has its source
  label, IMERG texts match the data, the forecast-only gap shows, and clicking a marker opens that
  issue/lead/alert;
- at 1280×720 and 1366×768 the legend and the Layers panel start collapsed (the summary shows the
  lead), every control (episode, issue, lead, layer, terrain, Watch) is reachable inside the map and
  usable, and the expanded legend stays inside the map; at 1600 px the legend starts open;
- layout (U1) at 1920×1080 and 1366×768: drawer collapsed by default with all section icons; badges
  and the credits in view; clicking an alert polygon opens the Alert section; only one section is
  mounted at a time (Alert → Ingredients → Event check → Caveats, with screenshots of each); Esc, ×
  and the active icon close it; the Layers panel, zoom control and legend stay inside the map and
  are never covered by the drawer; National/Live use the same frame; the legend lists only visible
  layers (hazard swatches follow the hazard toggles, terrain row follows the terrain toggle, the
  forecast-layer entry only when one is selected, no alert entries with all hazards off);
- Results and Approach pages at 1366×768: no horizontal overflow and no clipped element;
- CAP review (1920×1080, 1366×768, live): "Download CAP" is disabled until the alert is approved;
  reject and edit disable it again; the downloaded file has status Exercise (live: Test, never
  Actual), the edited headline/description and "approved for issue (demo) … edited"; the review
  applies to that alert only; the format line and "nothing is ever sent anywhere" are shown; no
  request leaves the machine except map tiles;
- INSAT-3DR (1920×1080, 1366×768):
  - the layer is off by default; when on, the image is the API's scan for that issue time, e.g.
    REF045 15:00Z → the 13:45Z scan;
  - no scan with acquisition end + latency after the issue time is ever shown (3 REF051 issues); an
    early REF045 issue says that no image is available;
  - same bounds as the forecast rasters; opacity works; legend only while on, with both lines;
  - REF025 shows "not available";
  - timeline cells equal the API series (values and 30-min changes, by scan time); 3 hatched gaps on
    REF045 and no change after the gap; lines and reference quote present; no "%", "validat" or
    "early signal";
  - credit line and DOI in the footer.

**Notes (I2c)**
- `pypdf` 6.19.0 was installed in `D:\.venv` only to read source PDFs (threshold and MOSDAC
  documentation). It is not a serve dependency; the constrained dry run showed no other package change.
- `start_demo.ps1` starts the team backend (and the frontend) only after :8001 answers `/api/health`
  (polled, max 60 s). Otherwise it stops and says so.
- Approach page: only the cloud-top-temperature row changed, to "Observation layer delivered" plus
  the INSAT note. Not a model input; using INSAT in the model needs INSAT history + retraining.

**Known issue:** one 502 from the `/ml` proxy was seen once, right after a server restart (I2b
screenshots). It did not recur in later page loads or in the e2e runs.

**Dashboard ("/"), option A (honest labels, no redesign)**
- **Weather source:** the backend returns `source` (`openweather` | `sample`) and, for OpenWeather,
  its own observation time (`observed_at`, from `dt`).
  - `/alerts` also returns `summary.source` and `summary.latest_observed_at`.
  - The map badge says "Sample data — no live weather feed" or "OpenWeather, observed HH:MM UTC".
  - OpenWeather calls use https.
  - The "LIVE" badge on the Alerts sidebar item shows only when the source is OpenWeather.
- **Risk:** the name-hash "controlled randomness" (±25 % multiplier, ±0.10 jitter, and the hash-picked
  "coastal" places) is removed from `compute_hybrid_risk`. Identical weather now gives identical risk
  (`tests/test_dashboard_backend.py`).
- **Risk panel:**
  - Low / Moderate / High per hazard, "rule-based, not the ML model"; no % anywhere on the page.
  - The primary threat exists only for MODERATE / HIGH zones; its card is shown only for HIGH zones
    (calm-down fix below).
  - A MODERATE / HIGH zone never shows "stable" text; a zone without an explanation says
    "No explanation available".
  - "Rule-based explanation" replaces "AI Decision Transparency".
  - A line under the panel links to the ML Nowcast.
- **Map:**
  - Map = OSM (`https://tile.openstreetmap.org/...`).
  - Satellite = NASA GIBS `VIIRS_SNPP_CorrectedReflectance_TrueColor`, yesterday UTC, no key.
  - Terrain = OSM + our Copernicus DEM hillshade (`/ml/terrain/national.png`), with its credit.
  - The legend shows the three rule-based risk colours, with no % thresholds.
  - The event-layer toggles filter markers by primary threat; low-risk zones always show.
- **Other:** the timeline is replaced by a card "Per-lead forecasts (…) → ML Nowcast" (the leads are read
  from `/ml/india/meta`); "View Details" → `/alerts`; "All Clear" / "Safe" → "No high-risk zones in this
  data"; the hero card has no fixed city, temperature or sky.
- **Known issues (not changed):** the sidebar "Live Map" and "Locations" items only reload the zone
  list; "Settings" opens Analytics; the avatar does nothing. The sklearn pickle
  (`rainfall_model_v2.pkl`) is unchanged: its inputs are month, day, state and district, not weather.
- **Tests:**
  - `D:\.venv\Scripts\python.exe -m pytest tests -q` (team backend);
  - `e2e/dashboard.spec.js`: tiles are intercepted, so no network is needed.

### Calm-down fix (30 Sep 2026)

**Team rule change: flash-flood gate** (`backend/main.py`, `flash_flood_gate`):
- With 0 mm rain in the last hour (shown as 0.0 mm), the flash-flood indicator cannot be above Low.
  - Its score is held at the LOW-zone score, 0.08 (the page's Moderate cut is 0.40).
  - The reason ends "; flash flood Low (no rain in the last hour)", and `prediction.flood_note` =
    "no rain in the last hour" is shown next to Flash Flood in the panel.
- It applies to `/alerts` (Dashboard, Alerts, Forecast) and `/predict` (Dashboard search).
- Why:
  - `/alerts` gives every MODERATE zone a flat flash-flood score of 0.45 (Moderate). That score is also
    the largest of the three flat scores (0.45 / 0.40 / 0.35), so "Flash Flood" became the primary
    threat of every MODERATE zone.
  - A zone is MODERATE when humidity > 70 % (`predict_nowcast`). So Mumbai at 0.0 mm rain, 84 %
    humidity and 1.8 m/s wind showed a Moderate flash flood as its primary threat.
- The zone's risk level, the humidity rule and the thunderstorm / cloudburst scores are unchanged.
- Test: `tests/test_flash_flood_gate.py`.
- Humidity rule, not changed, just counted. With Open-Meteo data_time 2026-09-29T18:30Z, all 343 of
  380 zones were MODERATE only because of humidity > 70 % (rain ≤ 5 mm, wind ≤ 6 m/s). 290 of them had
  0.0 mm rain.

**Panel (`RightPanel.jsx`):**
- The "Primary Threat" card is shown only for HIGH zones. Low / Moderate zones open with the weather
  tiles, then "Hazard indicators (rule-based, not the ML model)", then the explanation.
- "Rule-based explanation" shows the explanation sentence and the rule reason once each.
  "No explanation available" appears only when there is neither, and never next to a "Reason:".
  The invented fallback reasons were removed.

**Banner (`AlertBanner.jsx`):**
- The warning-style banner (icon + "High Alert" pill) appears only when there are HIGH zones.
- Otherwise a neutral strip: "Rule-based indicators: N moderate, 0 high zones (Open-Meteo model data).
  Not an official warning." The source part reads "sample data" / "OpenWeather observations" as
  applicable.

**Time labels:**
- "Last Updated HH:MM:SS" (panel) and "Last updated …" / "Reported: …" (Alerts) became
  "Fetched HH:MM UTC", i.e. when the page fetched the data (browser clock, in UTC).
- The backend's timestamps were naive server-local times at the time; fixed in the pre-hosting fix
  below.

**Tests:** `e2e/calm.spec.js`, with mocked zones:
- primary-threat card hidden for Moderate, shown for HIGH;
- no warning banner with 0 HIGH zones;
- never "No explanation available" together with "Reason";
- "Fetched HH:MM UTC" labels;
- the flash-flood note.

### Pre-hosting fix (30 Sep 2026)

**Alerts card sentence = the rule(s) that fired.**
- `/alerts` items now carry `rules_fired`: the `predict_nowcast` rules that put the zone at its level
  (`backend/main.py`, `rules_fired`). The rules and levels themselves are unchanged.
  - MODERATE: "Rain above 5 mm in the last hour", "Humidity above 70 %", "Wind above 6 m/s".
  - HIGH: "Rain above 20 mm in the last hour", "Humidity above 90 % with wind above 8 m/s".
- The card shows them joined with "; " plus " (rule-based).", e.g. "Humidity above 70 % (rule-based).".
  LOW cards keep "No rule-based hazard flagged for this zone.".
- This replaces the generic line "Moderate rainfall or wind by the page's rules." and the type-based lines
  such as "Heavy rainfall may cause flooding in low-lying areas."
- With Open-Meteo data_time 2026-09-29T19:00Z: 339 zones "Humidity above 70 %", 2 zones "Rain above 5 mm
  in the last hour; Humidity above 70 %", 39 LOW, 0 HIGH.

**UTC timestamps.**
- The team backend emits timezone-aware UTC ISO times ending in "Z" (`utc_now_iso()`): `timestamp` and
  `last_updated` in `/alerts` and `/batch_predict`, `timestamp` in `/predict`, `/nowcast` and the legacy
  `generate_alerts`.
- `datetime.now()` is still used only for the month/day inputs of the team predictors and for the
  sample-data seed hour. These are not emitted as times.
- Frontend (`parseUtcIso` in `utils/dashboardRisk.js`) reads only timezone-aware times. A naive time
  falls back to the fetch time instead of being read as browser-local.
  - Alerts: "Live • N min ago" is computed from each item's `timestamp`, and "Fetched HH:MM UTC" from
    `last_updated`.
  - The Dashboard's "Fetched" label still uses the browser fetch time (unchanged page).

**Forecast: hourly outlook removed.**
- Removed, all synthesized in the browser from one current reading and the flat rule scores:
  - `normalizeCityForecast`, which invented +1…+4 h rain/humidity/wind/temperature/risk;
  - the built-in Mumbai 5-hour series;
  - the timeline slider;
  - the "Future alert preview" ("High risk expected in +N h" …);
  - the "Rainfall Trend Chart (0–4h Projection)" with Peak / Average / Baseline / Trajectory;
  - the "Risk Progression Bar";
  - the "Now vs +4h Change" card ("Projection Mode: Sub-Daily NWP Continuous").
- In their place, one line: "Hourly forecasts are not available on this page. Calibrated 1–6 h
  nowcasts: ML Nowcast →" (link to `/nowcast`).
- Headings no longer claim a 0–4 h prediction or extrapolation: "Nowcasting Engine (current
  conditions)", "Now".
- Leftovers, fixed in the next checkpoint (Forecast page only, `e2e/forecast_leftovers.spec.js`):
  - Risk Indicator Bar:
    - "Score: 90/55/20 %" became "Level: Low / Moderate / High (rule-based)" (no %);
    - its footer states the rule(s) that fired now, from `rules_fired`, e.g. "Humidity above 70 %
      (rule-based)". A LOW zone reads "No rule fired (rule-based)". A searched place (`/nowcast`, no
      `rules_fired`) reads "Rule-based level; the rule that fired was not reported".
  - "AI Forecast Insight" became "Rule-based summary", without the XAI pill.
    - Its subtext names the weather source from the backend's `source` field: "Open-Meteo model data" /
      "OpenWeather observations" / "sample data".
    - The invented narrative subtexts ("Urban drainage overflow likely", "active convective cell
      development", …) were replaced by that line.

**Alerts wording (30 Sep 2026, Alerts page only):**
- The summary cards read:
  - "Zones monitored / rule-based indicators from current weather" (was "Total Alerts / Active alerts
    across India");
  - Moderate: "Moderate on rule-based indicators" (was "Advisory watch status");
  - Low: "No rule fired" (was "Controlled baseline").
- Subtitle, for every source: "Rule-based indicators from current weather (not the ML model). ML
  forecasts: ML Nowcast →" (link `/nowcast`). It was "Real-time weather threats and emergency
  notifications" on live data.
- The source pill and the "Fetched" label no longer wrap.
- Test: `e2e/prehosting.spec.js` ("Alerts wording").

### Friendly backend-wake state (30 Sep 2026, frontend only; audit F3)

- **Where:** every request to the team backend or the ML API goes through
  `fetchWithWake` (`src/utils/serverWake.js`).
  - Team pages: Dashboard `/alerts` and `/predict`; Forecast `/batch_predict` and `/nowcast`;
    Analytics; Alerts; Reports.
  - ML pages and components: via `services/nowcastApi.js`.
- **When it retries:** a network failure, a timeout (30 s per attempt) or HTTP 502/503/504. It retries
  every 5 s for up to 90 s.
- **What the user sees:**
  - While it retries, one small notice (bottom centre, `ServerWakeNotice`): "Starting the server — this
    can take up to a minute on the free host…".
  - After 90 s: "Server unavailable — please refresh in a minute." The page error slots use the same
    sentence:
    - Alerts: error line, and the source pill reads "Server unavailable";
    - Dashboard: error line;
    - Forecast: status line;
    - Analytics: "built-in example data (server unavailable)";
    - Reports: status "Server unavailable";
    - ML pages: their error lines.
- **What it never retries:** other HTTP answers (404 "not available", 403 replay disabled, 500 …).
  They are passed through unchanged.
- **No raw details:** addresses, ports and error class names are never shown.
  - Removed: "Cannot reach the nowcast API at http://…:8000/ml. Is it running?".
  - The Dashboard search no longer shows a browser error such as "Failed to fetch".
  - When `/predict` gives up, the Dashboard search shows "Server unavailable" instead of adding the
    place with a default LOW level.
- **Not covered:** map images (`<img>` PNGs) are not retried. The notice covers them only because the
  page's JSON requests fail first. `services/api.js` (axios) is not imported anywhere.
- **Test timings:** `window.__SERVER_WAKE__ = { retryMs, budgetMs, attemptMs }` shortens them. e2e only.
- **Tests:** `e2e/server_wake.spec.js`.
  - Recovery with the real 5 s retry: `/alerts` aborted for 7 s, `/batch_predict` aborted for 6 s,
    ML API answering 503 for 6 s.
  - A 404 is not retried.
  - All 8 routes end on "Server unavailable" with no address or error name.
  - Screenshots of the notice at both sizes.
  - The backend-down tests in `honesty_batch1.spec.js` now expect the new wording.

**Tests:**
- `tests/test_utc_timestamps.py`: the same frozen instant, server in UTC and in India time (TZ
  `UTC0` / `IST-5:30` on Windows, `UTC` / `Asia/Kolkata` elsewhere), gives identical "…Z" output.
- `tests/test_rules_fired.py`.
- `e2e/prehosting.spec.js`, with the browser in Asia/Kolkata:
  - rule sentences;
  - "Live • 7 min ago" and "Fetched HH:MM UTC";
  - a naive time is not read as local;
  - no hourly outlook on Forecast;
  - screenshots.

### Open-Meteo on the free host + sample-data safety net (30 Sep 2026)

**Cause on Render:** `/weather_source` showed `requests 4, errors 4`. All four Open-Meteo batches
(100 locations each) failed, so all 380 zones fell back to sample values: 39 HIGH zones with no weather
feed behind them. The old counters did not say why the requests failed. The new `last_error` field
will show it on the next deploy.

**Backend (`utils/api_fetcher.py`, `backend/main.py`):**
- **Diagnostics:** `/weather_source` → `open_meteo` now has:
  - `last_error`: `"HTTP 429: <reason>"` or `"<ExceptionClass>: <message>"`, at most 160 characters,
    no secrets;
  - `last_error_at`, `last_success_at`, `cooldown_until` (UTC);
  - the counters `retries` and `stale_served`.
  - The server log has one `[OPEN-METEO] batch of N failed (attempt k): …` line per failure.
- **Timeout** 25 s per request (was 10 s).
- **Retries:** only after HTTP 429 or a timeout; up to 2 more attempts per batch.
  - The wait is the `Retry-After` header when present, else 2 s, then 4 s.
  - If `Retry-After` is over 60 s (e.g. a daily limit), the request is not retried.
  - Other errors are not retried.
- **Stale data before sample data:** every successful result stays in memory.
  - If a batch still fails, each point gets its last successful Open-Meteo values, flagged
    `weather.stale` / `summary.stale`.
  - The badge keeps the real model time, "Open-Meteo (model data), updated HH:MM UTC".
  - Only points that never had Open-Meteo data become sample.
- **Call limits kept:**
  - the 60-min fresh cache is unchanged;
  - after a batch finally fails, the remaining batches of that refresh are not sent;
  - no new request is sent for 30 min (`OPEN_METEO_COOLDOWN`).
- **Startup warm-up:** the zone list is fetched once, in the background, at startup. `/health` never
  waits for it. `WEATHER_WARMUP=0` turns it off. It is skipped when a key is set or Open-Meteo is
  disabled.

**Safety net (frontend):** when the zone source is `"sample"`, "/", Alerts, Forecast and Analytics
show `SampleSafetyNotice`:
- the text: "Sample data — no live weather feed. Risk indicators are not shown on sample data.";
- the link "Calibrated 1–6 h nowcasts: ML Nowcast →".

What is hidden on sample data:
- "/":
  - the High/Moderate banner and info strip;
  - the header count;
  - the risk legend and Risk Distribution counts (replaced by "N zones (sample data)");
  - risk colours in markers and popups (neutral grey);
  - in the right panel: the risk pill, Primary Threat, hazard levels and rule explanation.
  - The weather tiles stay, labelled "Sample data — no live weather feed".
- Alerts: the count cards, filters, alert cards and the "No active alerts" empty state. It shows
  "N zones loaded (sample data)" instead.
- Forecast:
  - the risk pill and the node-list pills;
  - the Rule-based summary (SEVERITY) and the Risk Indicator Bar.
  - Current values stay.
- Analytics:
  - the risk colours in the bar chart, which is renamed "City Rainfall Comparison (sample data)";
  - the warning-threshold line;
  - Risk Distribution, Key Insights and Top Risk Cities.
  - The averages stay.
- Mixed lists and the Analytics server-unavailable fallback: closed in A2 (next section).

**Tests:**
- `tests/test_open_meteo.py`, 8 new tests, all HTTP mocked:
  - 429 → Retry-After waits → success;
  - backoff without Retry-After, and a long Retry-After is not waited for;
  - 503 is not retried;
  - 3 timeouts → stale data with its real time; the 2nd batch is not sent;
  - the cooldown sends no requests;
  - everything fails → sample, and `last_error` is exposed on `/weather_source`;
  - stale flag in the zone list;
  - the warm-up does not block `/health`.
- `e2e/sample_safety.spec.js` (6 tests):
  - sample with HIGH/MODERATE zones injected: the safety net and no risk UI on each of the four pages;
  - stale Open-Meteo keeps its risk UI with the "updated 06:15 UTC" badge;
  - screenshots `sample_net_*` at 1920×1080 and 1366×768.
- Updated for the new behaviour: `weather_sources`, `forecast_leftovers`, `team_pages`,
  `honesty_batch1`, `dashboard`, `calm`, `prehosting` and `server_wake` specs.
  - Their sample branches now expect the net.
  - Three risk-UI Dashboard tests and one Alerts-card test skip on a sample backend.
  - Also run against a real sample backend (`OPEN_METEO_DISABLED=1`: 380 zones, 39 HIGH): all pass or
    skip.

### A2: mixed zone lists and the Analytics fallback (1 Oct 2026)

**Per-zone source (backend, `backend/main.py`):**
- Every zone in `/alerts`, `/zones`, `/dashboard`, `/analytics` and `/batch_predict` carries
  `zone_source`: `openweather`, `open_meteo`, `open_meteo_stale` or `sample`. `source` and
  `weather.source` are unchanged.
- **A `sample` zone carries no risk** (`risk_level`, `risk`, `severity`, `type` are null, `prediction`,
  `probabilities` and `alert` are null, `rules_fired` is `[]`). Its `message` is
  "Sample data — risk not shown". It is listed after every rated zone.
  - This holds for all-sample lists too. The safety net stays as before.
- **Summary:**
  - `high` / `moderate` / `low` count rated zones only; `n_rated` is their sum;
  - `total` is still every zone;
  - `zone_sources` gives the count per source;
  - `data_time_min` is next to `data_time`.

**Pages (mixed list = some zones sample, some with weather data):**
- **Badge** (from the real counts): "Open-Meteo (model data) for N of 380 zones, updated HH:MM UTC".
  - When the zones' model times differ, it shows the range, "updated HH:MM–HH:MM UTC".
  - For OpenWeather: "OpenWeather (current weather) for N of T zones, updated HH:MM UTC" (A3).
  - The Open-Meteo credit is shown next to it.
- **"/":**
  - the banner counts rated zones only ("(rule-based, zones with weather data only)");
  - the neutral strip says "(zones with weather data only; S zones with sample data: risk not shown)";
  - Risk Distribution shows rated zones with "+S with sample data (risk not shown)";
  - sample markers are grey, their tooltip and popup read "Sample data — risk not shown", and the
    legend adds "Grey: sample data — risk not shown";
  - a selected sample zone shows "Sample data — risk not shown" in the right panel: no pill, Primary
    Threat, hazard levels or explanation.
- **Alerts:**
  - no card for sample zones;
  - "All (N)" and the High/Moderate/Low cards count rated zones;
  - the "Zones monitored" caption says "S zones with sample data: risk not shown".
- **Forecast:**
  - a sample node shows the safety-net notice; a rated node shows its level;
  - "Node list: <badge>; S zones with sample data: risk not shown."
- **Analytics:**
  - every figure and risk chart (averages, bar chart, Risk Distribution, Key Insights, Top Risk
    Cities) uses only the zones with weather data;
  - a note states the counts.
- **Analytics server unavailable:** the built-in example cities are removed. The page shows the
  safety-net notice (with the ML Nowcast link) and "Server unavailable — please refresh in a minute.",
  and no figures. While loading it shows "Loading analytics…" (it used to show the example figures).

**Tests:**
- `tests/test_open_meteo.py`:
  - mixed list: sample zones carry no risk and are left out of the counts;
  - all-sample list: no risk at all.
- `e2e/mixed_zones.spec.js` (8 tests). Sample zones keep HIGH fields in the mock, so the pages are shown
  to hide them by zone source.
  - Mixed case on all four pages; an Open-Meteo HIGH zone keeps its risk.
  - The neutral strip counts.
  - Analytics server-unavailable.
  - Screenshots `mixed_*` at 1920×1080 and 1366×768, and `analytics_unavailable_1600x1000.png`.
- `honesty_batch1` (backend-down Analytics) and `sample_safety` (panel wording) updated.

### A3: OpenWeather path + Key Insights (1 Oct 2026)

On Render, Open-Meteo answers "HTTP 429: Daily API request limit exceeded" (a shared outgoing IP), so the
OpenWeather path, used when `OPENWEATHER_API_KEY` is set, was made safe for the free tier.

**Before (audit):**
- Endpoint: Current Weather API 2.5, `https://api.openweathermap.org/data/2.5/weather` (lat, lon), one
  call per point. Place search also used the Geocoding API (`geo/1.0/direct`, 1–2 calls per new name).
- One refresh of the 380-zone list = 380 calls, fired 20 at a time with no throttle. That is far above
  the free tier's 60 calls/minute, so bursts would be refused with 429.
- The list was cached 30 min, and the 100-zone list (Forecast/Analytics; 27 of its points are not in
  the 380) was cached separately. Per-point cache 5 min.
- With pages open all day this is up to 380 × 48 + 100 × 48 = 23,040 calls/day.
- On failure a zone went straight to sample data (no Open-Meteo fallback).
- Error lines printed the exception text, and a `requests` exception includes the URL with `appid=`.
  The key could reach the log.

**Now (`utils/api_fetcher.py`, `backend/main.py`):**
- **One throttle** (`CallThrottle`) for every OpenWeather call (zone lists, searches, geocoding):
  at most 50 in any rolling 60 s. The free tier is 60/min.
- **Per-point cache 60 min** (`OPENWEATHER_TTL`).
- **The zone lists never wait for the network.**
  - They read the OpenWeather cache only.
  - A background refresher fetches missing or expired points under the throttle. A full 380-zone
    refresh takes about 7.6 min.
  - The list is rebuilt every 2 min to show its progress. The rebuild itself makes no OpenWeather call.
- **Daily total:** at most 407 distinct points (380 + 27) × 24 = 9,768 calls/day, about 303,000 in a
  31-day month. The free tier allows 1,000,000/month. Place searches add a few calls each.
- **Retry:** HTTP 429 and timeouts (25 s) are retried twice, with `Retry-After` or else 2 s then 4 s,
  as for Open-Meteo.
- **After a final failure:**
  - the refresh stops and a 30-min cooldown starts;
  - expired data is served flagged stale (`zone_source` `openweather_stale`, with its real time);
  - points with no data fall back to Open-Meteo, then to sample.
  - Searches (`/predict`, `/nowcast`) also fall back to Open-Meteo, then sample.
- **Startup warm-up** also runs with a key. It only starts the throttled refresher, so it never
  bursts.
- **`/weather_source` → `openweather`:**
  - `last_error` / `last_error_at` / `last_success_at` / `cooldown_until`;
  - `refresh_running`, the request counters, `max_calls_per_min`, `cache_s`;
  - `openweather_key_set` (true/false).
  - Never the key: it is sent only as a request parameter, and every error text is redacted
    (`appid=***`) before it is stored or printed.
- **Rain:** `rain.1h` (mm in the last hour), 0 when OpenWeather omits `rain`. A response with only
  `rain.3h` is not used as a one-hour value.
- **Data time:** OpenWeather's `dt`.
- `requests` is no longer used by `api_fetcher.py`. The unused `async_fetch_weather` /
  `async_get_weather_by_coords` are removed.

**Pages:**
- Badge: "OpenWeather (current weather), updated HH:MM UTC" (never "observed").
- Mixed lists: "OpenWeather (current weather) for N of 380 zones, updated HH:MM UTC". With Open-Meteo
  zones too, a second part "; Open-Meteo (model data) for M of 380 zones, updated HH:MM UTC". Each part
  uses its own source's times (`summary.source_times`).
- The sample safety net and the per-zone sample rule are unchanged.
- **Attribution** (OpenWeather terms: "Weather data © OpenWeather", on the screen where the data
  appear): `OpenWeatherCredit.jsx` next to the badge on "/", Alerts, Forecast and Analytics and in the
  Dashboard panel.
  - Plus an `openweather` entry in the team credits (`nowcast_data/serve/assets/credits/SOURCES.json`).
  - Quotes and limits are in `backend/assets/openweather_terms.json`. They are an exact match in the
    page text fetched 2026-10-01 (openweathermap.org/price and /full-price#licenses).

**Analytics Key Insights:** every sentence is built from the zones' own values. The fixed templates
("…precipitation exceeding 20 mm/hr", "coastal and delta corridors", "Southern and Western sectors",
"latent heat flux…") are removed.
- "Rule-based HIGH in K of N zones. <city>: <rule(s) fired> (rain X mm in the last hour)." Up to 3
  zones, most rain first.
- Or: "No zone at rule-based HIGH; M of N zones at MODERATE."
- "Wind: average A m/s across N zones; highest B m/s at <city>."
- "Relative humidity: average A % across N zones; highest B % at <city>."

**Tests:**
- `tests/test_openweather.py` (11, all mocked, simulated clock, fake key):
  - success, with the endpoint and parameters checked;
  - 60-min cache;
  - `rain.1h` only;
  - 429 → Retry-After → success;
  - throttle: 380 calls, never more than 50 in 60 s, sync callers share the budget;
  - timeouts → stale data + cooldown;
  - all fail → Open-Meteo → sample;
  - mixed OpenWeather/sample list;
  - searches fall back;
  - `/weather_source` shows the redacted error, and the key appears in no output;
  - warm-up with a key stays under the throttle;
  - the terms record matches the limits.
- `e2e/openweather.spec.js` (6):
  - badges and attribution for all-OpenWeather, OpenWeather + sample, and three sources;
  - Key Insights with a HIGH zone that has 0.4 mm rain (its only rain figure is 0.4 mm; no "exceeding",
    "mm/hr", "20 mm" or place-region text);
  - no-HIGH case;
  - screenshots `openweather_dashboard_*` / `openweather_analytics_*` at 1920×1080 and 1366×768.
- Updated: `weather_sources`, `dashboard`, `forecast_leftovers` (new OpenWeather wording, credit),
  `credits` (team list), and `serve/tests/test_credits.py`.

### A4: hosted parity + Primary Threat (1 Oct 2026)

**What was different on the host (Render):**
- On the deployed API, every endpoint that read a GeoTIFF with rasterio answered **HTTP 500**:
  - all probability map PNGs (`issues/…/map/…png`, `india/map/…png`, `live/…/map/…png`);
  - the missed-cells map (`missed_ge30.png`, via `rasterio.features.rasterize`);
  - REF051's event check (and its timeline, which uses it).
- Everything else was 200: JSON, alerts, meta, terrain, INSAT, observed PNG, CAP.
- The Live tab loads its run, alerts and legend from JSON. Its forecast map layers are all these PNGs,
  so on the host the Live map showed no probability layer.
- Checked with curl on 1 Oct 2026. The same URLs are 200 locally, including from the space folder on
  Windows. So rasterio/GDAL fails inside the Linux container.
  - The exact error is only in Render's log, which I cannot read.
  - Running the previous host package with rasterio made unimportable reproduces the same 662 of 1,123
    failing frontend paths. All other paths were identical.
- No file was missing from the package:
  - live run, national sample and all case-study issues are shipped;
  - the excluded national/live `grids.json` are read by no endpoint;
  - `demo_replays/` is replay-only.

**Fix: the host reads no GeoTIFF with rasterio:**
- `nowcast_data/serve/rasters.py` `read_bands()`: reads `prob_L{L}h.bands.npz` next to a GeoTIFF when
  present (numpy only), else the GeoTIFF with rasterio as before.
  - `render.read_tif_band` and `event_check._nearby_cells` use it.
- `hosting/build_space.py` writes the `.npz` for all 190 shipped GeoTIFFs with this machine's rasterio:
  +10.8 MB, host total 131.2 MB, largest file still 5.7 MB.
- `store.coverage` (missed cells) uses `store.cells_with_centre_in` (shapely, cell centre inside the
  alert polygon), the same rule as `rasterize(all_touched=False)`.
- Checked (`serve/tests/test_host_rasters.py`):
  - identical to rasterize on every demo issue × lead × level × hazard filter;
  - identical bands and byte-identical PNGs from the `.npz`;
  - REF051 event check identical without rasterio.
- `hosting/requirements-host.txt` no longer installs rasterio. That also removes GDAL from the
  container's memory.

**Replay:** `ML_REPLAY_ENABLED=0` on the host. `/ml/replay/status` says `enabled: false`, and the
frontend already shows "On-demand replay is disabled in the hosted demo" instead of the button, so no
view offers something the host cannot do.

**Measured** (space folder, host env `PORT=10000`, `ML_REPLAY_ENABLED=0`, rasterio unimportable; this
laptop, full CPU):
- Clicking through every ML Nowcast view:
  - 130 `/ml` requests on each side, identical statuses (129 × 200, 1 × 404: the REF025 timeline,
    not available for the in-sample event, on both sides);
  - RSS 181 MB at start, **233 MB peak** (Render free: 512 MB).
- Slowest requests:
  - REF051 event check / timeline ≈ 1.9 s at full CPU (≈ 0.25 s in-process without the browser);
  - map PNGs ≤ 0.4 s.
  - At Render's 0.1 CPU these are roughly 10× slower, so ~2–20 s for the first REF051 event check.
  - Nothing above ~10 s at full CPU; results are cached after the first request.

**Tests:**
- `tests/test_host_parity.py`: 1,123 frontend `/ml` paths (every endpoint in
  `services/nowcastApi.js`: all issues, leads, fields, missed maps, INSAT, CAP, national, live) must
  answer with the same status on the space-folder app (subprocess, host env, no rasterio) as on the
  full app. Skipped when `hosting/space` is not built.
- `e2e/host_parity_views.spec.js`: the real frontend clicked through Nowcast map (leads, layers,
  drawer sections), REF051, REF025, National, Live, Results and Approach, against the full app and
  against the space-folder app on `:10000`. Every `/ml` status must match. Skipped when `:10000` is
  not running. Start it with (from `hosting/space/team_app`):
  `NOWCAST_DATA_ROOT=..\nowcast_data ML_REPLAY_ENABLED=0 python -c "import sys; sys.modules['rasterio']=None; import uvicorn; uvicorn.run('backend.host_app:app', port=10000)"`.

**Primary Threat (team pages):**
- A hazard is named only when the fired rule points to it: the team's rain rules (above 20 mm in the
  last hour → HIGH; above 5 mm → MODERATE) → Flash Flood.
- The humidity + wind rule names no hazard: "/" shows "Rule-based HIGH: Humidity above 90 % with wind
  above 8 m/s" (label "Rule-based level (no hazard named)").
- Thunderstorm and cloudburst hazard rows say "No rule" (not rated). Flash flood's level comes from the
  rain rule.
- The flat per-hazard scores (flood 0.85 > thunderstorm 0.80 > cloudburst 0.75) are no longer used for
  naming. They made every rated zone's top hazard "Flash Flood" (e.g. HIGH with 0.4 mm rain).
- Alerts cards: "Flash Flood: <rain rule> (rule-based)." or "Rule-based HIGH: <rule>.". Details
  "Hazard: Flash Flood (rain rule)" or "None named (rule-based level)".
- Forecast summary: the same, instead of the fixed sentences "Flood risk rising due to intense
  rainfall" / "Severe thunderstorm conditions forming" (the latter used humidity ≥ 90 and wind ≥ 9,
  not a team rule).
- Backend (`backend/main.py`):
  - `generate_actionable_alert` types "Thunderstorm" / "Thunderstorm Watch" / "High Risk" become
    "Rule-based HIGH" / "Rule-based MODERATE";
  - `/nowcast` also returns `rules_fired`.
- Tests:
  - `tests/test_rules_fired.py`: HIGH from humidity/wind with 0.4 mm rain names no hazard; only the
    rain rule gives "Flash Flood"; `/nowcast` returns the rules;
  - `e2e/primary_threat.spec.js`: "/", Alerts and Forecast, plus screenshots `threat_*` at
    1920×1080 and 1366×768.

### A5: compute-time benchmark (1 Oct 2026)

- **Script:** `nowcast_data/tools/latency_benchmark.py` times one all-India nowcast with the frozen
  lgbm_v0 live pipeline. It calls `nowcast.live.ingest` / `nowcast.inference` unchanged.
- **Inputs:** the 2026-09-26 03:30Z live-run inputs already on disk. No download, no credentials.
- **Runs:** 3, each in a fresh process. Every run reproduced the committed `docs/live_output/20260926T0330Z/`
  exactly (bands and alerts).
- **Machine:** 11th Gen Intel(R) Core(TM) i5-1135G7 @ 2.40GHz, 4 cores / 8
  threads, 7.7 GB RAM.
- **Size:** 93,000 cells × 5 leads = 465,000 rows per
  threshold model.
- **Results** (median, range):
  - per issue with the model loaded: **14.0 s** (12.8–18.2);
  - cold run including imports and model load: 17.1 s (16.1–21.9);
  - peak memory 640 MB.
- **Largest stages:** inference 8.4 s and output writing 3.9 s.
  - Inputs 1.2 s; features 0.20 s (optical flow
    0.02 s).
  - Calibration 0.22 s; alerts + SHAP 0.09 s (8 alerts; more on
    busy issues).
- **Files:**
  - `nowcast_data/docs/latency_benchmark.md`: method, machine, stage table, caveats;
  - `nowcast_data/docs/latency_benchmark.json`: machine-readable. Shipped to the host (`build_space.py`)
    and served as `compute` in `/ml/approach`.
- **Approach page, Live readiness card:** one line, "Our compute time (measured): …". Every number
  comes from the JSON, plus the quoted IMERG Early age: "Data latency dominates: IMERG Early is 5.3 h
  old at our first live poll (~4 h typical)."
  - No NWP comparison (no cited source is stored) and no "real-time" wording.
- **Tests:**
  - `nowcast_data/serve/tests/test_latency.py`: the JSON is complete and consistent; every number in
    the line is from the JSON; no forbidden words.
  - `e2e/latency.spec.js`: the line is shown verbatim after the data-latency arithmetic; screenshots
    `approach_latency_*` at 1920×1080 and 1366×768.

### Honesty fixes batch (1 Oct 2026)

Text/UI fixes on the team pages and the Approach page. Each was investigated first; what was found is
given with the fix.

**1. "safe" / "safer" / "safety" (grep of all of `frontend-react/src`).**
- Changed (visible text):
  - header subtitle on every page: "Hyper-Local Early Warning for a Safer Tomorrow" →
    "Hyper-Local Early Warning System";
  - Dashboard hero: "Stronger Forecasts / Safer Communities" → "Weather Nowcasting / for India". The
    line under it ("Real-time insights. Early warnings. A more resilient India.") → "Rule-based indicators
    from current weather." (sample data: "Sample data: risk indicators are not shown."). The quote
    "Weather-aware today for a safer tomorrow" is removed;
  - sidebar card "Monitoring Today for a Safer Tomorrow" → "ML Nowcast / maps and alerts" (now a link).
- Kept (not visible text):
  - code comments: `RightPanel.jsx` "Safely extract…", "Safe formatting…"; `Forecast.jsx` "Safe
    fallback…", "SAFE SEARCH INPUT UI"; a comment in `utils/dashboardRisk.js`;
  - identifiers and test ids: `SampleSafetyNotice`, `SAMPLE_SAFETY_TEXT`, `sample-safety-net` /
    `-text` / `-ml-link`. Renaming them would change many tests and nothing a user sees.
- The notice text itself ("Sample data — no live weather feed. Risk indicators are not shown on sample
  data.") has no "safe".
- Test: `e2e/honesty_fixes.spec.js` reads the visible text of all 8 pages (`/`, Forecast, Analytics,
  Alerts, Reports, ML Nowcast map, Results, Approach) and fails on `\bsaf(e|er|ety|ely)\b`. No sentence
  is exempt (no official-advice sentence contains the word).

**2. Alerts:**
- The badge "Live Feed · <source>" → "Rule-based indicators from <source>", e.g. "Rule-based indicators
  from Open-Meteo (model data), updated 07:15 UTC".
- Each card's "Live • 5 min ago" → "<source> • 5 min ago", e.g. "Open-Meteo (model data) • 1 min ago".

**3. Analytics:**
- The subtitle ("Real-Time Atmospheric Telemetry, Predictive Risk Stratification & Trends") is now built
  from the real source and counts: "Rule-based indicators from <source>: H HIGH, M MODERATE, L LOW of N
  zones". On sample data: "Sample data for N zones: risk indicators are not shown".
- **Removed: the "Rainfall Trend" chart.** It plotted the current mean rain × fixed multipliers
  (0.4…1.5) for invented hours/weekdays/days, with a fixed 15 mm "Warning Threshold". The
  Today / 7 Days / 30 Days filter changed only that chart, so it is removed too. No rain history exists
  to compute a trend from. The bar chart (top 5 zones by rain) now uses the full width.
- Captions "Across N monitored sectors", "Convective moisture potential", "Surface shear & isobar
  gradient" → "Mean of N zones". "Ranked priority list evaluated against physical meteorological
  danger thresholds" → "Zones ranked by rule-based level, then rain". "Ranked by Threat Urgency" →
  "Rule-based (not the ML model)". "Classification proportions (N nodes)" → "Rule-based levels of N
  zones".
- Banner: "Illustrative figures — not from the ML model" → "Figures on this page are computed from
  current weather with fixed rules — not from the ML model. Measured skill: ML Nowcast → Results"
  (`HonestyBanner kind="rule-figures"`; the `illustrative` kind is gone).
- **Not changed (logic, not text):** the Hazard filter (Flood / Storm / Wind) keeps zones by thresholds
  that are not the team's rules: rain ≥ 15 mm for Flood, wind ≥ 8 m/s for Storm, wind ≥ 7 m/s for Wind.

**4. Reports:** every fixed figure is removed.
- Removed: the four example reports (fixed dates, cities, metrics, river-basin and synoptic text, and
  High/Moderate/Low percentages). Also "Total Reports Today 18 / 4 scheduled bulletins, 14 automated
  dispatches", the "24.8%" start value and the "PDF" export that was really a text file.
- The page now holds one report computed from `/alerts?limit=380`:
  - cards: zones in the list (with the source badge), rule-based HIGH and MODERATE (of the rated zones),
    weather data time;
  - the HIGH / MODERATE / LOW counts with a bar sized by the counts (no percentages);
  - the first 10 zones at HIGH or MODERATE, with the rule(s) that fired, rain and wind;
  - exports: "Export rated zones (CSV)" (every rated zone, its level, rules fired and values) and
    "Export summary (TXT)", both from the same data.
  - On sample data: the safety-net notice and only the zone count and source.

**5. Forecast:**
- Banner: "The risk levels on this page are a rule-based indicator, not the ML model. Calibrated
  nowcasts: ML Nowcast →". The page has no "Score" wording left.
- "Telemetry: …" → "Current weather: …". "Real-Time Location" → "Searched Location (current weather)".

**6. Approach page** (`nowcast_data/serve/results.py`):
- CAP row: "Read-only JSON API for the demo. CAP 1.2 file export built; live feed not built.", status
  "File export built".
- Cloud-top temperature row: "INSAT-3DR cloud-top observation layer delivered (MOSDAC access granted
  28 Sep 2026); not a model input." The old text "needs INSAT imagery (download requires a MOSDAC
  account)" is gone. Status note: "10.8 µm cloud-top temperature on the two case studies. Using it in the
  model needs INSAT history + retraining (roadmap)."
- Compute line: "Our compute time (measured): One all-India nowcast (3 thresholds × 5 leads, 93,000 grid
  cells) takes 14 s median …". It no longer repeats "Compute time".

**7. Header clipping at 1366 px:**
- The left block could shrink, so a long place name squeezed the title.
- Now the title and subtitle never wrap or shrink. The place name is cut with an ellipsis (max 150 px
  below 1536 px, 280 px above; full name on hover). Nav gaps and the search box are narrower below
  1536 px.
- The search placeholder is "Search city…" (it was cut off); the full hint is its accessible name.
- Test: with a 45-character zone name the title fits at 1366×768 and 1920×1080, and the place name ends
  before the nav.

**8. Dead controls:**
- Sidebar "Live Map" (it re-fetched the zone list, the same as "Monitor India") → link to `/nowcast`
  (badge "ML").
- "Locations" (also a re-fetch) and "Settings" (it opened Analytics) → removed.
- Header avatar "A" (no action) → removed.
- Sidebar photo card's arrow → the card's text row links to `/nowcast`.
- The header search on Alerts, Analytics and Reports was a no-op (`onSearch={() => {}}`). It now opens
  `/?city=<name>`, and the Dashboard runs that search once. The same now works from the ML Nowcast
  pages.
- Not changed: the Alerts "LIVE" pill in the sidebar (shown only with OpenWeather / Open-Meteo data,
  existing tests); Forecast's "Live Nowcast Panel" title.

**Tests:**
- New: `e2e/honesty_fixes.spec.js` (10 tests): no safe/safer/safety on any page; header subtitle and no
  avatar on every page; title not clipped with a long name; sidebar links; header search from another
  page; Alerts badge source; Analytics subtitle counts equal `/batch_predict`; Reports cards, counts,
  zone rows and CSV row count equal `/alerts`; Forecast banner and no "Score"; screenshots.
- Updated for the new wording: `team_pages`, `weather_sources`, `prehosting`, `mixed_zones`,
  `honesty_batch1` (Reports), `nowcast` (CAP and CTT rows), `latency`, `credits` (search box found by
  its label).
- `nowcast_data/serve/tests/test_results.py` (CAP and CTT rows) and `test_latency.py` (no repeated
  "compute time").

**Screenshots** (`e2e/screenshots/honesty_*`, 1920×1080 and 1366×768): dashboard, alerts, analytics,
reports, forecast, approach table and compute line, header with a long place name.

### Nearby shelter options (1 Oct 2026)

**What it is:** a drawer section on /nowcast, in both Event replay and Live: icon "Shelter options", panel
title "Nearby shelter options". It is collapsed by default and closes with Esc / ×.
- **Choosing the point:** while the section is open, a map click chooses the point. A click on an alert
  also chooses the point; it does not switch sections. Opening the section with an alert selected starts
  from that alert's peak cell, and a button re-uses it.
- **Map layers, only while the section is open:** the chosen point (ringed dot), a dashed 25 km circle and
  numbered candidate dots (filled: outside all alerts; hollow: inside an alert). The map zooms to the
  circle so the numbers are readable.
- **Each candidate:** name and type (OSM id), straight-line distance and 8-point direction (no route), and
  whether it lies outside all current alerts at every lead. Otherwise it shows "Inside a current alert at
  +1, +2 … h", plus the alerts at the lead shown on the map.
  - The alert check uses every alert of the issue or run (all leads, Watch and Warning, all hazards), not
    only the filtered ones; the panel says so.
  - It also shows slope, distance to the nearest mapped stream, and elevation relative to the chosen
    point. Values only: no thresholds, no pass/fail.
- **Fixed wording, shown first:** "Candidate public buildings outside the current alert area, not verified
  shelters. Roads may be blocked. Follow evacuation instructions from district authorities and IMD.
  Emergency: 112."
  - Outside Uttarakhand and Himachal Pradesh: "Not available for this area yet."
  - Live: "Live output: not validated." REF025: its in-sample badge.
  - Nothing is called "safe".

**Data** (details in `nowcast_data/serve/README.md` "Nearby shelter options"):
- One Overpass query on 2026-10-01 returned 33.1 MB (raw, gitignored).
- 2,461 buildings and 12,676 river/stream lines; OSM has no emergency assembly points mapped in the two
  states.
- Derived assets 19.6 MB under `serve/assets/osm/`; the host ships 6.2 MB (the 13.4 MB waterways file is a
  build input only).
- Terrain values come from the Copernicus DEM on disk, precomputed. The chosen point's elevation comes from
  a 5.5 MB numpy grid, so the host needs no rasterio.
- Credit: new `osm_shelters` entry in the ML credits footer (ODbL), and `serve/assets/osm/ATTRIBUTION.md`.
- First Overpass attempts answered HTTP 504 ("server is probably too busy") when the query asked for a
  600 s / 1 GB or 512 MB reservation. The same query with the default memory and `timeout:300` succeeded
  in 49 s.

**Not covered:** the National sample view (no section there). Buildings only as mapped in OpenStreetMap,
which may be incomplete; unnamed ones show as "Unnamed <type>".

**Tests:**
- `nowcast_data/serve/tests/test_shelters.py` (8 tests).
- `e2e/shelters.spec.js` (6 tests): REF045 alert peak and map click; REF051; REF025 badge; Live "not
  validated" and the outside-region message. The candidates, flags and markers equal the API's.
- Host parity: `tests/host_parity_probe.py` also requests `/shelters` (3 points per issue and per live run,
  and `shelters`).

**Screenshots:** `e2e/screenshots/shelters_{REF045,REF051}_{1920x1080,1366x768}.png`.

**Host-parity views spec fix (same day):**
- Cause of the failure: request timing in the test, not a host difference. On the full-app pass the
  Live view made no map-PNG requests at all, while the host pass made lead-6 ones. The spec waited only
  for the "not validated" badge, which renders before the live run's meta and alerts arrive. The lead
  buttons and field select appear only after them, so on the slower full side (proxied :8000 → :8001)
  the click-through found nothing to click.
- Fix in `e2e/host_parity_views.spec.js`:
  - wait for the Live lead buttons before cycling them;
  - any request seen on one side only is requested directly on the other side and must give the same
    status (`e2e/screenshots/host_parity_views_one_sided.json` lists them). Statuses of requests made on
    both sides are compared as before.
  - The click-through also opens "Nearby shelter options" for each episode.

### Shelter fixes (1 Oct 2026)

**Why:** the first screenshots listed 5 candidates that were all inside a current alert, several low in
the valley near streams. The default point was also the issue's first alert, not one near the event.

1. **Order:**
   - Candidates outside all current alerts at every lead are listed first, nearest first ("Outside all
     current alerts (n)").
   - Candidates inside an alert form a separate group, collapsed by default: "Inside a current alert
     (N)", with the nearest 5 listed when opened. Their hollow "i" markers show only while it is open.
   - When none in the radius is outside, the panel says so plainly, e.g. REF045 at its default point:
     "None of the 25 mapped public buildings within 25 km lies outside the current alerts." One button,
     "Widen the search to 50 km", re-asks with `radius=50` (the API accepts 25 or 50 only).
   - At 50 km REF045 has 2 outside: Government Inter College Maujkhal at 36.6 km and Government
     Hospital Chipalghat at 48.9 km. The map re-zooms to the new circle.
2. **Default point in Event replay:** the peak cell of the issue's alert nearest the episode's documented
   event site, over every alert of the issue (any lead, level, hazard).
   - New endpoint `/api/issues/{ep}/{ts}/shelters/default-point`. The panel states the alert and its
     distance, e.g. "Peak of the alert nearest the documented event site (Pipalkoti area): Cloudburst
     Watch, +2 h, 17.2 km from the site."
   - REF051: Malana river, Thunderstorm Warning +4 h, 30.8 km.
   - The point follows the issue while the section is open. A map click or "Use the selected alert's
     peak cell" still overrides it. Live has no event site, so there is no default there.
3. **Elevation in words:** "748 m lower than the chosen point" / "26 m higher than the chosen point" /
   "same elevation as the chosen point" (API `elevation_rel_text`), instead of a bare −748 m.
4. **Hazard advice:** one sentence quoted verbatim from NDMA's "Floods: Do's & Don'ts", under "If a flood
   is likely to hit your area, you should:": "Be aware of streams, drainage channels, canyons, and other
   areas known to flood suddenly."
   - Stored with URL (https://ndma.gov.in/index.php/floods-dos-donts), check date 2026-10-01 and page
     sha256 in `nowcast_data/serve/assets/advice/SOURCES.json`; shown with a link.
   - Not used: the sentence before it ("…move immediately to higher ground. Do not wait for instructions
     to move."), which conflicts with the fixed wording to follow evacuation instructions.
   - Quoting public guidance is not an integration with NDMA.

**Tests:**
- `nowcast_data/serve/tests/test_shelters.py` (13): groups and their order and counts; the "none outside"
  text and the 50 km widening; the default point is the nearest alert peak to the site (brute force) and
  its text; elevation wording; the stored NDMA quote; radius other than 25/50 → 422.
- `e2e/shelters.spec.js` (7): REF045 default + "none outside" + widen; REF051 default + outside first;
  NDMA line and link; alert/click override; REF025 badge; Live outside-region.
- The host-parity probe also requests `default-point` and `radius=50`.

**Screenshots:** `e2e/screenshots/shelters_REF045_{1920x1080,1366x768}.png`,
`shelters_REF045_50km_*.png` and `shelters_REF051_*.png`.

### INSAT I3a: live layer + three IMERG-blind cloudbursts (2 Oct 2026; built, not yet run)

Satellite observation (INSAT via MOSDAC). It is not a model input.

**Scripts the user runs** (in `nowcast_data/scratch/mdapi_env/`, which is gitignored, next to the existing
`download_insat.py`):
- **Credentials:** env `MOSDAC_USERNAME` / `MOSDAC_PASSWORD` only.
- **Login rules (`strict_session.py`):**
  - one login per run;
  - one re-login only if the session expires;
  - any failed login stops the script and is never retried. That includes a network error during the
    login request.
  - Checked offline with the network mocked: network error and wrong credentials stop after one request;
    expired, re-login OK; a second expiry stops without a third login; credentials never appear in the
    log.
- **`insat_poller.py`:** every 10 min:
  - finds the newest 3RIMG and 3SIMG L1C_ASIA_MER V01R00 file (search needs no login);
  - downloads only new ones to `raw/insat/live/`, keeping the newest 4 raw files;
  - renders each with `serve/insat_live.render_frame` into `nowcast_data/live_insat/` (gitignored);
  - appends to `scratch/insat_live_latency.csv` and rewrites `docs/insat_latency.json`;
  - logs to `scratch/insat_poller.log`; network errors and timeouts are retried.
  - At most 2 downloads per cycle, about 96 a day (own cap 300; MOSDAC allows 5,000). Dry run (no login):
    newest 3RIMG 01 Oct 16:45Z, 3SIMG 17:00Z.
- **`insat_events_download.py`:** INSAT-3DR only, every 30 min, from −9 h to +3 h around each event.
  - The catalog has a **date only** for all three events, so the window is anchored on the IMERG
    half-hourly peak within 25 km: REF048 12 May 19:00Z, REF049 19 Jul 17:00Z, REF050 24 Jul 21:00Z.
  - Dry run: **67 files, about 1,656 MB.** REF048 has 19 of 24 slots: MOSDAC lists no 3DR file for
    18:45–20:45Z on 12 May, exactly around its anchor. REF049 and REF050 have 24 each.

**Live layer** (`serve/insat_live.py`):
- Each frame is a PNG over the live run's grid extent, plus a BT grid (`.npz`, numpy only on the host)
  and a JSON record: satellite, scan start/end, time available, latency, file name, LUT floor.
- API:
  - `/api/live-insat`: labels, colour scale, latest frame and the last 8;
  - `/api/live-insat/frames/{id}.png`;
  - `/api/live/{run}/insat`: per alert, the coldest cloud top within 25 km, but only if a frame's scan
    started within ±60 min of the alert's valid time. Otherwise "No INSAT frame near this alert's valid
    time".
- Cooling is the change of that coldest value since the same satellite's frame 30 min earlier. It is
  shown only where neither value is at the LUT floor; otherwise "cooling rate not computable"; never across
  satellites.
- **INSAT-3DS:** its LUT floor is 180.0 K (3DR 179.86 K). Floor pixels are coloured as the "≤180 K" class
  for both. 3DS acquisition times carry milliseconds, which the 28 Sep live stage could not parse; fixed
  here. Its image offset has not been measured (`docs/insat_georef.md`, note added).
- **Live tab:** toggle "INSAT cloud tops (satellite observation, INSAT via MOSDAC)" in the Layers panel,
  off by default.
  - Shows a caption (satellite, acquisition time, measured latency), chips for the last few frames and
    an opacity slider.
  - The legend shows the case-layer labels: position line, the "≤180 K = at or below the coldest value in
    the product's lookup table" line, and "No verified severe-storm threshold shown".
  - The alert drawer has an "INSAT cloud tops" line. The 26 Sep run says "No INSAT frame near this
    alert's valid time".
- **Host:** `hosting/build_space.py` ships only the latest frame (PNG, `.npz`, JSON) and `SNAPSHOT.json`.
  The layer is then labelled "snapshot, acquired HH:MMZ". No raw files, no credentials, no poller.

**Approach page:** "INSAT latency (measured)", read from `docs/insat_latency.json`.
- Measured now: 32 files, median 14 min (range 9–19); INSAT-3DR 16, median 9 min; INSAT-3DS 16, median
  14 min.
- Definition: first listed in the search, minus acquisition end; polled every 10 min.
- The 16 3DS values use the acquisition end read from the raw files still on disk (the CSV lacked it).
- The existing "search only" figures (3DR 46 min, 3DS 61 min, quoted from `docs/insat_availability.md`)
  use a different definition and are unchanged.

**Results page:** card "INSAT at three cloudbursts IMERG barely saw", from `docs/insat_events.json`
(`python -m serve.build_insat_events` after the download).
- "Three case studies, not a general result."
- Per event: a 25 km INSAT series (coldest, 10th percentile, 30-min change of the 10th percentile), the
  IMERG series and the model's cloudburst alerts nearby.
- Until the files exist it says "Not available yet: …".
- Event check timeline rows: none. No replay data exists for these dates.

**Tests and fixtures:**
- Fixtures: `serve/tests/fixtures/insat_live/` holds 4 frames rendered from real 28 Sep 2026 files
  (3DR 21:15/21:45Z, 3DS 21:00/21:30Z). `insat_events_REF051.json` is the event analysis run on REF051's
  case files.
- `serve/tests/test_insat_live.py` (13):
  - labels and frames;
  - the ±1 h rule;
  - the 25 km minimum against an independent computation;
  - cooling never across satellites or at the floor;
  - the BT grid equals the raw file's LUT;
  - latency summary and Approach numbers;
  - the events section;
  - the event patch equals the case layer's Malana series;
  - no h5py/pyproj at import.
- `e2e/insat_live.spec.js` (5). The host-parity probe and views spec also cover `/live-insat` and the
  latest frame.
- e2e runs with serve started with `NOWCAST_INSAT_LIVE_DIR=serve/tests/fixtures/insat_live` and
  `NOWCAST_INSAT_EVENTS_FILE=serve/tests/fixtures/insat_events_REF051.json`.

**Screenshots:** `e2e/screenshots/insat_live_*`, `insat_live_alert_*`, `insat_events_results_*`,
`insat_latency_approach_*` (1920×1080, 1366×768).

### 3D terrain view + elevation profile; INSAT latency label checked (2 Oct 2026)

**0. Approach "INSAT latency" line: where the numbers come from (checked).**
- **Source:** `docs/insat_latency.json`, computed from `nowcast_data/scratch/insat_live_latency.csv`.
- **What the 32 measurements are:** real MOSDAC L1C_ASIA_MER V01R00 files, not fixtures.
  - They were recorded by the earlier live stage of `scratch/mdapi_env/download_insat.py`. Its run started
    2026-09-28T21:31Z and recorded files until 2026-09-29T05:31Z.
  - 16 INSAT-3DR files, 28 Sep 21:15Z – 29 Sep 04:45Z slots, first listed 21:51Z – 05:31Z.
  - 16 INSAT-3DS files, 28 Sep 21:00Z – 29 Sep 04:30Z slots, first listed 21:41Z – 05:11Z.
  - The first file of that run (3RIMG 20:45Z) was already listed at the start, so it is excluded.
- **Per file:** the time our 10-minute search poll first listed the file (`first_seen_utc`), minus the scan's
  end (the file's `Acquisition_End_Time` attribute).
  - 3DR: from the CSV.
  - 3DS: read from each raw file on 1 Oct, because the old stage could not parse the millisecond format.
- **It is not the product creation time** (`Product_Creation_Time` is not used).
- Because polls are 10 min apart, each value is an upper bound up to 10 min late:
  - 3DR values alternate 9 / 19 min, so the file appeared 0–19 min after the scan ended;
  - 3DS is always 14 min, so 4–14 min.
- **The 46 / 61 min "search only" figures are different:** one snapshot (21 Sep 2026 05:01Z) of the newest
  file's age measured from the scan's *start* (`docs/insat_availability.md`), so they include the ~27 min
  scan itself.
- **Label now:** "INSAT listing delay (measured): Scan end to first listed in MOSDAC's search (real L1C
  files…)", followed by the full definition and the comparison sentence.
- **The poller has run:** one cycle at 2026-10-01T20:11Z (3RIMG 16:45Z and 3SIMG 19:30Z slots).
  - Both files were listed at its start, so they are excluded. Its later files add real measurements: at
    its 20:41Z rewrite there were 33 (one more 3DS file, 17 in all); median 14 min, range 9–19 min.
  - The newest 3DR file listed then was about 3.5 h old.
  - The poller rewrites `docs/insat_latency.json` with the code it started with. The new label shows the
    measurement period only when the file contains it, and the definition always.

**1. Data.**
- **Elevation:** the existing `serve/assets/osm/elevation_uk_hp.npz` is reused, not rebuilt.
  - The Copernicus GLO-90 mean of 3×3 native cells: 9″, about 278 m N–S × 240 m E–W at 30°N.
  - 1840 × 2240 cells over Uttarakhand + Himachal, int16, **5.5 MB**, numpy only.
- **Rivers/streams:** new `serve/assets/osm/waterways.npz` (**2.8 MB**), from the saved Overpass response
  (`python -m serve.build_shelters --waterways-only`).
  - The same 12,676 OSM river/stream lines, now with type (river/stream) and name (3,736 named).
  - The 13.4 MB GeoJSON stays a build file. The host now ships 2.8 MB more.

**2. Elevation profile** (every listed candidate card):
- **API:** each candidate in `/shelters` carries a `profile`:
  - samples along the straight latitude/longitude line from the chosen point to the building, at most
    250 m apart (e.g. 244–250 m), each the 9″ DEM cell under the sample;
  - crossings with OSM river/stream lines (type and name);
  - stretches inside a current alert, per lead.
- **Card:** a small SVG.
  - Start and end heights; blue dashed lines and dots at crossings.
  - Light red where inside an alert at any lead, darker red at the lead shown on the map.
  - Fixed note: "Straight line, not a route. Roads may differ."

**3. 3D view.**
- **Opening:** "3D view" button in the shelter section, hidden outside the two states. It opens a modal
  overlay that Esc, × or a click outside closes. No new always-visible panel.
- **Scene:** three.js **0.186.1** (npm, MIT, no dependencies), lazy-loaded.
  - Terrain from `/api/shelters/terrain`: ±25 km, or ±50 km after "Widen the search" (stride 2, so at
    most 220 cells a side).
  - Shaded by elevation (legend with the block's min–max), **"Height ×2"** printed.
  - The map's alerts at the current lead are draped in their hazard colours; Warning solid, Watch dashed.
  - The chosen point, numbered candidate pins as in the list (filled = outside all alerts, "i" =
    inside), and rivers/streams in blue.
  - Drag to rotate, scroll to zoom, "Reset view". The section's fixed wording is shown underneath.
- **No WebGL:** "The 3D view needs WebGL, which this browser does not provide. …".

**4. Performance.**
- **Production build:**
  - main bundle 1,147.87 → 1,152.66 kB (+4.8 kB; gzip 326.97 → 328.69 kB);
  - the 3D chunk is 573.29 kB (gzip 143.13 kB), loaded only when "3D view" is clicked. The e2e checks no
    three.js request before that, so `/nowcast` loads no slower.
- **This laptop's GPU** (Intel Iris Xe, ANGLE D3D11; dev server):
  - REF045 (50 km): click to drawn 1.6–1.9 s;
  - REF051: 0.9 s;
  - rotation **60 fps** (display refresh) at 1920×1080 and 1366×768 (`e2e/perf_gpu_probe.mjs`,
    `e2e/screenshots/terrain3d_perf_gpu.json`).
- **Headless test browser** (software WebGL, SwiftShader): opens in 0.7–1.1 s, rotation about 4 fps. That
  limit belongs to the test renderer, not the laptop.

**5. Tests.**
- `nowcast_data/serve/tests/test_profile3d.py` (6):
  - profile heights equal the DEM grid at the sample points, start = the point's height and end = the
    building's;
  - a crossing of a real Alaknanda segment is found at the midpoint of a short line across it;
  - alert stretches on synthetic boxes;
  - the terrain block equals the grid slice;
  - outside → not available; works with rasterio unimportable.
- `e2e/terrain3d.spec.js` (4): profiles equal the API; three.js is not loaded before the click; 3D on REF045
  (50 km) and REF051 (WebGL available in the test browser, so the fallback branch is code only); Esc/×;
  hidden outside the states.
- The host-parity probe also requests `/shelters/terrain`, and the views spec opens and closes the 3D view.

**Screenshots** (`e2e/screenshots/`):
- `profile_REF045_50km_*`, `profile_REF051_*`;
- `terrain3d_REF045_50km_*`, `terrain3d_REF051_*` (1920×1080 and 1366×768).

### Poller session fix, CAP Atom feed, Analytics redesign (2 Oct 2026)

**0. INSAT poller: session handling** (`nowcast_data/scratch/mdapi_env/`, gitignored, not committed).
- **Why the 1 Oct run stopped:** both token refreshes failed exactly 30 min 01 s after a login.
  - The poller only uses the token when it downloads (about every 30 min), so the access token had
    always just expired. The refresh token apparently expires with it.
  - Our refresh request is the same as MOSDAC's own client (`mdapi_env.refresh_access_token`), so the
    request itself is not the cause.
  - This is a diagnosis from the code and the log; MOSDAC was not contacted. The next run's log will
    confirm or refute it.
- **Fix (`strict_session.py`, shared by the poller and the event downloader):**
  - The token is refreshed **proactively** while the session is still valid: once the access token is
    20 min old, or within 5 min of its JWT expiry.
  - Each refresh logs its HTTP status and server message (credentials and tokens masked; only the
    expiry time is logged).
- **Login rules:**
  - A re-login after the session expired is allowed at most once per 20 min, and each one is logged.
    If one is needed sooner, downloads wait for the next cycle (no login). The event downloader sleeps
    instead.
  - **Any failed login stops the poller at once with "STOP:"** and is never retried: wrong credentials,
    any non-200 answer, an unexpected or non-JSON answer, a network error or a timeout.
  - Hard cap of 60 logins per run, then STOP.
- **Tests:** `scratch/mdapi_env/test_strict_session.py`, 12 tests with a mocked client and clock:
  - expiry → re-login OK;
  - failed login (401, 500, non-JSON, no token, network error) → STOP, one request, no retry;
  - the 20-min spacing;
  - the 60 cap;
  - proactive refresh;
  - nothing secret in the log.
- **Live layer: per-satellite ages.**
  - `insat_live.prune` now keeps the newest 4 frames **per satellite**, so a stalled satellite keeps its
    last frames.
  - `/ml/live-insat` → `by_satellite`, shown in the layers panel, e.g. "INSAT-3DR: newest 28 Sep 21:45Z,
    3 d 1 h 35 min old". The age is computed from the frame files and the clock, with no fresh/stale
    threshold; gaps show as "no frame yet".
  - Cooling is still same-satellite only.
- **Read of the real `live_insat/` (read-only, once):** a quick API check read it without the fixture
  env. Newest frames: 3DR 16:45Z and 3DS 20:00Z, 1 Oct. Every later check and test used the fixture
  folder.

**A. CAP Atom feed** (`serve/cap_feed.py`).
- **Storing decisions:** the CAP review drawer now posts each decision (approve / reject / edit →
  pending) to `/ml/cap/review`.
  - Decisions are stored in `cap_approvals.json` in the ML app's output directory (`NOWCAST_OUTPUT_DIR`,
    default `nowcast_data/output/`, gitignored).
  - On the host (`NOWCAST_EPHEMERAL_STORAGE=1` in `hosting/Dockerfile`) the drawer says "Hosted demo:
    approvals are kept only while the server runs; approvals reset when the server restarts."
- **The feed:** `/ml/cap/feed.atom` (Atom 1.0, standard library only) lists approved messages, newest
  approval first.
  - Title: "Exercise feed — not an official warning; not connected to IMD, NDMA or Sachet".
  - Each entry links to `messages/{id}.cap.xml`, built by `serve/cap.py` exactly as the existing export.
- **Status, as in the export:**
  - replay messages keep `<status>Exercise</status>`;
  - **live-run messages keep `<status>Test</status>`**. The existing export uses Test for the
    not-validated live run, and it was kept, not changed to Exercise. The feed subtitle and the Approach
    note say so.
  - Never `Actual`.
- **Drawer:** a "Feed (Atom)" link, "N approved message(s) in the feed", the storage line and the
  Exercise-feed line.
- **Approach CAP row:**
  - text: "CAP 1.2 file export and Atom feed built (Exercise status, not connected to any official
    system).";
  - status "Export + Atom feed built";
  - note with the approved count, read from the real state (tested against `/ml/cap/approvals`).
- **Tests:**
  - `serve/tests/test_cap_feed.py` (6):
    - the Atom parses with the standard library;
    - every linked message passes the CAP 1.2 XSD;
    - rejected or pending alerts never appear;
    - Exercise on replays, Test on live;
    - unknown alert → 404.
  - `e2e/cap_feed.spec.js` (2): approve → the feed lists it → its link opens a valid CAP 1.2 message with
    Exercise status; drawer screenshots.
  - The older CAP review e2e now resets stored decisions to pending first (they are server state now).

**B. Analytics → "Nowcast analytics (ML model)"** (`pages/Analytics.jsx`, `serve/analytics.py`,
`/ml/analytics`).
- **Removed:** the rule-based charts, filters and Key Insights. A footer line points to them: "Current-weather
  rule-based indicators: see Dashboard".
- **Layout:** one column, four sections, each with one question, one visual and one generated sentence.
- **Sticky top bar:**
  - source: Live run "(not validated)" with its issue time; National sample; each event replay, REF025
    with its in-sample badge;
  - lead slider 1/2/3/4/6 with play;
  - hazard chips and Watch/Warning chips.
- **Sections:**
  1. **What is the model warning about?** Three hazard tiles (alerts, Warning/Watch counts, km², hazard
     colours as on the map) and a map thumbnail. A tile or the thumbnail opens ML Nowcast at that source,
     lead and hazard (new `/nowcast` URL params `view`, `ep`, `ts`, `lead`, `hazard`, `watch`). Sentence,
     e.g. "At +4 h the model has 1 thunderstorm Watch covering 4,600 km²." The national sample has no
     alerts and says so.
  2. **How does it change with lead time?** Alert area by lead, stacked by hazard; the selected lead is
     outlined; numbers on hover or focus.
  3. **Why does the model think so?** Per-lead stacked bars of ingredient-group shares (≥30 mm/hr model,
     validation 2022–23, descriptive, from `AGGREGATE_VAL.json`; one model, one row set), with plain names
     and icons. Sentence from those numbers: "…together go from 18% of the attribution at +1 h to 39% at
     +6 h."
  4. **How good is it?** CSI ≥10 mm/hr by lead, model vs moving the current rain forward (advection) vs
     keeping it where it is (persistence), validation. A "Known weaknesses" expander quotes the docs plus
     one count from `scores_test.csv` (FAR above advection in 7 of 15 cells, labelled as counted). Link
     to Results.
- **Footer:** an INSAT card with the newest frame per satellite and its age, and the measured listing
  delay from `docs/insat_latency.json`.
- **Design rules:**
  - "More" expanders are collapsed by default; text is ≥14 px;
  - term tooltips are buttons, so the keyboard reaches them;
  - % appears only for thunderstorm;
  - SVG charts with no new dependency (no npm packages added);
  - no horizontal scroll at 390 px.
- **Wording:**
  - Forecast: "Live Nowcast Panel" → "Current conditions"; "Current weather only (no projection ahead)";
    "Loading current conditions…".
  - Dashboard sidebar Alerts pill: "LIVE" → "Current weather".
- **Tests:**
  - `serve/tests/test_analytics.py` (4).
  - `e2e/analytics_ml.spec.js` (6):
    - numbers equal the API for REF045, Live and National;
    - the slider, play and every chip update all four sections;
    - tiles and the thumbnail open the right view;
    - sentences equal the data;
    - no % on cloudburst or flash flood;
    - keyboard tooltip; no horizontal scroll at 390 px.
  - **Retired** (they tested the removed rule-based Analytics content):
    - `honesty_batch1` 2;
    - `mixed_zones` 2, plus its Analytics screenshot;
    - `openweather` 2 Key Insights tests, plus its Analytics lines;
    - `sample_safety` 1, plus its Analytics screenshot;
    - `honesty_fixes` 1;
    - `weather_sources` the Analytics block;
    - `team_pages` the Analytics banner.

**Results:**
- serve pytest all pass (`NOWCAST_TEST_REPLAY=1`); team backend tests all pass, including host parity
  with the new `/ml/analytics`, `/ml/cap/approvals` and `/ml/cap/feed.atom` paths.
- e2e: 162 tests in 22 files. Run in groups, all pass; host parity views against `:10000`.
- `models/v0/*` sha256 unchanged.

**Screenshots** (`e2e/screenshots/`):
- `analytics_live_*`, `analytics_REF051_*`, `analytics_*_s3s4_*`, `analytics_*_390x844`;
- `cap_drawer_*`, `cap_feed_drawer_1600x1000`;
- `insat_live_*`;
- `approach_*`;
- `prehost_forecast_*`, `threat_alerts_*`, `dashboard_*`.
- At 1366×768 the layers panel's INSAT lines continue below the fold inside the panel, which scrolls.
  Both per-satellite age lines stay visible.

### Fresh live run + INSAT I3b (2 Oct 2026)

- **Live run `20261002T0230Z`** (`nowcast.live.poll` then `nowcast.live.ingest`, as on 26 Sep; no pipeline or
  model change).
  - Poll at 07:52Z: IMERG Early 02:30Z slot, 322.7 min old; GFS 00Z, 472.7 min old.
  - Ingest: 17.6 s, peak working set 641 MB.
  - **0 alerts** at every lead; the highest thunderstorm probability is 5 % (+4 h).
- **Live tab default** is the newest run (the API lists runs newest first).
  - The UI has no run selector, so none was added. The 26 Sep run (8 alerts) opens with
    `/nowcast?view=live&run=20260926T0330Z`, a URL parameter like `ep`/`ts`. The e2e tests of the live
    alert panel use it.
  - Analytics' Live links carry `run=`.
- **0-alert state** (no "safe" wording; the numbers are read from the run's rasters):
  - Live bar: "No Watch or Warning in this run (highest thunderstorm probability 5 %, at +4 h)."
  - Alert drawer: the value at the selected lead; "CAP review: no alerts in this run, so there is no CAP
    message to review."; the INSAT summary.
  - Analytics (Live): the same line in section 1 (plus the selected lead's value when it isn't the peak
    lead); section 2 says there is no alert area to compare, with no empty chart.
  - Shelter options: a map click near Pipalkoti lists 16 buildings, all outside, 0 inside.
- **INSAT I3b:**
  - 0 of 0 alerts have a cloud-top value, because the run has no alerts.
  - Real frames exist within ±1 h of the +3, +4 and +6 h valid times, as read at 08:25Z. The poller
    keeps 4 frames per satellite, so this changes as frames rotate.
  - The per-alert path is tested on fixtures, including the exact ±60 min edges.
- **Host snapshot:**
  - each satellite's newest frame, PNG + JSON only (3DR 07:45Z, 3DS 07:30Z, 0.07 MB);
  - per-alert values are not computed on the host and say so;
  - both live runs ship; package 143.6 MB (was 140.4 MB);
  - no raw files and no credentials (checked).
- **Tests:**
  - serve: 170 (NOWCAST_TEST_REPLAY=1);
  - backend: 60, including host parity with both apps reading the shipped snapshot;
  - e2e: 167 in 23 files, run in groups, including host parity views on `:10000`;
  - new `e2e/live_run_oct.spec.js` (5).
- **Screenshots:** `live_oct_insat_*` (real frames), `live_oct_drawer_*`, `live_oct_shelter_*`,
  `live_oct_analytics_*` and `live_oct_analytics_s2_*`, at 1920×1080 and 1366×768.

### Judge-first pass: /nowcast explains itself (2 Oct 2026)

- **Opening view:** plain `/nowcast` opens REF051 (2024 test badge) at the 15:00Z issue, lead 4 h,
  with the cloudburst Warning that IMERG confirmed selected (Alert section open).
  - `/api/episodes` keeps `default` (REF045 15:00Z, still used by Analytics links) and adds `start`, which
    `serve/start_here.py` derives from the event check: the cloudburst Warning issued 15:00Z, IMERG status
    verified, 3 h before the reported Malana window.
  - A `?ep=&ts=` URL still opens that issue with nothing selected; the e2e helper `openIssue` now uses it.
  - "Pipalkoti case (2023 validation) →" in the badge row (and "Malana case (2024 test) →" back).
- **Wording** (map popups, Alert drawer, legend, Event check; `serve/labels.py` and `VERIFY_STYLE` agree):
  - verified → "Confirmed by IMERG satellite rain (≥30 mm/hr within r)" (the drawer adds r = N km);
  - false alarm → "Not confirmed by IMERG satellite rain – counted as a false alarm in our scores.";
  - Event-check chips "IMERG: confirmed by IMERG" / "IMERG: not confirmed by IMERG";
  - each replay alert carries `site_note` when a documented site lies inside it (distance to its peak) or
    within 25 km of its edge: "A documented cloudburst (<site>) occurred … ; IMERG under-reports
    cloudbursts (median peak 17.6 mm/hr at 24 documented events – see Results)." The 17.6 and 24 are parsed
    from the `docs/cloudburst_reference.md` row quoted in `serve/results.py`.
  - Results score tables keep CSI / FAR.
- **Start here** (`/api/start-here`): shown on the first visit, × / Esc closes it (Esc does not also close
  the drawer), the header's "Start here" button reopens it.
  - The dismissal is kept in `localStorage` (`nowcast.startHere.dismissed`), read and written in try/catch.
  - It shows 5 findings, each with its number read from a file and a button to the view that proves it:
    - Malana Warning 3 h before the reported window (case study, from the event check);
    - Pipalkoti Watch 2.8 km from the site, 4.5 h before the reported time, IMERG peak 17.5 mm/hr near
      the site (case study);
    - higher CSI than advection in 15/15 cells on validation and 15/15 on the 2024 test (recomputed from
      the score CSVs);
    - 14 s per all-India nowcast (`docs/latency_benchmark.json`);
    - INSAT files listed a median N min after the scan ends (`docs/insat_latency.json`, which the poller
      keeps rewriting, so N and the file count follow it).
  - Results and Approach scroll to `#csi-section`, `#approach-compute-latency` or `#approach-insat-latency`
    and outline it.
  - It sits over the map, right of the Layers panel, inside whichever view is shown.
  - Playwright specs written before it start with it dismissed (`playwright.config.js` `storageState`);
    `e2e/judge_first.spec.js` clears that to test the first visit.
- **Live:**
  - A "Data freshness" strip: run issued (and how long ago), IMERG Early and GFS age at issue (run
    manifest), each satellite's newest INSAT frame and its age, and compute time
    (`/api/compute-latency`). No thresholds.
  - The thunderstorm-probability layer is on by default.
  - "See the 26 Sep run (8 alerts)" loads that run in place (`/api/live` now gives `n_alerts` per run),
    then "Back to the newest run: 2 Oct run (0 alerts)".
- **Tab renamed** "All-India example". Its subtitle reads the issue time and the input note ("inputs from
  REF054 …") from `/api/india/meta`. Analytics' source label follows.
- **Typography** (Alert, Ingredients, Event check, Shelter options, CAP review, Caveats; Results, Approach):
  - 16 px body, nothing below 14 px except the data-credits footer and SVG chart ticks, line-height 1.5;
  - drawer headings 18 px; sections up to 500 px get 25 % wider at ≥ 1600 px (alert 525 px);
  - timeline labels wrap; INSAT timeline cells narrower than 34 px show colour only (value in the tooltip);
  - the map re-fits the issue bounds when its container resizes, until the user pans or zooms, so the opening
    view (drawer open on load) shows the whole domain.
- **Tests:**
  - serve 176 (NOWCAST_TEST_REPLAY=1), including 6 new in `serve/tests/test_start_here.py`;
  - backend 60, with host parity on the rebuilt package;
  - e2e 176 in 24 files, run in groups, including host parity views on `:10000`;
  - new `e2e/judge_first.spec.js` (9).
- **Screenshots** (1920×1080 and 1366×768): `judge_default_starthere_open_*`, `judge_default_starthere_closed_*`,
  `judge_alert_pipalkoti_watch_*`, `judge_live_freshness_*`, `judge_drawer_{alert,ingredients,event,shelter,caveats}_*`,
  `judge_results_*`, `judge_approach_*`, and `judge_popup_1920x1080`.

### Overview page, navigation, type scale, weather source (2 Oct 2026)

- **Navigation** (`components/TopHeader.jsx`): Overview (`/`) · Explore map (`/nowcast`) · Results · Analytics ·
  a "Current weather (rule-based)" menu with Dashboard (moved unchanged to `/dashboard`), Forecast, Alerts and
  Reports (the menu says "Rule-based indicators from current weather, not the ML model."; each page keeps its
  own label). Below 1280 px one "Menu" button holds every page. Links that went to the old "/" Dashboard
  (Sidebar, Alerts, Forecast, Reports, Analytics, the header search) now go to `/dashboard`.
  - `vercel.json` already rewrites every path to `index.html`, so deep links survive a refresh.
  - The city pill, search box and alert bell show only on the rule-based pages, from 1600 px.
  - Every route except `/` is lazy-loaded (`App.jsx`), so the Overview paints first.
- **Overview "System briefing"** (`pages/Overview.jsx`, `components/overview/`, `utils/briefing.js`;
  `/api/overview` in `serve/overview.py`):
  - a full-height map pinned on the right (phones: the top half) and eight steps; each step changes the map
    (fly to the step's view; jump with prefers-reduced-motion);
  - steps:
    1. the documented val/test sites on the terrain;
    2. the sites sized by IMERG peak (median 17.6 mm/hr, 6 of 24 ≥ 30);
    3. Malana, 31 Jul 2024, with a scrubber: 14:00Z thunderstorm Warning, 15:00Z cloudburst Warning, 18:00Z
       reported window, 18:30Z IMERG first ≥ 30 mm/hr (with the IMERG ≥30 layer);
    4. the Malana Warning's top-5 reasons;
    5. INSAT-3DR ≤180 K within 25 km of Malana at 17:45Z, and the three IMERG-blind 2024 cloudbursts (IMERG
       peak vs coldest top);
    6. CSI at ≥10 mm/hr by lead (validation), "higher CSI in 15/15 cells" and a Known limits link;
    7. measured delays (IMERG Early 318 min, INSAT listing median, compute 14 s), the live INSAT snapshot and
       the lead-time arithmetic ("arithmetic, not a demonstrated result");
    8. six cards that open exact views (`/nowcast?ep=&ts=&alert=&lead=&level=&hazard=[&tab=shelter]`, Live,
       Analytics, Results).
  - step dots and the arrow keys move between steps; with reduced motion there is no autoplay (step 3 shows
    its final state) and no transitions; images load only when their step is reached (thumbnails
    `loading="lazy"`); on phones the step's chart sits under its text, not over the half-height map;
  - top: "System briefing", a one-line headline and "Skip the briefing → Explore map"; footer: "Not an
    official warning. Follow IMD and state advisories." and the Data credits line;
  - no new npm package.
- **/nowcast:**
  - Start here has a "See the overview" link.
  - Below 1600 px the opening Alert section waits (drawer collapsed) while Start here is open, and opens
    when it closes; ≥ 1600 px is unchanged.
  - `?alert=<id>&lead=&level=&hazard=&tab=<section>` opens that alert with that drawer section.
  - One compact status line per view (`StatusLine` in `MapFrame.jsx`), with a "Details" (i) button:
    - replay: split / case-study badge, forecast-only chip, case link; the details hold the case-study label
      and the replay sources;
    - All-India: "All of India at one past time: <time> UTC (2024 test period). Probability map only, not
      live." The period is read from the input note; no REF IDs anywhere a visitor reads them (also the
      episode picker, Analytics source labels and the INSAT event cards);
    - Live: "System running operationally — NOT validated", the issue time, the no-alert line and the run
      link stay visible; the Data freshness strip is in the details.
  - The Layers panel and legend open from 1600 px and start collapsed below; the legend's notes sit behind
    "More" (the IMD disclaimer stays visible). The map keeps ≥ ~70 % of its area uncovered at 1920×1080 with
    the drawer open (tested).
  - The subheader dropped the duplicate page links (Results is in the top nav; Approach stays linked from
    Results), and the drawer's icon rail is 92 px so its 15 px labels fit.
- **Type scale** (`index.css`):
  - CSS variables:

    | variable | size |
    |---|---|
    | `--fs-body` | 17 px |
    | `--fs-secondary` | 15 px |
    | `--fs-nav` | 16 px |
    | `--fs-h3` | 20 px |
    | `--fs-h2` | 24 px |
    | `--fs-h1` | 30 px |
    | `--fs-step-text` | 20 px |
    | `--fs-step-heading` | 36 px |
    | `--fs-credits` | 13 px |

    Line-height is 1.5.
  - Tailwind's `text-xs` and `text-sm` are remapped to 15 px, so no utility renders smaller; the old 9–11 px
    sizes were replaced.
  - SVG chart text renders at 15 px at any width (`utils/useSvgUnit.js`).
  - Only the Data credits footer, the map attribution and the inline licence credits are 13 px.
  - Results, Approach and Analytics reflow to one column on phones (no horizontal scroll at 390 px).
- **Data credits:** one line ("Data credits: ERA5, IMERG, GFS, IMD, Copernicus DEM, INSAT/MOSDAC, NASA GIBS,
  OpenStreetMap, OpenWeather, Open-Meteo … All credits") that expands to every credit. These stay visible
  next to the data, because the licence asks for them there:
  - OpenStreetMap: the map attribution.
  - Copernicus DEM: the map attribution, with its copyright holders ("© DLR e.V. 2010-2014 and © Airbus
    Defence and Space GmbH 2014-2018", read from the notice); the full notice is one click away.
  - MOSDAC: "Data Source MOSDAC/SAC/ISRO" in the map attribution whenever an INSAT layer is drawn.
  - OpenWeather ("Weather data © OpenWeather (ODbL)") and Open-Meteo ("Weather data by Open-Meteo.com
    (CC BY 4.0)"): next to their data on the team pages.
  - Nominatim: next to search results.
- **Weather source:** OpenWeather is credited as the primary current-weather source and Open-Meteo as
  "fallback, used only when OpenWeather is unavailable" (SOURCES.json order and labels, team credits, the
  inline credits).
  - After a cold start the backend fills the 380-zone list from OpenWeather at ≤ 50 calls/min (60-min cache,
    unchanged).
  - Pages now ask for the zones they show first (`GET /zones/first?names=a|b`, ≤ 60 names):
    - Dashboard: the selected zone and the flagged zones;
    - Alerts: the alert cards;
    - Reports: the flagged zones.
  - The refresher picks the newest requested missing point before each call.
  - While `summary.openweather_filling` is true the zone list is rebuilt every 20 s and the pages re-poll
    every 30 s.
  - The badge keeps the real per-source counts and adds "the rest switch to OpenWeather as they are
    fetched".
  - Expected time after a cold start (the throttle's rolling window):
    - all 380 zones on OpenWeather 7 min after the first call (slots at 0, 60, …, 420 s; tested);
    - the zones a page shows within about a minute of the page loading.
- **Tests:**
  - serve 184, 8 of them new in `serve/tests/test_overview.py`;
  - backend 62, 2 of them new (shown zones first and 380 zones in 7 min; `/zones/first`);
  - e2e 189 in 25 files, including the new `e2e/overview.spec.js` (13);
  - host parity: `tests/host_parity_probe.py` now probes `/overview`, `/start-here`, `/compute-latency` and
    the Overview images, and `e2e/host_parity_views.spec.js` steps through the Overview.
- **Screenshots:**
  - Overview: `overview_step{1..8}_{1920x1080,390x844}`, `overview_step3_end_1920x1080`, `overview_390_*`;
  - /nowcast: `overview_nowcast_drawer_{1920x1080,1366x768}`;
  - navigation and credits: `overview_nav_menu_1366x768`, `overview_nav_compact_390x844`,
    `overview_credits_open_1366x768`;
  - Results and Approach: `judge_results_*`, `judge_approach_*`.

### Full Copernicus DEM notice in the map attribution (2 Oct 2026)

- Whenever terrain is drawn (/nowcast replay, All-India and Live maps, the Overview, the Dashboard's terrain
  basemap), the map attribution reads "Terrain (Copernicus DEM GLO-90): " followed by the full notice,
  verbatim from the attribution file (the same text as the Data credits): "produced using Copernicus
  WorldDEM-90 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS
  by the European Union and ESA; all rights reserved" (`terrainAttribution` in `useTerrain.js`).
- The attribution wraps to 2 lines at 1366×768 and about 5–8 lines at 390 px.
  - AlertMap publishes its height as `--attr-h`, and the legend, the Layers panel and Start here sit above
    it (`utils/mapLayout.js`), so nothing covers it.
  - On phones (< 768 px) the /nowcast opening Alert section waits (drawer collapsed), so the map and its
    attribution are visible; the Alert tab opens it.
- Test: `e2e/overview.spec.js` "terrain: the full Copernicus DEM notice …" checks, at 1366×768 and 390 px on
  the Overview and /nowcast, that the text matches the credits, sits inside the map, is clear of the zoom
  buttons, uses < 30 % of the map height, and causes no horizontal scroll. The nowcast and dashboard specs
  compare the attribution with `/ml/credits`.
- Screenshots: `terrain_notice_{overview,nowcast}_{1366x768,390x844}`.

### UX fixes from review (3 Oct 2026)

- **Routes:** "/" is the team Dashboard again (unchanged) with one card at the top: "New here? See the system
  briefing …" → `/overview`.
  - The Overview moved unchanged to `/overview`, and `/dashboard` (with any `?city=`) redirects to "/".
  - Nav: Dashboard · Overview · Explore map · Results · Analytics · Current weather (rule-based) (Forecast,
    Alerts, Reports).
  - Internal links follow (Sidebar, the rule-based pages' Dashboard buttons, header search, Start here).
  - `vercel.json` already rewrites every path, so deep links survive a refresh.
- **Attribution bars** (`components/nowcast/AttributionBars.jsx`, used by the Alert drawer "Why" section and
  Overview step 4): left-aligned bars.
  - Length = |SHAP| relative to the largest shown.
  - Colour + arrow + "raises risk" / "lowers risk" come from the sign of the attribution.
  - Same rows, same order; the drawer keeps the values.
- **Drawer:** Alert, Ingredients, Caveats, Shelter options and CAP keep their widths.
  - Event check now opens at the same width as Alert (420 px, 525 px at ≥ 1600 px); its timeline switches to a
    compact layout below 760 px (label and right-hand text above a full-width plot, hour labels thinned so
    they never touch).
  - "Expand" in the Event check header only widens it to 60 % of the window; "Collapse" goes back.
- **Shelter options** (`ShelterPanel.jsx`, `LocationChooser.jsx`):
  - Intro: "Choose a location (where you are, or a place you care about). We list nearby public buildings
    outside the alert areas."
  - Ways to choose a location:
    - search a place (Nominatim, as on the Dashboard, with its credit);
    - click the map;
    - "Use my location": browser geolocation, asked only on click; denied or unavailable shows a plain
      message; outside Uttarakhand and Himachal Pradesh the API answers "Not available for this area yet.";
    - "Try an example location: Kullu" (coordinates read from `public/india_locations.csv`);
    - the selected alert's peak.
  - The location is kept only in page memory. The ML API (`serve/privacy.py`) and the team backend (/ml
    proxy) replace `lat`/`lon` in their access logs with `***` (tested), so it is used only to compute
    distances and never stored or logged by the app. The host's own request log (Render) is outside the
    app's control.
  - Shown as "Location: 32.15° N, 77.25° E, 3,955 m above sea level" (elevation from the API, only once the
    response is for that location) plus why it was chosen: "the peak of the alert nearest Malana river"
    (the default is an alert's peak cell, so "peak", not "centre"), "you clicked here", "your location",
    "example location (Kullu)", "the peak of the selected alert", or the searched place name.
  - Plain English:
    - the summary: "43 public buildings (hospitals, clinics, schools, colleges, town halls, police stations,
      fire stations) are within 25 km of this location. All 43 are inside an alert area." / "N are outside
      all alert areas: listed first below." The types are read from the OSM index via the new
      `building_types` field;
    - "Search up to 50 km", and "Distances are straight-line, not road routes.";
    - the alert-check note sits behind "How this is checked".
  - Pins and list use plain numbers (outside first, then inside): filled = outside all alert areas, hollow =
    inside an alert area.
  - The 3D legend reads "Your chosen location", "Public building outside all alert areas" and "Public building
    inside an alert area"; the elevation text says "… than your chosen location".
- **/nowcast map:**
  - "Observed ≥30 mm/hr" and "Heavy rain outside displayed alerts" are off by default; their toggles are in
    the Layers panel (Observed (replay)). The Overview's own IMERG layer and the Event check are unaffected.
  - A slim toolbar along the top of the map (`MapToolbar.jsx`), never collapsed, holds the event and issue
    pickers, lead 1/2/3/4/6 h and "Also show Watch" (lead and Watch only on Live; lead on All-India); it wraps
    inside itself on a phone.
  - The Layers panel keeps the rarer settings (forecast layer, terrain + opacity, observed toggles, hazards).
    It is 280 px wide, at most half the map high with internal scrolling, collapsed ≤ 1366 px and open
    ≥ 1600 px, and a map click never closes it.
  - The legend is a mini legend, always shown (hazard colours + Warning, + Watch when shown, at most two
    lines), plus "Full legend", which opens the rest until closed.
  - Clicking an alert shows a compact popup (2 lines: hazard, level, value; lead and kind) with "Details",
    which opens the Alert section. The hover tooltip is the same 2 lines; verification and explanations live
    only in the drawer.
  - The map keeps ≥ ~70 % uncovered with the drawer open at 1366×768 and 1920×1080 (tested).
- **Tests:** new `e2e/ux_review.spec.js` (14), covering:
  - routes and redirects;
  - bar direction from the sign;
  - Event check width vs the other sections, plus Expand / Collapse;
  - geolocation mocked inside (Shimla) and outside (Mumbai) the region, and denied;
  - the Kullu example;
  - the wording;
  - layer defaults;
  - toolbar at 1920 / 1366 / 390;
  - mini legend and panels;
  - popup length;
  - uncovered share.

  Also `serve/tests/test_privacy.py` and a backend log-redaction test.
- **Screenshots:** `ux_dashboard_card_*`, `ux_overview_step4_*`, `ux_nowcast_default_*`,
  `ux_event_check_{normal,expanded}_*`, `ux_alert_popup_*`, `ux_shelter_*`, `ux_3d_view_*` (1920×1080 and
  1366×768).

### Dashboard map declutter (4 Oct 2026)

Approved exception to the 15 px type scale: overlays on the Dashboard map (only there) use 14 px.

- **Source line (top right):** the 5-line box is now one line built from the zone list (`compactSourceLine`
  in `utils/dashboardRisk.js`), e.g. "OpenWeather 150/380 · Open-Meteo 230/380 · updated 19:30 UTC".
  - Counts come from `summary.zone_sources`, plus "sample data N/T" for a mixed list. The time is the newest of
    `source_times`, `data_time` and `latest_observed_at`.
  - On a narrow map the counts shorten with "…" and "updated HH:MM UTC" stays whole (tested at 1366).
  - Its (i) (`components/InfoTip.jsx`: click to open; Esc or a click outside closes it) shows the full
    wording, unchanged (`dashboard-source-badge`). That includes "the rest switch to OpenWeather as they are
    fetched" while OpenWeather fills the list, and "Licence credits: bottom-right corner of the map."
- **Licence credits in the map's attribution corner** (`weatherAttribution`, added via Leaflet's attribution
  control), for each source whose data appear:
  - "Weather data © OpenWeather (ODbL)": the attribution line from `openweather_terms.json`, linked to
    openweathermap.org, plus an ODbL link;
  - "Open-Meteo.com (CC BY 4.0)": linked to open-meteo.com, plus a CC BY 4.0 link. It reads "Weather data:
    Open-Meteo.com (CC BY 4.0)" when it is the only weather source.
  - Both terms are met: OpenWeather "on the screen or page where weather data appears", not hidden; Open-Meteo
    "a link next to any location Open-Meteo data are displayed" plus a licence link.
  - The right panel keeps its full credit lines (`OpenMeteoCredit` / `OpenWeatherCredit`).
- **Legend:** one row above the attribution (bottom left): "● Low ● Moderate ● High", plus "● Sample (risk not
  shown)" only when the list has sample zones. Its (i) says "Marker colour = the zone's rule-based risk level
  (not the ML model)."
- **Base-map switch:** a compact Map / Satellite / Terrain pill (top left).
- **Status line above the map:** "Rule-based indicators: N moderate · N high · not an official warning", with an
  (i) for the source, the sample-zone note on mixed lists, and "Fixed rules on current weather, not the ML
  model." The red "High Risk in N locations" banner (HIGH zones present) is unchanged.
- **Coverage (tested):** at 1920×1080 and 1366×768 and on all three base maps (Terrain wraps the long DEM notice):
  - the overlays cover ≤ 15 % of the map;
  - none overlaps the attribution, another overlay or the map edge (the Dashboard map has no zoom buttons;
    wheel / pinch zoom);
  - the legend is one row, and overlay text is 13–14 px.
- **Tests:** in `e2e/dashboard.spec.js`, 2 new tests:
  - source line vs the summary, (i) open / Esc / click outside, legend (i), credits and links in the
    attribution;
  - coverage and overlap at both sizes.

  Also updated: `calm.spec.js` and `mixed_zones.spec.js` (new strip wording, detail in the (i), legend
  label), and `openweather.spec.js` (three-source line, time whole at 1366).
- **Screenshots:** `dashboard_{1920x1080,1366x768}`, `dashboard_map_*`, `dashboard_map_info_*` (popover open),
  `dashboard_map_terrain_*`, plus `openweather_dashboard_*` and `mixed_dashboard_*`.

## 7. Troubleshooting

| symptom | cause / fix |
|---|---|
| page shows "Cannot reach the nowcast API" | the team backend isn't running on :8000. Start it, or use the fallback |
| `502 ML API unreachable` | ML serve isn't running on :8001 |
| `504` on replay | a cold replay exceeded the timeout. It keeps running and is cached, so click again after a few seconds |
| `503 a replay is already running` | only one replay runs at a time (8 GB laptop) |
| `npm run dev` fails with an engine or syntax error | the wrong Node is on PATH. Run the PATH line above; `node -v` must print v24.19.0 |
| tiles missing | the base map uses OpenStreetMap tiles and needs internet access |
| hosted map layers missing, `/ml/.../map/...png` answers 500 | the host package must contain the `prob_L*h.bands.npz` files (`hosting/build_space.py` writes them; the host has no rasterio). Rebuild and redeploy; `tests/test_host_parity.py` checks it |
| hosted pages load nothing from `/ml` (blank Live / Nowcast) | CORS: `CORS_ORIGINS` on Render must be exactly the Vercel origin (no trailing slash). Check `curl -s -D - -o NUL -H "Origin: https://<vercel-app>" https://<service>.onrender.com/ml/live` shows `access-control-allow-origin` |
| badge shows fewer OpenWeather zones than expected | the refresher is still working through the zones (≤ 50/min, ~7.6 min for 380) or is in cooldown: `GET /weather_source` → `openweather.refresh_running`, `last_error`, `cooldown_until` |
| team pages say "Sample data — no live weather feed" | Open-Meteo failed and nothing was cached. `GET /weather_source` → `open_meteo.last_error` says why (HTTP status or exception); `cooldown_until` says when the next request is allowed |

## 8. Attributions (all shown in the UI)

| source | where | credit |
|---|---|---|
| Copernicus DEM GLO-90 | terrain hillshade (ML Nowcast, Dashboard "Terrain") | "produced using Copernicus WorldDEM-90 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved", verbatim in the Data credits footer + licence and DOI links (`serve/assets/terrain/ATTRIBUTION.md`) |
| INSAT-3DR via MOSDAC | INSAT layer + Event-check rows (REF045, REF051) | "Data Source MOSDAC/SAC/ISRO. https://mosdac.gov.in" + DOI https://doi.org/10.19038/SAC/10/3RIMG_L1C_ASIA_MER in the footer (`serve/assets/insat/ATTRIBUTION.md`). Only value-added derivatives are shipped, never raw files |
| OpenWeather (ODbL) | team pages' weather when `OPENWEATHER_API_KEY` is set: "/", Forecast, Alerts, Analytics | "Weather data © OpenWeather" (link) + ODbL link + "current weather, used as input to rule-based indicators", next to every place its data appear (`OpenWeatherCredit.jsx`; on the Dashboard map, "Weather data © OpenWeather (ODbL)" in the map attribution); team credits entry `openweather`. Terms, limits and quotes: `backend/assets/openweather_terms.json` |
| Open-Meteo (CC BY 4.0) | team pages' weather when no OpenWeather key is set: "/", Forecast, Alerts, Analytics | "Weather data by Open-Meteo.com" (link) + CC BY 4.0 link + "model data, used as input to rule-based indicators", next to every place its data appear (`OpenMeteoCredit.jsx`; on the Dashboard map, "Open-Meteo.com (CC BY 4.0)" in the map attribution). Terms, limits and quotes: `backend/assets/open_meteo_terms.json` |
| NASA GIBS | Dashboard "Satellite" (VIIRS SNPP corrected reflectance, yesterday UTC) | map attribution "Imagery: NASA GIBS (ESDIS), VIIRS SNPP corrected reflectance, <date>" |
| OpenStreetMap | all base maps | "© OpenStreetMap contributors" (map attribution); tiles from `https://tile.openstreetmap.org` under the OSM tile usage policy (light use) |
| IMERG (NASA GPM), ERA5 / GFS | model inputs | named on the pages where they are used (replay banner, Live banner, Approach). Required wording + DOIs in the Data credits footer (Batch 3) |
| IMD gridded rainfall | cross-check (ML); team model data | Pai et al. 2014 citation, in the footer and the team Credits popover |
| Nominatim (OSM data, ODbL) | Dashboard place search | "Place search: © OpenStreetMap contributors, ODbL, via Nominatim" next to the searched place (`NominatimCredit.jsx`) and in the team Credits popover |
| Unsplash | team pages' background photos (HeroBanner, Sidebar) | "Photo: Unsplash" on each photo (the URLs do not name the photographer) and "Photos: Unsplash." in the popover |

**Team pages' Credits (Batch 3):**
- An info icon (1366) or a "Credits" label (≥ 1536 px) in the top bar of Dashboard, Forecast, Alerts,
  Analytics and Reports opens a popover (Esc / × / click outside closes it).
- It lists the `GET credits` entries with `shown_on` "team". ML pages keep their footer instead.

**Nominatim usage policy (Batch 3, `utils/nominatim.js`, quotes in `backend/assets/nominatim_policy.json`):**
- one request at a time, at least 1 s apart ("an absolute maximum of 1 request per second");
- per-query cache (memory + sessionStorage), with identical in-flight queries shared;
- no auto-complete: only Find / Enter / region pick sends a request. A queued search overtaken by a
  newer one is dropped before it is sent (latest wins);
- the browser sends the Referer (page origin) as identification; a browser cannot set User-Agent. The
  backend never calls Nominatim.

## 9. Known limitations and known issues

**Limitations (by design; stated in the UI):**
- The model is frozen (lgbm_v0). Replays are case studies. REF025 is in-sample; REF051 is a 2024
  descriptive case study, not a new test score.
- Live is **not validated**: its inputs (IMERG Early + GFS) differ from the validated setup (IMERG
  Final + ERA5). IMERG Early was 5.3 h old at our first live poll (LIVE_PIPELINE.md also notes ~4 h
  typical). A 6 h lead is therefore worth ≈ 0.7 h (≈ 2 h at ~4 h) of real warning. The only live run
  on disk is 26 Sep 2026 03:30Z.
- The national sample has no alerts and no flash-flood band.
- INSAT is an observation layer only, not a model input. Using it needs INSAT history + retraining.
  Position uncertainty is ≈ 5–10 km. The product's lookup table stops at 179.9 K, so the coldest tops
  are shown as "≤180 K" and no cooling rate is computed there.
- **Weather on the team pages:**
  - Order per zone: OpenWeather (key set; throttled ≤ 50 calls/min, cached 60 min, stale when a refresh
    fails) → **Open-Meteo** → sample data (A3).
  - Open-Meteo gives **model data, not observations**. Its "current" values are 15-minutely model data,
    and rain is the hourly precipitation sum of the preceding hour. The badge says "Open-Meteo (model
    data), updated HH:MM UTC" and never "observed".
  - Source-driven "Live" / "Real-Time" wording treats Open-Meteo as live. Risk stays "rule-based
    indicator (not the ML model)".
  - The zone list is fetched in batches of 100 (Open-Meteo allows up to 1000 per request) and cached
    60 min server-side; each request has a 25 s timeout.
  - HTTP 429 and timeouts are retried twice. After a final failure, the last successful Open-Meteo data
    is served (stale, with its real time), and only zones that never had any use sample data.
  - On sample data the four team pages show no risk indicators (safety net).
  - In a mixed list, each sample zone carries no risk. It is grey on the map, has no card, and is left
    out of every count and chart; the badge states the real counts.
  - With the server unavailable, Analytics shows no figures (the built-in example cities are gone).
  - Analytics Key Insights are built from the zones' own values (A3).
  - Still illustrative: the Analytics Rainfall Trend chart (multiples of the average; banner
    "Illustrative figures"). Removed in the honesty fixes batch (1 Oct 2026).
  - Since 2 Oct 2026 Analytics shows the ML model only ("Nowcast analytics (ML model)"); the rule-based
    charts, filters and Key Insights above were removed from it (see "Poller session fix, CAP Atom feed,
    Analytics redesign").
  - Primary Threat and hazard levels come from fixed rule scores. A HIGH zone with any rain above
    0.0 mm gets flash-flood score 0.85 and so shows "Flash Flood", even with 0.4 mm (seen in the A3
    screenshots). Not changed.
  - Measured on 29 Sep 2026: 380 zones = 4 requests in ≈ 2.0 s; a repeat within the cache = 0 requests
    (0.06 s); the Forecast/Analytics list of 100 = 1 request (27 new points, 73 cached).
  - `GET /weather_source` shows the order and the Open-Meteo counters (no secrets).
  - Free-tier limits: < 10,000 calls/day, 5,000/hour, 600/min. The 60-min cache keeps one busy site
    under 10,000/day even if every location counted as one call.
  - The risk distribution and counts now change with the weather; with sample data they were fixed by
    the city names. Example: at 13:45Z many humid zones are MODERATE by the humidity > 70 % rule.
- CAP output is a demo: status Exercise / Test, never Actual. Nothing is sent anywhere, and there is
  no integration with Sachet, IMD or NDMA.

**Known issues (team pages; not changed):**
- Dashboard sidebar: "Live Map" and "Locations" only reload the zone list, "Settings" opens Analytics,
  and the avatar does nothing.
- (4 Oct 2026) The backend's MODERATE reason reads "Moderate convective indicators observed"
  (`backend/main.py`, `predict_nowcast`). When the default (first) zone is MODERATE, as on 4 Oct with 0 HIGH
  zones, the right panel shows it, and the "never 'observed' on model / sample data" checks fail:
  - `weather_sources.spec.js` ("open-meteo");
  - `openweather.spec.js` ("OpenWeather for every zone").

  This is data-dependent: they fail the same way without the declutter changes (checked with the changes
  stashed). The wording is not changed here.
- **Honesty fixes (Batch 1, audit A1–A6, F2):**
  - **Analytics:** "Rule-based indicator (not the ML model)" and "Rule-based summary of sample data /
    OpenWeather data / built-in example data (backend not reachable)". The XGBoost, "Validated" and
    "94.6% confidence" claims are removed. The subtitle follows the weather source. The risk donut is
    now an SVG chart: the recharts Pie drew NaN sectors under React 19 and logged console errors.
  - **Reports:** each card is labelled "Example report (illustrative)", and the page says "not official
    bulletins". The certified/official, Doppler/radar, accuracy and "Confidential" wording is gone. The
    evaluation card says "not evaluated". The export footer reads "Example report (illustrative) - not
    an official bulletin".
  - **Forecast:**
    - the fixed "Model Confidence" line is removed;
    - "Backend Synchronized" appears only after `/batch_predict` answers;
    - the alert badge reads "Rule-based alert on sample data / OpenWeather data";
    - with the backend down: "Forecast unavailable — backend not reachable", with no built-in Mumbai record;
    - no "stable" wording.
  - **/alerts:**
    - every card says "Follow official IMD and state advisories." instead of action advice;
    - with the backend down: "Alerts unavailable — backend not reachable", and the badge says
      "Backend not reachable";
    - never "stable".
  - **Dashboard:**
    - the banner adds "(sample data, rule-based)" on sample data;
    - with the backend down: "Zone data unavailable — backend not reachable", and no risk banner.
- **Still on the team pages (not changed yet):**
  - Batch 1b resolved the Forecast leftovers:
    - "Continuous data ingest from backend ML inference" is removed;
    - "Short-Range (24h NWP)" and "Extended Outlook (7 Days)" are **removed**, not wired: an hourly/daily
      Open-Meteo endpoint plus remapping the two cards was more than ~15 min;
    - "safeguards recommended" became "Follow official IMD and state advisories.";
    - the live-path wording about "observation sensors / ground telemetry / hybrid ML" now names the
      actual source;
    - Analytics' "Thunderstorm convective probability" became "Rule-based thunderstorm indicator".
  - Analytics still falls back to built-in example nodes when the backend is down, now labelled as such;
  - Reports: the fixed example figures (dates, sector counts, river-basin text) are unchanged but labelled
    as examples. Replaced by one computed report in the honesty fixes batch (1 Oct 2026).
- Forecast: its source line follows the backend's weather source, with the same text as "/" ("Sample
  data — no live weather feed" / "OpenWeather, observed HH:MM UTC"). A banner says "Score" and the risk
  levels are a rule-based indicator, not the ML model.
- /alerts: "Live Feed" and "Live • …" appear only when the source is OpenWeather; otherwise it shows
  "Sample data — no live weather feed". Since the honesty fixes batch (1 Oct 2026): "Rule-based
  indicators from <source>" and "<source> • N min ago".
- CORS (fixed in Batch 2): `backend/main.py` reads `CORS_ORIGINS` (default: the Vite dev origins),
  with credentials off.
- `nowcast_data/scripts/build_state_mask.py` (offline, not shipped) has a hard-coded local input
  path.
- One 502 from the `/ml` proxy was seen once, right after a restart.
- The team's own ESLint errors are unchanged: unused `React` imports, a Dashboard effect, and
  `api.js` error causes.

## 10. Hosting checklist (checked 29 Sep 2026)

**Render prep (30 Sep 2026):**
- Hugging Face Docker Spaces need PRO since July 2026, so the backend target is now a Render free web
  service. Steps are in `HOSTING.md` §2; the HF route is kept in §5.
- `hosting/space` is its own Git repo (branch `main`, one commit, 1,095 files, ≈ 64 MB packed), ignored
  by team_app.
  - `build_space.py` keeps its `.git` on rebuild.
  - It adds `render.yaml`, `.gitignore`, `.dockerignore` and `.gitattributes` (`* -text`, byte-exact
    storage).
  - It refuses any file over 100 MB.
  - It no longer ships the two unread 13–14 MB `grids.json` files (national sample and live run).
- Dockerfile: `uvicorn … --port ${PORT:-7860}`.
- `render.yaml`:
  - one free Docker web service, `healthCheckPath: /health`;
  - `ML_REPLAY_ENABLED=0`;
  - `CORS_ORIGINS` / `ML_CORS_ORIGINS` with `sync: false`.
- Measured from the host folder with `PORT=10000`:
  - first `/health` after 2.4 s;
  - RSS 190 MB at start, 271 MB warm, 295 MB peak;
  - 885 requests, all as expected. The only 404 is `/ml/episodes/REF025/timeline`, which is also 404
    with the full data ("no timeline for REF025").
- Tests: `tests/test_hosting.py` covers the port, the Blueprint, the build rules and the static
  `/health`.

**Batch 2:**
- Step-by-step hosting (Render or HF Space, plus Vercel) is in `HOSTING.md`.
- The hosted backend is ONE process: `backend/host_app.py` mounts the ML API in-process at `/ml`.
- It is packaged by `hosting/build_space.py` (148 MB, see its `MANIFEST.txt`) with `hosting/Dockerfile`
  and `hosting/requirements-host.txt`.
- `frontend/frontend-react/vercel.json` adds the SPA fallback.

- **Service URLs:** only `VITE_ML_API_BASE`, `VITE_API_BASE` (frontend, build time) and `ML_API_URL`
  (team backend). Every page reads its backend URL from `src/config.js`. There are no local drive
  paths in the served code.
- **CORS:**
  - ML API: `ML_CORS_ORIGINS` (default: the Vite dev origins), GET/POST only.
  - Team backend: `allow_origins=["*"]` with credentials. Restrict this to the hosted frontend origin
    before deploying (known issue, not changed).
- **Secrets:**
  - None in either repo: no key literals, and `.env` / `backend/.env` are git-ignored.
  - `OPENWEATHER_API_KEY` is read from the environment only; the MOSDAC credentials were never used
    by the served code.
  - `raw/` is git-ignored, so no MOSDAC HDF5 is tracked.
  - `demo_inputs/` holds public NASA IMERG netCDF4 subsets (351 files) for on-demand replay only.
- **Shipped data (nowcast_data):**

  | path | size |
  |---|---|
  | `serve/assets` | 16 MB |
  | `models/v0` | 9.2 MB |
  | `docs/` | 158 MB (demo_explain 64, demo_replays 33, case_studies 28, sample_output_india 18, live_output 16) |
  | `demo_inputs` | 110 MB, needed only for "Re-run model now" |

  Total ≈ 293 MB, or ≈ 183 MB without replay inputs.
- **Python for a hosted build:**
  - ML API: `serve/requirements.txt` runtime section (fastapi, starlette, pydantic, pydantic_core,
    anyio, uvicorn, numpy, rasterio, affine, pillow, shapely, pandas). For on-demand replay, also the
    model runtime from the root `requirements.txt`: lightgbm, scikit-learn, scipy, xarray, netCDF4,
    h5py, opencv-python-headless, shapely, pandas, pyarrow, psutil, PyYAML.
  - Team backend: `requirements.txt`.
  - Not needed: `pytest` / `httpx` (tests), `xmlschema` / `elementpath` (`serve/requirements-dev.txt`,
    CAP XSD test), `pypdf` (reading source PDFs), `pyproj` / `h5py` (the offline INSAT builder).
- **Start / stop locally:** `start_demo.ps1` (starts the team backend only after `:8001` answers) and
  `stop_demo.ps1`.
