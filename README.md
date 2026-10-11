# GL-WQI v2: Great Lakes Water Quality Intelligence (prototype)

**All data and model outputs are SIMULATED.** Nothing here is a real measurement or an official warning.

Version 2 makes three methods the core analytical framework, each computed from the data (nothing is hard-coded):

| Method | Where | What it answers |
|---|---|---|
| Ordinary Kriging (PyKrige offline, same equations in the browser) | Spatial Interpolation | What are the indicator concentrations where nobody sampled, and how uncertain are they? |
| Spatial autocorrelation (Global/Local Moran's I, semivariogram) | Spatial Statistics | Is there spatial structure, where are the clusters, and how far does it reach? |
| Analytic Hierarchy Process | AHP Risk Assessment | How should indicators be weighted and combined into a 0-100 risk score, and are the judgments consistent? |

Kriging and AHP are combined on **Unmonitored Area Intelligence** (kriged indicators, AHP score, Monte Carlo risk interval, exceedance probability, sampling priorities). The **bloom model** (logistic regression, with a random forest for comparison) stays separate and validated; an AHP score is not a bloom probability, and a kriged value is not an observation.

## Run
    npm install
    npm run dev          # http://localhost:5173
    npm run build        # static bundle in dist/ (Vercel-ready)
    npm test             # JS tests + Python tests + JS-vs-scikit-learn parity
    npm run preview      # serve the built bundle on :4173

## Regenerate the data and results (optional: all outputs are already committed)
Python 3.10+ with `pandas numpy scikit-learn scipy PyKrige esda libpysal`:

    npm run data         # simulate data, validate/clean it, refit the bloom models
    npm run analysis     # variograms + Moran, Kriging cross-validation, bloom calibration, AHP fixtures, Kriging+AHP validation
    npm run report       # rebuild docs/IMPLEMENTATION_REPORT.md from the result files

The app itself needs no API keys, no backend and no network (map tiles are optional; the schematic lake outlines always draw).

## Deploy to Vercel
Import the folder (or `vercel --prod`). `vercel.json` sets `npm run build`, output `dist`, and a single-page-app rewrite that leaves `/data/*` and `/assets/*` alone. Precomputed Python outputs live in `src/data/*.json` (bundled) and `public/data/*` (served as files), so no Python runs on Vercel.

## Pages
Executive Overview · Geographic Risk Explorer · Water Quality Analytics · **Spatial Statistics** · **Spatial Interpolation** · **AHP Risk Assessment** · Bloom Prediction Lab · **Unmonitored Area Intelligence** · Early-Warning Center · Model Performance · Data Explorer · Methodology.

## Key files
    scripts/generate_data.py       synthetic data and bloom models           scripts/prepare_data.py     data checks and cleaning
    scripts/spatial_common.py      shared Python spatial functions           scripts/spatial_stats.py    variograms, Moran's I
    scripts/kriging_engine.py      PyKrige CV, gap filling, fixtures         scripts/bloom_validation.py calibration metrics
    scripts/validate_integration.mjs  Kriging+AHP vs hidden truth            scripts/make_report.py      implementation report
    src/lib/krigingCore.js         Ordinary Kriging solver                   src/lib/spatialCore.js      variograms, Moran's I
    src/lib/ahp.js                 AHP                                       src/lib/integrationCore.js  Monte Carlo, actions
    src/lib/estimator.js           IDW or Kriging inputs for the bloom model src/lib/analysis.js         runs, alert rules
    tests/                         node:test suites, python checks, fixtures, optional UI smoke test

See `docs/` for the data dictionary, data-quality report, project structure and the implementation report (phases, models, validation, limitations, incomplete features).
