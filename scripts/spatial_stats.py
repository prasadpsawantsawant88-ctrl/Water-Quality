"""
GL-WQI Phase 2: spatial autocorrelation and variogram analysis.

Writes src/data/spatial_stats.json (read by the app) and tests/fixtures/*.json (used by the JS parity tests).
Variograms are fitted on the TRAINING period (2018-2023) only; Kriging is validated on 2024-2025 in Phase 3.
All data are simulated.

Run:  python3 scripts/spatial_stats.py
"""
import json
import math
import os
import warnings

import esda
import libpysal
import numpy as np
import pandas as pd
from scipy import stats as sps

from spatial_common import *

warnings.filterwarnings("ignore")
FIX = os.path.join(ROOT, "tests", "fixtures")
os.makedirs(FIX, exist_ok=True)

TRAIN_END = pd.Timestamp("2023-12-31")
RUN_DATE = pd.Timestamp("2025-09-02")  # the app's default analysis date
STALE_DAYS = 45
PERMS = 999

obs, stations, dates, lakes = load_all()
mon = [s for s in stations if s["monitored"]]
ids = [s["id"] for s in mon]
lake_of = np.array([s["lake"] for s in mon])
train_rows = np.where(dates <= TRAIN_END)[0]
pairs = lake_pairs(stations)
run_idx = int(np.where(dates == RUN_DATE)[0][0])


def snapshot(Z, t, max_age_steps=3):
    """Latest value per station at or before row t, ignoring samples older than ~45 days (as the app does)."""
    out = np.full(Z.shape[1], np.nan)
    for j in range(Z.shape[1]):
        for back in range(0, max_age_steps + 1):
            if t - back >= 0 and not np.isnan(Z[t - back, j]):
                if (dates[t] - dates[t - back]).days <= STALE_DAYS:
                    out[j] = Z[t - back, j]
                break
    return out


def esda_weights(neigh, wts):
    return libpysal.weights.W({i: list(neigh[i]) for i in range(len(neigh))}, {i: list(wts[i]) for i in range(len(neigh))}, silence_warnings=True)


# ---------------------------------------------------------------------------
# 1. Variograms, anisotropy, trend
# ---------------------------------------------------------------------------
def directional(Z, direction, tol=22.5, lag=DEFAULT_LAG_KM, cutoff=DEFAULT_CUTOFF_KM):
    """Mean semivariance and pair count for pairs whose bearing is within +-tol of `direction` (0 = east-west, 90 = north-south)."""
    sel = []
    for a, b, d, _ in pairs:
        if d > cutoff:
            continue
        lat0 = math.radians((mon[a]["lat"] + mon[b]["lat"]) / 2)
        dx = R_EARTH * math.cos(lat0) * math.radians(mon[b]["lon"] - mon[a]["lon"])
        dy = R_EARTH * math.radians(mon[b]["lat"] - mon[a]["lat"])
        ang = math.degrees(math.atan2(dy, dx)) % 180.0
        diff = min(abs(ang - direction), 180 - abs(ang - direction))
        if diff <= tol:
            sel.append((a, b))
    if not sel:
        return {"direction": direction, "n_pairs": 0, "mean_gamma": None}
    vals = []
    for a, b in sel:
        sv = 0.5 * (Z[train_rows, a] - Z[train_rows, b]) ** 2
        vals.append(np.nanmean(sv))
    return {"direction": direction, "n_pairs": len(sel), "mean_gamma": float(np.mean(vals))}


def trend_test(Z):
    """Do station means (lake-centred) change linearly with east/north position inside lakes?  Pooled regression."""
    zbar = np.nanmean(Z[train_rows], axis=0)
    xs, ys, zs = [], [], []
    for lake in np.unique(lake_of):
        idx = np.where(lake_of == lake)[0]
        lon = np.array([mon[i]["lon"] for i in idx]); lat = np.array([mon[i]["lat"] for i in idx])
        x = R_EARTH * np.cos(np.radians(lat.mean())) * np.radians(lon - lon.mean()) / 100.0
        y = R_EARTH * np.radians(lat - lat.mean()) / 100.0
        xs += list(x); ys += list(y); zs += list(zbar[idx] - zbar[idx].mean())
    X = np.column_stack([np.ones(len(zs)), xs, ys]); zs = np.array(zs)
    beta, res, *_ = np.linalg.lstsq(X, zs, rcond=None)
    fitted = X @ beta
    ss_res = ((zs - fitted) ** 2).sum(); ss_tot = (zs ** 2).sum()
    r2 = 1 - ss_res / ss_tot
    df1, df2 = 2, len(zs) - 3 - len(np.unique(lake_of)) + 1
    f = (r2 / df1) / ((1 - r2) / max(df2, 1))
    return {"slope_east_per_100km": float(beta[1]), "slope_north_per_100km": float(beta[2]), "r2": float(r2), "f_p_value": float(1 - sps.f.cdf(f, df1, max(df2, 1)))}


