"""
GL-WQI Phase 3: Ordinary Kriging engine (PyKrige) with leave-one-station-out cross-validation.

Variograms come from scripts/spatial_stats.py (fitted on 2018-2023). Kriging is validated on 2024-2025: for every
station and date, that station is hidden and re-estimated from the other stations ON THE SAME LAKE sampled that day.
Distances are great-circle (PyKrige geographic mode, ranges converted from km to degrees of arc).

Writes:  src/data/kriging_results.json            (parameters, validation metrics, bloom check)
         public/data/kriging_cv_cases.json         (every cross-validation case, loaded lazily by the app)
         public/data/estimated_missing_values.csv  (Kriging estimates for missing samples, flagged ESTIMATED_KRIGING)
         tests/fixtures/kriging_fixtures.json      (PyKrige reference cases for the JavaScript parity test)
All data are simulated.

Run:  python3 scripts/kriging_engine.py
"""
import json
import math
import os
import time
import warnings

import numpy as np
import pandas as pd
from pykrige.ok import OrdinaryKriging
from sklearn.metrics import brier_score_loss, roc_auc_score

from spatial_common import *

warnings.filterwarnings("ignore")
FIX = os.path.join(ROOT, "tests", "fixtures")
os.makedirs(FIX, exist_ok=True)

obs, stations, dates, lakes = load_all()
mon = [s for s in stations if s["monitored"]]
ids = [s["id"] for s in mon]
lake_of = np.array([s["lake"] for s in mon])
lat = np.array([s["lat"] for s in mon])
lon = np.array([s["lon"] for s in mon])
spatial = json.load(open(os.path.join(SRC, "spatial_stats.json")))
model_results = json.load(open(os.path.join(SRC, "model_results.json")))
test_rows = np.where(dates >= pd.Timestamp("2024-01-01"))[0]
fallbacks = {"n": 0}


def pk_predict(model, par, lons, lats, z, tlon, tlat):
    """One Ordinary Kriging prediction with PyKrige. Returns (estimate, kriging variance)."""
    kw = dict(variogram_model=model, variogram_parameters={"sill": par["sill"], "range": par["range"] / KM_PER_DEGREE, "nugget": par["nugget"]},
              coordinates_type="geographic", verbose=False, enable_plotting=False)
    try:
        ok = OrdinaryKriging(lons, lats, z, **kw)
        zh, ss = ok.execute("points", np.array([tlon]), np.array([tlat]))
    except Exception:  # singular system (nearly duplicate stations with a Gaussian model): use the pseudo-inverse
        fallbacks["n"] += 1
        ok = OrdinaryKriging(lons, lats, z, pseudo_inv=True, **kw)
        zh, ss = ok.execute("points", np.array([tlon]), np.array([tlat]))
    return float(zh[0]), float(max(ss[0], 0.0))


def idw_predict(d, z, power=2.0):
    w = 1.0 / (d + 1.0) ** power
    return float((w * z).sum() / w.sum())


# ---------------------------------------------------------------------------
# 1. Leave-one-station-out cross-validation
# ---------------------------------------------------------------------------
cases = []  # shared case list so every indicator/model lines up
cubes = {k: forward(build_cube(obs, m["col"], ids, dates), m["transform"]) for k, m in INDICATORS.items()}
for t in test_rows:
    for s in range(len(mon)):
        nb = [j for j in range(len(mon)) if j != s and lake_of[j] == lake_of[s] and all(not np.isnan(cubes[k][t, j]) for k in INDICATORS)]
        if len(nb) >= 3 and all(not np.isnan(cubes[k][t, s]) for k in INDICATORS):
            cases.append((int(t), s, nb))
print(f"{len(cases)} cross-validation cases (station x date, 2024-2025)")

