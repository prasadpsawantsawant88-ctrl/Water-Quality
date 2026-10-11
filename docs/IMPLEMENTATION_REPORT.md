# GL-WQI v2: Implementation report

All data are **simulated**. Nothing here describes the real Great Lakes. Numbers below are read from the generated result files (`src/data/*.json`) by `scripts/make_report.py`.

## 1. What was built, by phase

| Phase | Delivered | Acceptance check |
|---|---|---|
| 1. Audit and data preparation | Nitrate added (existing v1 results unchanged); `scripts/prepare_data.py` validates schema, dates, duplicates, coordinates, lake containment, plausibility and units; flags 155 of 6479 missing station-dates; cleaned CSV/JSON, data dictionary and quality report; Data Explorer tabs | App loads, validates, filters and visualises the dataset |
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

**Kriging leave-one-station-out, 1548 station-dates, 2024-2025 (variograms fitted on 2018-2023; errors on the analysis scale):**

| Indicator | Best model | RMSE | IDW RMSE | Lake-mean RMSE | RMSSE | 95% coverage |
|---|---|---|---|---|---|---|
| Total phosphorus | spherical | 0.432 | 0.437 | 0.531 | 0.98 | 95% |
| Chlorophyll-a | gaussian | 0.733 | 0.738 | 0.779 | 1.02 | 94% |
| Dissolved oxygen | gaussian | 0.463 | 0.494 | 0.461 | 1.04 | 94% |
| Turbidity | gaussian | 0.478 | 0.497 | 0.604 | 1.31 | 87% |
| Nitrate | spherical | 0.222 | 0.220 | 0.264 | 0.95 | 94% |
| Temperature | gaussian | 1.047 | 1.077 | 1.075 | 1.06 | 92% |
| Rainfall (auxiliary) | spherical | 0.283 | 0.303 | 0.283 | 0.97 | 96% |

Kriging is between marginally worse and 7% better than IDW (6-7 stations per lake); its value is calibrated uncertainty (RMSSE near 1). The Gaussian model is unstable for TP (RMSSE about 3) and is flagged in the app.

**Kriging + AHP against hidden truth (624 location-dates, 12 unmonitored sites):** AHP-score MAE 4.46 points (IDW 4.94, lake mean 8.13); mean bias -1.22; 90% interval coverage 84% (mean width 15 points); exceedance Brier 0.034 vs 0.097 for the base rate.

**Bloom model (early-warning configuration, 2024-2025 holdout):** AUC 0.916, Brier 0.063, calibration slope 1.13, intercept -0.07, ECE 0.028. Station-aware CV AUC 0.876 (random folds 0.895). With Kriged inputs at hidden stations AUC is 0.874 (IDW 0.873, own measurements 0.914).

**Spatial autocorrelation:** see the Spatial Statistics page; regional Moran's I is strong while within-lake permutation tests are weak because each lake has 6-7 stations.

## 4. Known limitations

* Synthetic data only; no claim about real lakes. Schematic lake outlines.
* 6-7 stations per lake: variograms weakly constrained (most ranges hit the 600 km search limit, indicating a gradient rather than a sill), low power for local tests, small Kriging advantage over IDW.
* Kriging variance excludes variogram error, temporal change, non-stationarity and measurement error. Monte Carlo propagates Kriging error only (not AHP-weight uncertainty); the 90% interval covered the truth 84% of the time, i.e. slightly narrow.
* AHP judgments, reference ranges and score bands are illustrative defaults.
* An AHP score is not a bloom probability; the app keeps them separate everywhere.

## 5. Incomplete or not implemented

* Universal / regression Kriging, anisotropic variograms, space-time Kriging and drift terms (listed in the app as limitations).
* Real-data ingestion: the pipeline reads the simulated CSV schema only.
* No automated visual regression tests; the browser smoke test (`tests/ui_smoke.mjs`) checks that pages load without errors and without NaN text.
* Weight (judgment) uncertainty is not part of the Monte Carlo.
* Basemap tiles need network access; offline the schematic outlines remain.
