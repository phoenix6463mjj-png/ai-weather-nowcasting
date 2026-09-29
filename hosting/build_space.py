"""Assemble the Hugging Face Space folder (hosting/space/, git-ignored): only the files the hosted app
reads. Run from anywhere:

    python hosting/build_space.py [--nowcast-data D:/nowcast_data] [--out hosting/space]

The file set was derived by recording every file the one-process app opened during the full e2e run
(replay disabled), then widened to whole folders where the API serves any file of a kind (e.g. all
issues of a case study, their rasters read by rasterio). Excluded, with reasons, in MANIFEST.txt.
"""
import argparse
import fnmatch
import shutil
from pathlib import Path

TEAM = Path(__file__).resolve().parents[1]

# (source root key, relative path or glob, what it is for)
NOWCAST_FILES = [
    ("serve/*.py", "ML API code (tests and offline build_* scripts excluded, except build_timeline.py, imported at runtime)"),
    ("serve/assets/**/*", "derived display assets: terrain hillshade/rasters, INSAT PNGs + series, ingredients aggregates, IMERG site series"),
    ("docs/demo_explain/**/*", "precomputed demo issues: manifests, alerts, explanations, grids, probability rasters, waterfall figures"),
    ("docs/case_studies/**/*", "REF051 case study issues (same kinds)"),
    ("docs/sample_output_india/**/*", "national sample (probability rasters, manifest)"),
    ("docs/live_output/**/*", "the one live run (20260926T0330Z)"),
    ("docs/LIVE_PIPELINE.md", "quoted by the case-study paragraph (IMERG Early latency)"),
    ("catalog/documented_event_times.csv", "documented-event check"),
    ("catalog/selected_episodes.csv", "episode metadata"),
    ("models/v0/scores_test.csv", "Results page"),
    ("models/v0/scores_val_farcap.csv", "Results page"),
    ("models/v0/reliability_test.csv", "Results page (reliability)"),
    ("models/v0/reliability_val_farcap.csv", "Results page (reliability)"),
]
NOWCAST_EXCLUDE = ["serve/tests/**/*", "serve/build_ingredients*.py", "serve/build_terrain.py", "serve/build_insat_case.py",
                   "**/__pycache__/**/*", "**/*.pyc"]
TEAM_FILES = [
    ("backend/main.py", "team backend"),
    ("backend/ml_proxy.py", "imported by main (the proxy route is shadowed by the in-process mount)"),
    ("backend/host_app.py", "hosted entry point (one process)"),
    ("backend/assets/open_meteo_terms.json", "Open-Meteo terms/attribution record"),
    ("utils/api_fetcher.py", "weather sources (OpenWeather / Open-Meteo / sample)"),
    ("utils/locations_manager.py", "zone list"),
    ("utils/v2_predictor.py", "rule-based risk + rainfall_model_v2.pkl"),
    ("data/india_locations.csv", "1,088 locations"),
    ("models/rainfall_model_v2.pkl", "the only team model the backend loads"),
    ("models/rainfall_model_v2_meta.pkl", "its encoders"),
]
EXCLUDED = """Excluded (not read by the hosted app):
- nowcast_data/raw/, interim/, features/, scratch/, logs/, archive/, kaggle_export*: raw inputs, working
  files and credentials-adjacent folders; never shipped (raw MOSDAC HDF5 lives only in raw/insat/).
- nowcast_data/demo_inputs/ (110 MB): inputs for on-demand replay, which is disabled on the host.
- nowcast_data/docs/demo_replays/ (34 MB): reference outputs for replay byte-comparison (replay only).
- nowcast_data/docs/*.md except LIVE_PIPELINE.md: the other quotes are stored in code and verified by
  tests, not read at runtime.
- nowcast_data/models/ other than the four CSVs: model files are only needed for replay.
- nowcast_data/nowcast/ (model runtime) and scripts/: replay/offline only.
- team_app/models/final_rainfall_model.pkl, final_model.pkl, weather_model.pkl and the other pickles
  (~75 MB): not loaded by the backend.
- team_app/data/raw, data/processed: training data / caches, not read at runtime.
- team_app/frontend/: hosted separately (Vercel).
- .env files, tools/mdapi/config.json, ~/.netrc: never copied; secrets go in Space settings only.
"""


def _copy_globs(src_root, patterns, excludes, dst_root, log):
    for pat, why in patterns:
        matches = [p for p in src_root.glob(pat) if p.is_file()]
        if not matches:
            raise SystemExit(f"nothing matches {src_root / pat}")
        n = size = 0
        for p in matches:
            rel = p.relative_to(src_root).as_posix()
            if any(fnmatch.fnmatch(rel, e) for e in excludes):
                continue
            d = dst_root / rel
            d.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(p, d)
            n += 1
            size += p.stat().st_size
        log.append((f"{dst_root.name}/{pat}", n, size, why))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--nowcast-data", default=str(TEAM.parent / "nowcast_data"))
    ap.add_argument("--out", default=str(TEAM / "hosting" / "space"))
    a = ap.parse_args()
    out = Path(a.out)
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    log = []
    _copy_globs(Path(a.nowcast_data), NOWCAST_FILES, NOWCAST_EXCLUDE, out / "nowcast_data", log)
    _copy_globs(TEAM, TEAM_FILES, [], out / "team_app", log)
    for f, dst in (("Dockerfile", "Dockerfile"), ("requirements-host.txt", "requirements-host.txt"),
                   ("space_README.md", "README.md")):
        shutil.copy2(TEAM / "hosting" / f, out / dst)
    # safety: nothing secret or raw may be in the folder
    bad = [p for p in out.rglob("*") if p.is_file() and (p.suffix in (".h5", ".hdf5", ".HDF5", ".nc4", ".part")
           or p.name in (".env", ".netrc", "_netrc", "config.json", "kaggle.json", ".cdsapirc"))]
    if bad:
        raise SystemExit(f"refusing: {bad[:5]}")
    total = sum(p.stat().st_size for p in out.rglob("*") if p.is_file())
    lines = [f"{n:5d} files {size / 1e6:8.2f} MB  {what}  ({why})" for what, n, size, why in log]
    (out / "MANIFEST.txt").write_text("\n".join(lines) + f"\n\nTOTAL {total / 1e6:.1f} MB\n\n" + EXCLUDED, encoding="utf-8")
    print("\n".join(lines))
    print(f"TOTAL {total / 1e6:.1f} MB -> {out}")


if __name__ == "__main__":
    main()