variograms = {}
Z_all = {}
for key, meta in INDICATORS.items():
    Z = forward(build_cube(obs, meta["col"], ids, dates), meta["transform"])
    Z_all[key] = Z
    bins = experimental_variogram(Z, pairs, rows=train_rows)
    fits = fit_all_models(bins)
    for f in fits.values():
        f["range_at_limit"] = bool(f["range"] >= RANGE_GRID[-1] - 1e-9)
        f["sill_ratio_nugget"] = f["nugget"] / f["sill"] if f["sill"] > 0 else None
    best = min(fits.values(), key=lambda f: f["wrss"])["model"]
    dirs = [directional(Z, d) for d in (0, 45, 90, 135)]
    g = [d["mean_gamma"] for d in dirs if d["mean_gamma"] is not None]
    variograms[key] = {
        "label": meta["label"], "unit": meta["unit"], "transform": meta["transform"], "bins": bins, "fits": fits, "best_by_fit": best,
        "directional": dirs, "anisotropy_ratio": float(max(g) / min(g)) if g and min(g) > 0 else None, "trend": trend_test(Z),
        "total_variance_train": float(np.nanvar(Z[train_rows])),
    }
    f = fits[best]
    print(f"{key:8} best={best:11} nugget={f['nugget']:.3f} psill={f['psill']:.3f} range={f['range']:.0f}{'*' if f['range_at_limit'] else ' '} "
          f"aniso={variograms[key]['anisotropy_ratio']:.2f} trend R2={variograms[key]['trend']['r2']:.2f} p={variograms[key]['trend']['f_p_value']:.3f}")

# ---------------------------------------------------------------------------
# 2. Moran's I
# ---------------------------------------------------------------------------
DEFAULT_W = {"kind": "knn", "k": 4, "band_km": 120.0, "power": 1.0, "same_lake": True, "standardize": True}
_, neigh, wts = build_weights(stations, **DEFAULT_W)
W = weights_matrix(neigh, wts)
wesda = esda_weights(neigh, wts)
n_islands = sum(1 for nb in neigh if not nb)

