# Project structure and Phase 1 audit

## What the existing application contained (v1)

- React 19 + Vite 8 + Tailwind 4 + Recharts 3 + Leaflet, Python 3 + pandas/NumPy/scikit-learn for the offline models.
- Nine pages in `src/pages/`, navigation and shared state in `src/App.jsx` and `src/state.jsx`.
- Reusable pieces: `components/ui.jsx` (cards, badges, tabs, notes), `components/RiskMap.jsx` (Leaflet map with
  schematic lake outlines and a coloured grid layer), `components/Gauge.jsx`, `components/LocationDetail.jsx`.
- Calculation modules in `src/lib/`: `model.js` (fitted logistic + random-forest evaluation), `risk.js` (thresholds),
  `spatial.js` (inverse-distance weighting), `analysis.js` (prediction runs, alert rules), `stats.js`, `grid.js`, `data.js`.
- Data: synthetic 2018-2025 observations at 31 stations plus 12 unmonitored locations from `scripts/generate_data.py`.

## What was kept, what changed in Phase 1

- Every v1 page, colour, route and calculation is retained. The v1 model results are byte-identical after the data
  rebuild (checked by comparing `model_results.json` before and after).
- Nitrate (needed for the AHP criteria) was added to the generator with its own random streams, so no earlier
  value changed.
- The generator now writes RAW data to `data/raw/`. `scripts/prepare_data.py` validates and cleans it and writes the
  files the app reads. `npm run data` runs both.

## Layout

```
data/raw/                      generator output before cleaning (+ hidden truth for validation only)
scripts/generate_data.py       synthetic data, bloom models (logistic, random forest), validation
scripts/prepare_data.py        Phase 1: checks, cleaning, long format, missing-sample register, dictionary, quality report
public/data/                   cleaned CSV files served with the app
src/data/                      JSON read by the app (observations, stations, lakes, model results, quality report)
src/lib/                       calculation code (plain functions)
src/pages/, src/components/    interface
docs/                          dictionary, quality report, methodology, implementation report
```

## v2 additions (Kriging, spatial autocorrelation, AHP)

The v1 data, models and calculations are unchanged; the interface was restyled to a dark violet/teal theme (a design reference supplied for v2) and the layout, charts and navigation were kept, with new pages added.

```
scripts/spatial_common.py, spatial_stats.py   variograms, Moran's I (Python reference implementation)
scripts/kriging_engine.py                      PyKrige cross-validation, gap filling, parity fixtures
scripts/bloom_validation.py                    calibration metrics for the bloom model
scripts/ahp_fixtures.py                        numpy eigen reference for the AHP tests
scripts/validate_integration.mjs               Kriging + AHP validated against hidden truth
scripts/make_report.py                         docs/IMPLEMENTATION_REPORT.md from the result files
src/lib/spatialCore.js, spatialData.js         browser variograms and Moran's I; indicator metadata and data cubes
src/lib/krigingCore.js, kriging.js             Ordinary Kriging solver; app-side lake fits, grid, location predictions
src/lib/ahp.js                                 Saaty matrix, eigenvector, CR, normalisation, composite
src/lib/integrationCore.js, integration.js     Monte Carlo and actions (pure core + app wrapper)
src/lib/estimator.js                           IDW or Kriging inputs for the bloom model
src/pages/SpatialStats.jsx, SpatialInterpolation.jsx, AhpRisk.jsx, UnmonitoredAhp.jsx
src/data/kriging_results.json, spatial_stats.json, integration_validation.json, bloom_validation.json
public/data/estimated_missing_values.csv, kriging_cv_cases.json
tests/*.test.mjs, tests/test_python.py, tests/ui_smoke.mjs, tests/fixtures/
```