cv = {}
cv_arrays = {"station": [c[1] for c in cases], "date": [c[0] for c in cases]}
t0 = time.time()
for key, meta in INDICATORS.items():
    cv[key] = {}
    Z = cubes[key]
    truth = np.array([Z[t, s] for t, s, _ in cases])
    # reference predictors on the same cases
    idw = np.array([idw_predict(haversine_km(lat[s], lon[s], lat[nb], lon[nb]), Z[t, nb]) for t, s, nb in cases])
    lake_mean = np.array([Z[t, nb].mean() for t, s, nb in cases])
    for model in MODELS:
        par = spatial["variograms"][key]["fits"][model]
        pred = np.zeros(len(cases))
        var = np.zeros(len(cases))
        for c, (t, s, nb) in enumerate(cases):
            pred[c], var[c] = pk_predict(model, par, lon[nb], lat[nb], Z[t, nb], lon[s], lat[s])
        err = truth - pred
        se = np.sqrt(var)
        std = err / np.where(se > 0, se, np.nan)
        inv_t, inv_p = inverse(truth, meta["transform"]), inverse(pred, meta["transform"])
        per_lake = {lk: float(math.sqrt(np.mean(err[[lake_of[s] == lk for _, s, _ in cases]] ** 2))) for lk in np.unique(lake_of)}
        entry = {
            "n": len(cases), "me": float(err.mean() * -1), "mae": float(np.abs(err).mean()), "rmse": float(math.sqrt((err ** 2).mean())),
            "mean_std_error": float(np.nanmean(std)), "rmsse": float(math.sqrt(np.nanmean(std ** 2))),
            "coverage95": float(np.mean(np.abs(err) <= 1.96 * se)), "mean_se": float(se.mean()),
            "orig": {"me": float((inv_p - inv_t).mean()), "mae": float(np.abs(inv_p - inv_t).mean()), "rmse": float(math.sqrt(((inv_p - inv_t) ** 2).mean()))},
            "per_lake_rmse": per_lake, "params": {k2: par[k2] for k2 in ("nugget", "psill", "range", "sill")},
        }
        cv[key][model] = entry
        cv_arrays[f"{key}|{model}"] = {"p": [round(float(v), 4) for v in pred], "se": [round(float(v), 4) for v in se]}
    ref_idw = float(math.sqrt(np.mean((truth - idw) ** 2)))
    ref_mean = float(math.sqrt(np.mean((truth - lake_mean) ** 2)))
    cv[key]["baselines"] = {"idw_rmse": ref_idw, "lake_mean_rmse": ref_mean, "idw_mae": float(np.abs(truth - idw).mean()), "lake_mean_mae": float(np.abs(truth - lake_mean).mean())}
    cv_arrays[f"{key}|truth"] = [round(float(v), 4) for v in truth]
    best = min(MODELS, key=lambda m: cv[key][m]["rmse"])
    cv[key]["best_by_cv"] = best
    b = cv[key][best]
    print(f"{key:8} best={best:11} RMSE={b['rmse']:.3f} (IDW {ref_idw:.3f}, lake mean {ref_mean:.3f}) skill vs IDW={1 - b['rmse'] / ref_idw:+.2f}  "
          f"RMSSE={b['rmsse']:.2f} cov95={b['coverage95']:.2f} | all: " + ", ".join(f"{m[:3]} {cv[key][m]['rmse']:.3f}" for m in MODELS))
print(f"cross-validation took {time.time() - t0:.0f}s, {fallbacks['n']} pseudo-inverse fallbacks")
best_model = {k: cv[k]["best_by_cv"] for k in INDICATORS}

# ---------------------------------------------------------------------------
# 2. Fill missing samples with flagged estimates
# ---------------------------------------------------------------------------
missing = pd.read_csv(os.path.join(PUB, "missing_observations.csv"), parse_dates=["Observation_Date"])
rows = []
n_est = 0
for _, m in missing.iterrows():
    s = ids.index(m["Station_ID"])
    t = int(np.where(dates == m["Observation_Date"])[0][0])
    nb = [j for j in range(len(mon)) if j != s and lake_of[j] == lake_of[s] and all(not np.isnan(cubes[k][t, j]) for k in INDICATORS)]
    if len(nb) < 3:
        continue
    n_est += 1
    for key, meta in INDICATORS.items():
        mdl = best_model[key]
        par = spatial["variograms"][key]["fits"][mdl]
        mu, var = pk_predict(mdl, par, lon[nb], lat[nb], cubes[key][t, nb], lon[s], lat[s])
        sd = math.sqrt(var)
        rows.append({"Station_ID": m["Station_ID"], "Lake_Name": m["Lake_Name"], "Observation_Date": m["Observation_Date"].strftime("%Y-%m-%d"), "Gap_Type": m["Gap_Type"],
                     "Indicator": meta["col"], "Estimate": round(float(inverse(mu, meta["transform"])), 4), "Unit": meta["unit"],
                     "Lower95": round(float(inverse(mu - 1.96 * sd, meta["transform"])), 4), "Upper95": round(float(inverse(mu + 1.96 * sd, meta["transform"])), 4),
                     "SE_analysis_scale": round(sd, 4), "Variogram": mdl, "Stations_Used": len(nb), "Data_Status": "ESTIMATED_KRIGING"})
pd.DataFrame(rows).to_csv(os.path.join(PUB, "estimated_missing_values.csv"), index=False)
print(f"estimated {n_est} of {len(missing)} missing samples ({len(rows)} indicator values); the rest had fewer than 3 same-lake stations that day")

# ---------------------------------------------------------------------------
# 3. Does the bloom model still work when its inputs are Kriged instead of measured?
# ---------------------------------------------------------------------------
lrm = model_results["models"]["early"]["lr"]
feat = lrm["features"]


def lr_prob(tp, chl, temp, rain, doxy, season):
    vals = {"lnTP": math.log(tp), "lnChl": math.log(chl), "Temp": temp, "Rain": rain, "Rain2": rain ** 2, "DO": doxy,
            "Spring": float(season == "Spring"), "Summer": float(season == "Summer"), "Autumn": float(season == "Autumn")}
    z = lrm["intercept_std"] + sum(c * (vals[f] - mu) / sd for f, c, mu, sd in zip(feat, lrm["coef_std"], lrm["mu"], lrm["sd"]))
    return 1 / (1 + math.exp(-z))


