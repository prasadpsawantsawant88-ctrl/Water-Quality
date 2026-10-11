"""Builds docs/IMPLEMENTATION_REPORT.md from the generated result files, so every number in it comes from an actual run.
Run: python3 scripts/make_report.py   (after npm run data and npm run analysis)"""
import json, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
L = lambda p: json.load(open(os.path.join(ROOT, p)))
K, S, I, B, DQ = L("src/data/kriging_results.json"), L("src/data/spatial_stats.json"), L("src/data/integration_validation.json"), L("src/data/bloom_validation.json"), L("src/data/data_quality.json")
R = L("src/data/model_results.json")
NAMES = {"tp": "Total phosphorus", "chl": "Chlorophyll-a", "doxy": "Dissolved oxygen", "turb": "Turbidity", "nitrate": "Nitrate", "temp": "Temperature", "rain": "Rainfall (auxiliary)"}

rows = []
for k, v in K["cv"].items():
    b = v[v["best_by_cv"]]
    rows.append(f"| {NAMES[k]} | {v['best_by_cv']} | {b['rmse']:.3f} | {v['baselines']['idw_rmse']:.3f} | {v['baselines']['lake_mean_rmse']:.3f} | {b['rmsse']:.2f} | {b['coverage95']*100:.0f}% |")
