"""
Shared spatial-statistics code for GL-WQI (Phases 2 and 3).

Everything here is deliberately flat and readable. The same algorithms are re-implemented in JavaScript
(src/lib/*.js) so the browser can recompute interactively; scripts/*test* check the two agree.

Conventions
- Distances are great-circle (haversine, sphere radius 6371 km). Variogram ranges are in km.
- Interpolation and spatial weights never cross lakes: only same-lake stations are paired or neighbours.
- Skewed concentrations are analysed on the log scale; temperature and dissolved oxygen are analysed as-is.
"""
import json
import math
import os

import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, "public", "data")
SRC = os.path.join(ROOT, "src", "data")
RAW = os.path.join(ROOT, "data", "raw")
R_EARTH = 6371.0
KM_PER_DEGREE = R_EARTH * math.pi / 180.0  # PyKrige geographic mode measures distance in degrees of arc

# key, observation column, transform, unit, label, include in AHP, kriged
INDICATORS = {
    "tp": {"col": "Total_Phosphorus", "transform": "log", "unit": "ug/L", "label": "Total phosphorus"},
    "chl": {"col": "Chlorophyll_a", "transform": "log", "unit": "ug/L", "label": "Chlorophyll-a"},
    "doxy": {"col": "Dissolved_Oxygen", "transform": "none", "unit": "mg/L", "label": "Dissolved oxygen"},
    "turb": {"col": "Turbidity", "transform": "log", "unit": "NTU", "label": "Turbidity"},
    "nitrate": {"col": "Nitrate", "transform": "log", "unit": "mg/L as N", "label": "Nitrate + nitrite"},
    "temp": {"col": "Water_Temperature", "transform": "none", "unit": "degC", "label": "Water temperature"},
    "rain": {"col": "Rainfall", "transform": "log1p", "unit": "mm", "label": "Recent rainfall (auxiliary input)"},
}
MODELS = ["spherical", "exponential", "gaussian"]
DEFAULT_LAG_KM = 30.0
DEFAULT_CUTOFF_KM = 300.0