SEASON = {12: "Winter", 1: "Winter", 2: "Winter", 3: "Spring", 4: "Spring", 5: "Spring", 6: "Summer", 7: "Summer", 8: "Summer", 9: "Autumn", 10: "Autumn", 11: "Autumn"}
bloom_cube = build_cube(obs, "Bloom_Observed", ids, dates)
raw_cubes = {k: build_cube(obs, m["col"], ids, dates) for k, m in INDICATORS.items()}
recs = []
for t, s, nb in cases:
    if t + 1 >= len(dates) or np.isnan(bloom_cube[t + 1, s]):
        continue
    season = SEASON[dates[t + 1].month]
    inp = {}
    for method in ("krige", "idw", "lake_mean", "own"):
        vals = {}
        for key in ("tp", "chl", "temp", "rain", "doxy"):
            meta = INDICATORS[key]
            Z = cubes[key]
            if method == "krige":
                mdl = best_model[key]
                mu, _ = pk_predict(mdl, spatial["variograms"][key]["fits"][mdl], lon[nb], lat[nb], Z[t, nb], lon[s], lat[s])
            elif method == "idw":
                mu = idw_predict(haversine_km(lat[s], lon[s], lat[nb], lon[nb]), Z[t, nb])
            elif method == "lake_mean":
                mu = float(Z[t, nb].mean())
            else:
                mu = Z[t, s]
            vals[key] = float(inverse(mu, meta["transform"]))
        inp[method] = lr_prob(vals["tp"], vals["chl"], vals["temp"], vals["rain"], vals["doxy"], season)
    recs.append({"y": int(bloom_cube[t + 1, s]), **inp})
bv = pd.DataFrame(recs)
bloom_check = {"n_cases": int(len(bv)), "bloom_rate": float(bv["y"].mean())}
for method in ("krige", "idw", "lake_mean", "own"):
    bloom_check[method] = {"auc": float(roc_auc_score(bv["y"], bv[method])), "brier": float(brier_score_loss(bv["y"], bv[method]))}
print("bloom model with hidden-station inputs (AUC):", {m: round(bloom_check[m]["auc"], 3) for m in ("krige", "idw", "lake_mean", "own")})

# ---------------------------------------------------------------------------
# 4. Reference cases for the JavaScript parity test (PyKrige is the ground truth)
# ---------------------------------------------------------------------------
rng = np.random.default_rng(5)
fx = []
for key in ("tp", "chl", "temp", "doxy", "nitrate"):
    for model in MODELS:
        for _ in range(4):
            t, s, nb = cases[int(rng.integers(len(cases)))]
            par = spatial["variograms"][key]["fits"][model]
            zh, ss = pk_predict(model, par, lon[nb], lat[nb], cubes[key][t, nb], lon[s], lat[s])
            fx.append({"indicator": key, "model": model, "params": {k2: par[k2] for k2 in ("nugget", "psill", "range")},
                       "stations": [{"lat": float(lat[j]), "lon": float(lon[j]), "z": float(cubes[key][t, j])} for j in nb],
                       "target": {"lat": float(lat[s]), "lon": float(lon[s])}, "estimate": zh, "variance": ss})
json.dump(fx, open(os.path.join(FIX, "kriging_fixtures.json"), "w"))

# ---------------------------------------------------------------------------
# 5. Outputs
# ---------------------------------------------------------------------------
default_params = {k: {m: {x: spatial["variograms"][k]["fits"][m][x] for x in ("nugget", "psill", "range", "sill")} for m in MODELS} for k in INDICATORS}
out = {
    "meta": {"simulated": True, "engine": "PyKrige OrdinaryKriging, geographic (great-circle) distances", "validation": "leave-one-station-out, same-lake neighbours, 2024-2025 dates",
             "variogram_fit_period": spatial["meta"]["variogram_period"], "n_cases": len(cases), "pykrige_pseudo_inverse_fallbacks": fallbacks["n"],
             "note": "Kriging variance covers only the spatial prediction under the fitted variogram. It excludes variogram estimation error, temporal mismatch and non-stationarity."},
    "default_params": default_params, "best_by_cv": best_model, "cv": cv, "bloom_with_kriged_inputs": bloom_check,
    "missing_estimates": {"missing_samples": int(len(missing)), "estimated_samples": n_est, "indicator_values": len(rows)},
}
json.dump(out, open(os.path.join(SRC, "kriging_results.json"), "w"), separators=(",", ":"))
json.dump({"station_ids": ids, "dates": [d.strftime("%Y-%m-%d") for d in dates], "cases": cv_arrays}, open(os.path.join(PUB, "kriging_cv_cases.json"), "w"), separators=(",", ":"))
print("wrote kriging_results.json", os.path.getsize(os.path.join(SRC, "kriging_results.json")) // 1024, "KB; cv cases", os.path.getsize(os.path.join(PUB, "kriging_cv_cases.json")) // 1024, "KB")
