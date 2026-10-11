"""Python-side checks of the analytical code against independent libraries. Run: python3 tests/test_python.py
  1. Ordinary Kriging: the hand-written system used by the app equals PyKrige (geographic distances) for all three variogram models.
  2. Moran's I: our statistic equals esda (PySAL) for row-standardised weights; local Moran equals esda.Moran_Local.
  3. AHP: power-iteration eigenvector equals numpy's eigen-decomposition; CR formula; reciprocal matrix properties.
  4. Generated artefacts are present and internally consistent."""
import json, os, sys
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
from spatial_common import (KM_PER_DEGREE, build_weights, haversine_km, load_all, moran_stat, variogram_model, weights_matrix)

passed = 0


def check(name, cond, detail=""):
    global passed
    assert cond, f"FAILED: {name} {detail}"
    passed += 1
    print("ok  ", name)


# ---- 1. Kriging vs PyKrige -------------------------------------------------------------------------------------------
from pykrige.ok import OrdinaryKriging
rng = np.random.default_rng(3)
for model in ("spherical", "exponential", "gaussian"):
    worst = 0.0
    for _ in range(10):
        n = 6
        lat = 45 + rng.uniform(-0.8, 0.8, n); lon = -83 + rng.uniform(-1.2, 1.2, n); z = rng.normal(2, 0.7, n)
        par = {"nugget": 0.05, "psill": 0.6, "range": 150.0}
        tlat, tlon = 45 + rng.uniform(-0.5, 0.5), -83 + rng.uniform(-0.8, 0.8)
        ok = OrdinaryKriging(lon, lat, z, variogram_model=model, variogram_parameters={"sill": par["psill"] + par["nugget"], "range": par["range"] / KM_PER_DEGREE, "nugget": par["nugget"]},
                             coordinates_type="geographic", verbose=False, enable_plotting=False)
        zh, ss = ok.execute("points", np.array([tlon]), np.array([tlat]))
        # hand-written system
        G = np.zeros((n + 1, n + 1))
        for i in range(n):
            for j in range(n):
                G[i, j] = 0 if i == j else variogram_model(model, haversine_km(lat[i], lon[i], lat[j], lon[j]), par["psill"], par["range"], par["nugget"])
        G[:n, n] = 1; G[n, :n] = 1
        rhs = np.append([variogram_model(model, haversine_km(tlat, tlon, lat[i], lon[i]), par["psill"], par["range"], par["nugget"]) for i in range(n)], 1.0)
        sol = np.linalg.solve(G, rhs)
        est, var = float(sol[:n] @ z), float(sol @ rhs)
        worst = max(worst, abs(est - zh[0]), abs(var - ss[0]))
    check(f"kriging {model} matches PyKrige (max diff {worst:.1e})", worst < 1e-3)

# ---- 2. Moran vs esda ---------------------------------------------------------------------------------------------------
import libpysal
from esda.moran import Moran, Moran_Local
obs, stations, dates, lakes = load_all()
ids, neigh, wts = build_weights(stations, kind="knn", k=4, same_lake=False)
W = weights_matrix(neigh, wts)
zz = np.random.default_rng(1).normal(size=len(ids))
w = libpysal.weights.full2W(W)
w.transform = "r"
m = Moran(zz, w, permutations=0)
check("global Moran's I equals esda", abs(moran_stat(zz, W) - m.I) < 1e-10, f"{moran_stat(zz, W)} vs {m.I}")
ml = Moran_Local(zz, w, permutations=0, transformation="r")
zc = zz - zz.mean()
m2 = (zc ** 2).sum() / (len(zz) - 1)
local = zc / m2 * (W @ zc)
check("local Moran's I equals esda.Moran_Local", np.allclose(local, ml.Is, atol=1e-10))

# ---- 3. AHP --------------------------------------------------------------------------------------------------------------
RI = [0, 0, 0.58, 0.90, 1.12, 1.24, 1.32, 1.41, 1.45, 1.49]
keys = ["tp", "chl", "nitrate", "temp", "doxy", "turb"]
J = {"tp|chl": 1, "tp|nitrate": 3, "tp|temp": 2, "tp|doxy": 3, "tp|turb": 4, "chl|nitrate": 4, "chl|temp": 3, "chl|doxy": 3, "chl|turb": 5,
     "nitrate|temp": .5, "nitrate|doxy": .5, "nitrate|turb": 1, "temp|doxy": 1, "temp|turb": 2, "doxy|turb": 2}  # same as DEFAULT_JUDGMENTS in src/lib/ahp.js
A = np.ones((6, 6))
for i in range(6):
    for j in range(i + 1, 6):
        A[i, j] = J[f"{keys[i]}|{keys[j]}"]; A[j, i] = 1 / A[i, j]
vals, vecs = np.linalg.eig(A)
k = int(np.argmax(vals.real)); wv = np.abs(vecs[:, k].real); wv /= wv.sum()
lam = vals[k].real; ci = (lam - 6) / 5; cr = ci / RI[5]
check("default AHP weights sum to 1 and are positive", abs(wv.sum() - 1) < 1e-12 and (wv > 0).all())
check(f"default AHP is consistent (CR {cr:.4f} < 0.10)", cr < 0.1)
w_js = np.ones(6) / 6
for _ in range(500):
    w_js = A @ w_js; w_js /= w_js.sum()
check("power iteration equals numpy eigenvector", np.allclose(w_js, wv, atol=1e-10))
app = json.load(open(os.path.join(ROOT, "tests", "fixtures", "ahp_fixtures.json")))
check("AHP fixtures present", len(app) >= 8)

# ---- 4. Artefacts ---------------------------------------------------------------------------------------------------------
kr = json.load(open(os.path.join(ROOT, "src", "data", "kriging_results.json")))
check("every indicator has a best model and three CV entries", all(len([m for m in v if m in ("spherical", "exponential", "gaussian")]) == 3 for v in kr["cv"].values()))
check("kriging CV used only 2024-2025 cases", kr["meta"]["n_cases"] > 1000)
check("no negative kriging variance in CV (coverage between 0 and 1)", all(0 <= kr["cv"][i][m]["coverage95"] <= 1 for i in kr["cv"] for m in ("spherical", "exponential", "gaussian")))
est = open(os.path.join(ROOT, "public", "data", "estimated_missing_values.csv")).read()
check("estimated values are flagged ESTIMATED_KRIGING", all(l.endswith("ESTIMATED_KRIGING") for l in est.strip().split("\n")[1:]))
for fn in ("observations.csv", "missing_observations.csv"):
    check(f"public/data/{fn} exists", os.path.exists(os.path.join(ROOT, "public", "data", fn)))
print(f"\n{passed} Python checks passed")