def haversine_km(lat1, lon1, lat2, lon2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dphi = p2 - p1
    dl = np.radians(lon2) - np.radians(lon1)
    a = np.sin(dphi / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * R_EARTH * np.arcsin(np.sqrt(a))


def forward(x, kind):
    if kind == "log":
        return np.log(x)
    if kind == "log1p":
        return np.log1p(x)
    return np.asarray(x, dtype=float)


def inverse(x, kind):
    if kind == "log":
        return np.exp(x)
    if kind == "log1p":
        return np.expm1(x)
    return np.asarray(x, dtype=float)


# ---------------------------------------------------------------------------
# data loading
# ---------------------------------------------------------------------------
def load_all():
    obs = pd.read_csv(os.path.join(PUB, "observations.csv"), parse_dates=["Observation_Date"])
    stations = json.load(open(os.path.join(SRC, "stations.json")))
    dates = pd.to_datetime(json.load(open(os.path.join(SRC, "dates.json"))))
    lakes = json.load(open(os.path.join(SRC, "lakes.json")))
    return obs, stations, dates, lakes


def build_cube(obs, col, station_ids, dates):
    """Array [n_dates, n_stations] of raw values, NaN where a station has no sample on that date."""
    wide = obs.pivot(index="Observation_Date", columns="Station_ID", values=col)
    return wide.reindex(index=dates, columns=station_ids).values.astype(float)


# ---------------------------------------------------------------------------
# variogram models (identical definitions to PyKrige; psill = sill - nugget, range in km)
# ---------------------------------------------------------------------------
def variogram_model(name, h, psill, rng, nugget):
    h = np.asarray(h, dtype=float)
    if name == "spherical":
        g = np.where(h <= rng, psill * (1.5 * h / rng - 0.5 * (h / rng) ** 3) + nugget, psill + nugget)
    elif name == "exponential":
        g = psill * (1.0 - np.exp(-h / (rng / 3.0))) + nugget
    elif name == "gaussian":
        g = psill * (1.0 - np.exp(-(h ** 2) / (rng * 4.0 / 7.0) ** 2)) + nugget
    else:
        raise ValueError(name)
    return g


def shape(name, h, rng):
    """Model with unit partial sill and zero nugget."""
    return variogram_model(name, h, 1.0, rng, 0.0)


RANGE_GRID = np.arange(10.0, 602.0, 2.0)


def fit_variogram(name, h, gamma, weights, range_grid=RANGE_GRID):
    """Weighted least squares. For each candidate range the nugget and partial sill are linear, so they are solved
    exactly (non-negative); the range with the smallest weighted residual wins. Same algorithm as src/lib/variogram.js."""
    h, gamma, w = (np.asarray(a, dtype=float) for a in (h, gamma, weights))
    best = None
    for r in range_grid:
        phi = shape(name, h, r)
        sw, swp, swpp = w.sum(), (w * phi).sum(), (w * phi * phi).sum()
        swg, swpg = (w * gamma).sum(), (w * phi * gamma).sum()
        det = sw * swpp - swp * swp
        if abs(det) < 1e-12:
            continue
        nug = (swpp * swg - swp * swpg) / det
        ps = (sw * swpg - swp * swg) / det
        if nug < 0:
            nug = 0.0
            ps = swpg / swpp if swpp > 0 else 0.0
        if ps < 0:
            ps = 0.0
            nug = swg / sw
        wrss = float((w * (gamma - (nug + ps * phi)) ** 2).sum())
        if best is None or wrss < best["wrss"] - 1e-15:
            best = {"model": name, "nugget": float(nug), "psill": float(ps), "range": float(r), "wrss": wrss}
    best["sill"] = best["nugget"] + best["psill"]
    best["rmse"] = math.sqrt(best["wrss"] / w.sum())
    return best


# ---------------------------------------------------------------------------
# experimental variogram, pooled over snapshots, within lakes only
# ---------------------------------------------------------------------------
def lake_pairs(stations, only_lake=None):
    mon = [s for s in stations if s["monitored"]]
    pairs = []
    for a in range(len(mon)):
        for b in range(a + 1, len(mon)):
            if mon[a]["lake"] != mon[b]["lake"]:
                continue  # never pair stations on different lakes
            if only_lake and mon[a]["lake"] != only_lake:
                continue
            d = float(haversine_km(mon[a]["lat"], mon[a]["lon"], mon[b]["lat"], mon[b]["lon"]))
            pairs.append((a, b, d, mon[a]["lake"]))
    return pairs


def experimental_variogram(Z, pairs, lag=DEFAULT_LAG_KM, cutoff=DEFAULT_CUTOFF_KM, rows=None):
    """Z: [n_dates, n_stations] on the analysis scale. Semivariance = mean of 0.5*(zi-zj)^2 over the pairs in a
    distance bin and over all dates in `rows`. Weight for fitting = number of DISTINCT station pairs, because
    repeating the same pairs on many dates reduces noise but adds no new spatial information."""
    Zs = Z if rows is None else Z[rows]
    nb = int(math.ceil(cutoff / lag))
    out = []
    for k in range(nb):
        lo, hi = k * lag, (k + 1) * lag
        sel = [(a, b, d) for a, b, d, _ in pairs if lo < d <= hi and d <= cutoff]
        if not sel:
            continue
        sv_sum, sv_n = 0.0, 0
        for a, b, d in sel:
            diff = 0.5 * (Zs[:, a] - Zs[:, b]) ** 2
            ok = ~np.isnan(diff)
            sv_sum += diff[ok].sum()
            sv_n += int(ok.sum())
        if sv_n == 0:
            continue
        out.append({"h": float(np.mean([d for _, _, d in sel])), "gamma": sv_sum / sv_n, "n_pairs": len(sel), "n_obs": sv_n})
    return out


def fit_all_models(bins):
    h = [b["h"] for b in bins]
    g = [b["gamma"] for b in bins]
    w = [b["n_pairs"] for b in bins]
    return {m: fit_variogram(m, h, g, w) for m in MODELS}


# ---------------------------------------------------------------------------
# spatial weights (always within a lake unless same_lake=False) and Moran's I
# ---------------------------------------------------------------------------
def build_weights(stations, kind="knn", k=4, band_km=120.0, power=1.0, same_lake=True, standardize=True):
    """Returns (ids, neighbours, weights) where neighbours[i] lists station indices and weights[i] their weights.
    kind: 'knn' (k nearest, asymmetric), 'band' (all within band_km, binary), 'idw' (within band_km, 1/d^power)."""
    mon = [s for s in stations if s["monitored"]]
    n = len(mon)
    D = np.zeros((n, n))
    for i in range(n):
        for j in range(n):
            D[i, j] = haversine_km(mon[i]["lat"], mon[i]["lon"], mon[j]["lat"], mon[j]["lon"])
    neigh, wts = [], []
    for i in range(n):
        cand = [j for j in range(n) if j != i and (not same_lake or mon[j]["lake"] == mon[i]["lake"])]
        cand.sort(key=lambda j: (D[i, j], j))
        if kind == "knn":
            cand = cand[:k]
        else:
            cand = [j for j in cand if D[i, j] <= band_km]
        if kind == "idw":
            w = [1.0 / (D[i, j] ** power) for j in cand]
        else:
            w = [1.0] * len(cand)
        if standardize and w:
            s = sum(w)
            w = [x / s for x in w]
        neigh.append(cand)
        wts.append(w)
    return [s["id"] for s in mon], neigh, wts


def weights_matrix(neigh, wts):
    n = len(neigh)
    W = np.zeros((n, n))
    for i in range(n):
        for j, w in zip(neigh[i], wts[i]):
            W[i, j] = w
    return W


def moran_stat(z, W):
    zc = z - z.mean()
    s0 = W.sum()
    den = (zc ** 2).sum()
    return (len(z) / s0) * (zc @ W @ zc) / den if s0 > 0 and den > 0 else float("nan")


def moran_normal_z(z, W):
    """Analytic z-score under the normality assumption (same formula as PySAL's z_norm)."""
    n = len(z)
    s0 = W.sum()
    s1 = 0.5 * ((W + W.T) ** 2).sum()
    s2 = ((W.sum(axis=1) + W.sum(axis=0)) ** 2).sum()
    ei = -1.0 / (n - 1)
    vi = (n * n * s1 - n * s2 + 3 * s0 * s0) / ((n * n - 1) * s0 * s0) - ei * ei
    return ei, (moran_stat(z, W) - ei) / math.sqrt(vi)


def permute(z, groups, rng, scheme):
    if scheme == "within_lake":
        out = z.copy()
        for g in np.unique(groups):
            idx = np.where(groups == g)[0]
            out[idx] = z[rng.permutation(idx)]
        return out
    return z[rng.permutation(len(z))]


def global_moran(z, W, groups, perms=999, scheme="all", seed=1):
    rng = np.random.default_rng(seed)
    obs = moran_stat(z, W)
    sims = np.array([moran_stat(permute(z, groups, rng, scheme), W) for _ in range(perms)])
    ei, z_norm = moran_normal_z(z, W)
    p_upper = ((sims >= obs).sum() + 1) / (perms + 1)  # ties count toward both tails, so ties can never fake significance
    p_lower = ((sims <= obs).sum() + 1) / (perms + 1)
    p_one = min(p_upper, p_lower)
    return {"I": float(obs), "expected": float(ei), "z_norm": float(z_norm), "perm_mean": float(sims.mean()), "perm_sd": float(sims.std(ddof=1)),
            "z_perm": float((obs - sims.mean()) / sims.std(ddof=1)) if sims.std(ddof=1) > 0 else float("nan"), "p_perm_two_sided": float(min(1.0, 2 * p_one)), "perms": perms, "scheme": scheme}


def local_moran(z, W, groups, perms=999, scheme="all", seed=1):
    """Local Moran I_i = (z_i / m2) * sum_j w_ij z_j with conditional permutation (value i held fixed)."""
    rng = np.random.default_rng(seed)
    n = len(z)
    zc = z - z.mean()
    m2 = (zc ** 2).sum() / (n - 1)  # PySAL (esda) convention: sample variance, so values match esda exactly
    lag = W @ zc
    Ii = zc / m2 * lag
    p = np.zeros(n)
    for i in range(n):
        others = np.array([j for j in range(n) if j != i])
        if scheme == "within_lake":
            same = [j for j in range(n) if j != i and groups[j] == groups[i]]
        sims = np.zeros(perms)
        for r in range(perms):
            perm_z = zc.copy()
            if scheme == "within_lake":
                if len(same) > 1:
                    perm_z[same] = zc[rng.permutation(same)]
            else:
                perm_z[others] = zc[rng.permutation(others)]
            sims[r] = zc[i] / m2 * (W[i] @ perm_z)
        p_upper = ((sims >= Ii[i]).sum() + 1) / (perms + 1)
        p_lower = ((sims <= Ii[i]).sum() + 1) / (perms + 1)
        p[i] = min(1.0, 2 * min(p_upper, p_lower))
    quad = np.where((zc > 0) & (lag > 0), "HH", np.where((zc < 0) & (lag < 0), "LL", np.where((zc > 0) & (lag < 0), "HL", "LH")))
    return Ii, p, quad, lag, zc


def benjamini_hochberg(p, alpha=0.05):
    p = np.asarray(p)
    n = len(p)
    order = np.argsort(p)
    thresh = alpha * (np.arange(1, n + 1) / n)
    passed = p[order] <= thresh
    k = np.max(np.where(passed)[0]) + 1 if passed.any() else 0
    sig = np.zeros(n, dtype=bool)
    sig[order[:k]] = True
    return sig