moran = {}
fixtures_moran = []
for key, meta in INDICATORS.items():
    Z = Z_all[key]
    entry = {}
    for label, z in (("snapshot", snapshot(Z, run_idx)), ("station_mean", np.nanmean(Z, axis=0))):
        ok = ~np.isnan(z)
        if not ok.all():  # drop stations with no data at this date, rebuild weights on the remaining ones
            keep_ids = {mon[i]["id"] for i in np.where(ok)[0]}
            sub_all = [s for s in stations if (not s["monitored"]) or s["id"] in keep_ids]
            _, nb2, w2 = build_weights(sub_all, **DEFAULT_W)
            W2 = weights_matrix(nb2, w2)
            zz, grp = z[ok], lake_of[ok]
        else:
            W2, zz, grp, nb2, w2 = W, z, lake_of, neigh, wts
        res = {s: global_moran(zz, W2, grp, PERMS, s_name, seed=11) for s, s_name in (("all", "all"), ("within_lake", "within_lake"))}
        chk = esda.Moran(zz, esda_weights(nb2, w2), transformation="o", permutations=0)
        res["esda_check"] = {"I": float(chk.I), "expected": float(chk.EI), "z_norm": float(chk.z_norm), "p_norm": float(chk.p_norm)}
        entry[label] = res
        if label == "snapshot":
            loc = esda.Moran_Local(zz, esda_weights(nb2, w2), transformation="o", permutations=0)
            names = [mon[i]["id"] for i in np.where(ok)[0]]
            for scheme, field in (("within_lake", "local"), ("all", "local_all")):
                Ii, p, quad, lag, zc = local_moran(zz, W2, grp, PERMS, scheme, seed=21)
                sig = benjamini_hochberg(p)
                entry[field] = [{"station": names[i], "I": float(Ii[i]), "p": float(p[i]), "quadrant": str(quad[i]), "z": float(zc[i]), "lag": float(lag[i]),
                                 "sig05": bool(p[i] < 0.05), "sig_fdr": bool(sig[i])} for i in range(len(names))]
            entry["local_esda_max_abs_diff"] = float(np.abs(Ii - loc.Is).max())
            if key in ("tp", "temp"):
                fixtures_moran.append({"indicator": key, "stations": names, "z": [float(v) for v in zz], "groups": [str(g) for g in grp],
                                       "neighbors": nb2, "weights": w2, "I": float(chk.I), "expected": float(chk.EI), "z_norm": float(chk.z_norm),
                                       "local_I": [float(v) for v in loc.Is], "local_quadrant_esda": [int(q) for q in loc.q]})
    moran[key] = entry
    s = entry["snapshot"]
    print(f"{key:8} snapshot I={s['all']['I']:.3f} (esda {s['esda_check']['I']:.3f}) z_norm={s['all']['z_norm']:.2f}  p_all={s['all']['p_perm_two_sided']:.3f}  p_within={s['within_lake']['p_perm_two_sided']:.3f}  "
          f"local sig(p<.05) within-lake={sum(l['sig05'] for l in entry['local'])} all={sum(l['sig05'] for l in entry['local_all'])} FDR all={sum(l['sig_fdr'] for l in entry['local_all'])}  max|dI_local vs esda|={entry['local_esda_max_abs_diff']:.1e}")

# sensitivity of Moran's I to the weights definition
sens = []
z_tp = np.nanmean(Z_all["tp"], axis=0)
for cfg in [dict(kind="knn", k=3), dict(kind="knn", k=4), dict(kind="knn", k=5), dict(kind="knn", k=6), dict(kind="band", band_km=100.0),
            dict(kind="band", band_km=150.0), dict(kind="band", band_km=200.0), dict(kind="idw", band_km=200.0, power=1.0), dict(kind="knn", k=4, same_lake=False)]:
    c = {**DEFAULT_W, **cfg}
    _, nb, wt = build_weights(stations, **c)
    Wc = weights_matrix(nb, wt)
    r = global_moran(z_tp, Wc, lake_of, 499, "within_lake", seed=5)
    sens.append({"weights": cfg, "I": r["I"], "z_norm": r["z_norm"], "p_within_lake": r["p_perm_two_sided"], "islands": sum(1 for x in nb if not x)})

out = {
    "meta": {"simulated": True, "variogram_period": ["2018-01-02", "2023-12-31"], "lag_km": DEFAULT_LAG_KM, "cutoff_km": DEFAULT_CUTOFF_KM, "range_search_limit_km": float(RANGE_GRID[-1]),
             "n_station_pairs": len(pairs), "pair_distance_km": [min(p[2] for p in pairs), max(p[2] for p in pairs)], "fit_weights": "number of distinct station pairs per lag bin",
             "run_date": str(RUN_DATE.date()), "permutations": PERMS, "default_weights": DEFAULT_W, "islands_in_default_weights": n_islands,
             "note": "Pairs are formed only between stations on the same lake. Values are on the analysis scale (log for skewed concentrations)."},
    "variograms": variograms, "moran": moran, "weights_sensitivity_tp_station_mean": sens,
}
with open(os.path.join(SRC, "spatial_stats.json"), "w") as f:
    json.dump(out, f, separators=(",", ":"))
with open(os.path.join(FIX, "moran_fixtures.json"), "w") as f:
    json.dump(fixtures_moran, f)
vf = []
for key in ("tp", "doxy"):
    vf.append({"indicator": key, "lag": DEFAULT_LAG_KM, "cutoff": DEFAULT_CUTOFF_KM, "bins": variograms[key]["bins"], "fits": variograms[key]["fits"]})
with open(os.path.join(FIX, "variogram_fixtures.json"), "w") as f:
    json.dump(vf, f)
print("wrote src/data/spatial_stats.json", os.path.getsize(os.path.join(SRC, "spatial_stats.json")) // 1024, "KB")