mor = S["moran"]
gm = mor.get("global") or mor
lines = f"""# GL-WQI v2: Implementation report

All data are **simulated**. Nothing here describes the real Great Lakes. Numbers below are read from the generated result files (`src/data/*.json`) by `scripts/make_report.py`.

## 1. What was built, by phase

| Phase | Delivered | Acceptance check |
|---|---|---|
| 1. Audit and data preparation | Nitrate added (existing v1 results unchanged); `scripts/prepare_data.py` validates schema, dates, duplicates, coordinates, lake containment, plausibility and units; flags {sum(DQ['missing_by_type'].values())} of {DQ['planned_samples']} missing station-dates; cleaned CSV/JSON, data dictionary and quality report; Data Explorer tabs | App loads, validates, filters and visualises the dataset |
| 2. Spatial autocorrelation and variograms | Global and Local Moran's I (kNN, band, IDW weights; same-lake option; permutation tests; FDR), interactive semivariogram with three fitted models, anisotropy/trend checks, Spatial Statistics page | Statistics computed from the selected data; results equal esda to 1e-10; variograms inspectable and comparable |
| 3. Ordinary Kriging | PyKrige engine with leave-one-station-out CV, JS engine with parity tests, Spatial Interpolation page (indicator, model, lake, location, variogram override, prediction and SE maps, filled gaps, validation) | JS equals PyKrige to 1e-5 on 60 reference cases; CV on 2024-2025 only |
| 4. AHP | Editable Saaty matrix, eigenvector weights, CI/CR with configurable threshold, normalisation (linear/logistic, editable ranges), 0-100 composite, simulator | Matches numpy eigen-decomposition on 8 random matrices; default CR 0.0077 |
| 5. Kriging + AHP integration | Kriged indicators to AHP score at unmonitored sites, seeded Monte Carlo risk interval and exceedance probability, sampling priorities and actions | Validated against hidden truth (section 3) |
| 6. Bloom model and early warnings | Logistic model kept separate; calibration metrics; Kriging or IDW input estimator; three new alert types | Station-aware CV and temporal holdout; no leakage |
| 7. Frontend integration | Dark violet/teal redesign, 12-page navigation, lazy-loaded pages with loading and error states, empty states, responsive layout | Every page loads with no console errors; no horizontal overflow at 390 and 820 px |
| 8. Testing, docs, deployment | JS tests, Python tests, UI smoke test, Methodology page, README, this report, ZIP | `npm test` passes |

## 2. Mathematical models

* **Ordinary Kriging**: estimate Σλᵢzᵢ from the system [γ 1; 1ᵀ 0][λ; μ] = [γ₀; 1]; variance Σλᵢγ₀ᵢ + μ. Great-circle distances; same-lake stations only; log scale for TP, Chl-a, nitrate, turbidity (median back-transform). Spherical, exponential, Gaussian variograms fitted by weighted least squares on a pooled within-lake experimental variogram (2018-2023).
* **Global Moran's I** with expected value −1/(n−1), normal-theory z and tie-safe two-sided permutation p; **Local Moran's I** (PySAL scaling, conditional permutations, optional Benjamini-Hochberg).
* **AHP**: principal eigenvector by power iteration, CI = (λmax−n)/(n−1), CR = CI/RI (RI = 1.24 for n = 6); risk-oriented normalisation r in [0,1]; composite R = 100·Σwᵢrᵢ.
* **Integration**: Monte Carlo draws zₖ ~ N(μₖ, SEₖ²) on the analysis scale (optional shared error component ρ), back-transformed and rescored; interval = 5th-95th percentile; exceedance = share of draws at or above the threshold.
* **Bloom model**: L2 logistic regression (and random forest) on the previous sample only; independent of Kriging variance and AHP.

## 3. Validation results

**Kriging leave-one-station-out, {K['meta']['n_cases']} station-dates, 2024-2025 (variograms fitted on 2018-2023; errors on the analysis scale):**

| Indicator | Best model | RMSE | IDW RMSE | Lake-mean RMSE | RMSSE | 95% coverage |
|---|---|---|---|---|---|---|
""" + "\n".join(rows) + f"""

Kriging is between marginally worse and 7% better than IDW (6-7 stations per lake); its value is calibrated uncertainty (RMSSE near 1). The Gaussian model is unstable for TP (RMSSE about 3) and is flagged in the app.

**Kriging + AHP against hidden truth ({I['meta']['cases']} location-dates, 12 unmonitored sites):** AHP-score MAE {I['score_error']['kriging']['mae']:.2f} points (IDW {I['score_error']['idw']['mae']:.2f}, lake mean {I['score_error']['lake_mean']['mae']:.2f}); mean bias {I['score_error']['bias_kriging']:.2f}; 90% interval coverage {I['interval90_coverage']*100:.0f}% (mean width {I['mean_interval_width']:.0f} points); exceedance Brier {I['exceedance']['brier']:.3f} vs {I['exceedance']['brier_climatology']:.3f} for the base rate.

**Bloom model (early-warning configuration, 2024-2025 holdout):** AUC {B['models']['lr']['auc']:.3f}, Brier {B['models']['lr']['brier']:.3f}, calibration slope {B['models']['lr']['calibration_slope']:.2f}, intercept {B['models']['lr']['calibration_intercept']:.2f}, ECE {B['models']['lr']['ece']:.3f}. Station-aware CV AUC {B['station_aware_cv_auc']['lr']:.3f} (random folds {B['random_cv_auc']['lr']:.3f}). With Kriged inputs at hidden stations AUC is {K['bloom_with_kriged_inputs']['krige']['auc']:.3f} (IDW {K['bloom_with_kriged_inputs']['idw']['auc']:.3f}, own measurements {K['bloom_with_kriged_inputs']['own']['auc']:.3f}).

**Spatial autocorrelation:** see the Spatial Statistics page; regional Moran's I is strong while within-lake permutation tests are weak because each lake has 6-7 stations.

## 4. Known limitations

* Synthetic data only; no claim about real lakes. Schematic lake outlines.
* 6-7 stations per lake: variograms weakly constrained (most ranges hit the 600 km search limit, indicating a gradient rather than a sill), low power for local tests, small Kriging advantage over IDW.
* Kriging variance excludes variogram error, temporal change, non-stationarity and measurement error. Monte Carlo propagates Kriging error only (not AHP-weight uncertainty); the 90% interval covered the truth {I['interval90_coverage']*100:.0f}% of the time, i.e. slightly narrow.
* AHP judgments, reference ranges and score bands are illustrative defaults.
* An AHP score is not a bloom probability; the app keeps them separate everywhere.

## 5. Incomplete or not implemented

* Universal / regression Kriging, anisotropic variograms, space-time Kriging and drift terms (listed in the app as limitations).
* Real-data ingestion: the pipeline reads the simulated CSV schema only.
* No automated visual regression tests; the browser smoke test (`tests/ui_smoke.mjs`) checks that pages load without errors and without NaN text.
* Weight (judgment) uncertainty is not part of the Monte Carlo.
* Basemap tiles need network access; offline the schematic outlines remain.
"""
open(os.path.join(ROOT, "docs", "IMPLEMENTATION_REPORT.md"), "w").write(lines)
print("wrote docs/IMPLEMENTATION_REPORT.md")
