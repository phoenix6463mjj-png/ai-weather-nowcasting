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
| `OPENWEATHER_API_KEY` | team backend | none | team pages only; never in code. Weather source order: OpenWeather if this key is set, else **Open-Meteo** (no key, model data), else **sample data**. With a key, the zone list is cached 30 min (free-tier limits) |
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

## 7. Troubleshooting

| symptom | cause / fix |
|---|---|
| page shows "Cannot reach the nowcast API" | the team backend isn't running on :8000. Start it, or use the fallback |
| `502 ML API unreachable` | ML serve isn't running on :8001 |
| `504` on replay | a cold replay exceeded the timeout. It keeps running and is cached, so click again after a few seconds |
| `503 a replay is already running` | only one replay runs at a time (8 GB laptop) |
| `npm run dev` fails with an engine or syntax error | the wrong Node is on PATH. Run the PATH line above; `node -v` must print v24.19.0 |
| tiles missing | the base map uses OpenStreetMap tiles and needs internet access |

## 8. Attributions (all shown in the UI)

| source | where | credit |
|---|---|---|
| Copernicus DEM GLO-90 | terrain hillshade (ML Nowcast, Dashboard "Terrain") | "produced using Copernicus WorldDEM-90 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved", verbatim in the Data credits footer + licence and DOI links (`serve/assets/terrain/ATTRIBUTION.md`) |
| INSAT-3DR via MOSDAC | INSAT layer + Event-check rows (REF045, REF051) | "Data Source MOSDAC/SAC/ISRO. https://mosdac.gov.in" + DOI https://doi.org/10.19038/SAC/10/3RIMG_L1C_ASIA_MER in the footer (`serve/assets/insat/ATTRIBUTION.md`). Only value-added derivatives are shipped, never raw files |
| Open-Meteo (CC BY 4.0) | team pages' weather when no OpenWeather key is set: "/", Forecast, Alerts, Analytics | "Weather data by Open-Meteo.com" (link) + CC BY 4.0 link + "model data, used as input to rule-based indicators", next to every place its data appear (`OpenMeteoCredit.jsx`). Terms, limits and quotes: `backend/assets/open_meteo_terms.json` |
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
  - Order: OpenWeather (key set) → **Open-Meteo** (no key) → sample data.
  - Open-Meteo gives **model data, not observations**. Its "current" values are 15-minutely model data,
    and rain is the hourly precipitation sum of the preceding hour. The badge says "Open-Meteo (model
    data), updated HH:MM UTC" and never "observed".
  - Source-driven "Live" / "Real-Time" wording treats Open-Meteo as live. Risk stays "rule-based
    indicator (not the ML model)".
  - The zone list is fetched in batches of 100 (Open-Meteo allows up to 1000 per request) and cached
    60 min server-side; each request has a 10 s timeout.
  - Any error means those zones use sample data (labelled as such).
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
    as examples.
- Forecast: its source line follows the backend's weather source, with the same text as "/" ("Sample
  data — no live weather feed" / "OpenWeather, observed HH:MM UTC"). A banner says "Score" and the risk
  levels are a rule-based indicator, not the ML model.
- /alerts: "Live Feed" and "Live • …" appear only when the source is OpenWeather; otherwise it shows
  "Sample data — no live weather feed".
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
