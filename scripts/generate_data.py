"""
GL-WQI: synthetic data generation, model fitting and export.

EVERYTHING produced here is SIMULATED. Nothing is a real measurement.

Run:  python3 scripts/generate_data.py
Writes:
  public/data/observations.csv, stations.csv, unmonitored_locations.csv, model_results.json
  src/data/observations.json (columnar), stations.json, model_results.json, lakes.json
"""
import json
import math
import os

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (brier_score_loss, confusion_matrix, f1_score,
                             precision_score, recall_score, roc_auc_score)
from sklearn.model_selection import GroupKFold, StratifiedKFold

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, "public", "data")
SRC = os.path.join(ROOT, "src", "data")
RAW = os.path.join(ROOT, "data", "raw")
for d in (PUB, SRC, RAW):
    os.makedirs(d, exist_ok=True)

rng = np.random.default_rng(2018)

# ---------------------------------------------------------------------------
# 1. Geography (schematic lake outlines, [lat, lon]) and station definitions
# ---------------------------------------------------------------------------
LAKES = {
    "Superior": [[46.5, -84.6], [46.7, -85.5], [46.5, -87.4], [46.85, -88.4], [46.95, -89.5],
                 [46.75, -90.8], [46.7, -92.0], [47.3, -91.2], [47.9, -89.6], [48.4, -89.2],
                 [48.8, -88.4], [48.7, -87.2], [48.0, -86.0], [47.9, -85.0], [47.2, -84.8]],
    "Michigan": [[41.65, -87.3], [42.4, -87.75], [43.4, -87.85], [44.4, -87.45], [45.1, -87.1],
                 [45.7, -86.9], [45.9, -86.2], [45.85, -85.4], [45.75, -84.9], [45.35, -85.35],
                 [44.75, -86.25], [44.0, -86.55], [43.2, -86.4], [42.4, -86.3], [41.8, -86.6]],
    "Huron": [[46.05, -84.1], [45.95, -83.3], [45.4, -83.35], [44.9, -83.3], [44.3, -83.35],
              [43.9, -83.9], [43.6, -83.8], [43.65, -82.9], [43.05, -82.45], [43.15, -81.75],
              [43.9, -81.7], [44.65, -81.35], [45.2, -81.3], [45.55, -80.65], [46.0, -80.7],
              [46.15, -81.7], [46.1, -82.7], [46.2, -83.5]],
    "Erie": [[41.7, -83.4], [41.45, -82.7], [41.5, -81.7], [41.9, -80.6], [42.5, -79.5],
             [42.85, -78.9], [42.9, -79.3], [42.65, -80.3], [42.6, -81.3], [42.3, -82.1],
             [42.05, -82.7], [41.95, -83.15]],
    "Ontario": [[43.25, -79.75], [43.65, -79.4], [43.85, -78.7], [44.0, -77.6], [44.2, -76.6],
                [43.9, -76.2], [43.55, -76.3], [43.35, -77.3], [43.3, -78.5], [43.25, -79.1]],
}

# id, lake, name, lat, lon, zone, base_tp (ug/L), base_turb (NTU), TP trend (%/yr), monitored
STATIONS = [
    ("SUP-01", "Superior", "Western Arm (Duluth offshore)", 46.9, -90.6, "Nearshore", 5.5, 3.0, 0.0, True),
    ("SUP-02", "Superior", "Apostle Islands offshore", 47.4, -89.3, "Offshore", 3.2, 1.5, 0.0, True),
    ("SUP-03", "Superior", "North Shore offshore", 48.3, -88.0, "Offshore", 2.6, 1.0, 0.0, True),
    ("SUP-04", "Superior", "Central Basin", 47.3, -87.0, "Offshore", 2.4, 0.9, 0.0, True),
    ("SUP-05", "Superior", "Eastern Basin", 47.5, -85.8, "Offshore", 2.5, 1.0, 0.0, True),
    ("SUP-06", "Superior", "Whitefish approach", 46.95, -86.0, "Offshore", 3.0, 1.2, 0.0, True),
    ("MIC-01", "Michigan", "Southern Basin (Gary offshore)", 42.0, -87.2, "Nearshore", 9.0, 4.0, 0.5, True),
    ("MIC-02", "Michigan", "Milwaukee offshore", 42.9, -87.2, "Nearshore", 8.0, 3.5, 0.5, True),
    ("MIC-03", "Michigan", "Central west basin", 43.8, -87.0, "Offshore", 6.0, 2.0, 0.5, True),
    ("MIC-04", "Michigan", "Door Peninsula offshore", 44.7, -86.9, "Offshore", 5.5, 2.0, 0.5, True),
    ("MIC-05", "Michigan", "Northern Basin", 45.4, -85.9, "Offshore", 4.5, 1.5, 0.5, True),
    ("MIC-06", "Michigan", "Muskegon offshore", 43.4, -86.7, "Nearshore", 7.0, 3.0, 0.5, True),
    ("HUR-01", "Huron", "Northern main basin", 45.6, -82.5, "Offshore", 4.5, 1.5, 0.3, True),
    ("HUR-02", "Huron", "Central main basin", 44.8, -82.5, "Offshore", 5.0, 1.8, 0.3, True),
    ("HUR-03", "Huron", "Southern main basin", 43.9, -82.4, "Offshore", 6.0, 2.2, 0.3, True),
    ("HUR-04", "Huron", "Saginaw Bay", 43.75, -83.5, "Bay", 26.0, 9.0, 3.0, True),
    ("HUR-05", "Huron", "Georgian Bay", 45.6, -81.1, "Bay", 4.0, 1.3, 0.3, True),
    ("HUR-06", "Huron", "North Channel", 46.0, -82.0, "Nearshore", 4.2, 1.5, 0.3, True),
    ("ERI-01", "Erie", "Western Basin (Maumee Bay)", 41.8, -83.0, "Bay", 42.0, 14.0, 1.5, True),
    ("ERI-02", "Erie", "Western Basin (Pelee Passage)", 41.85, -82.5, "Nearshore", 30.0, 10.0, 1.5, True),
    ("ERI-03", "Erie", "Central Basin west (Sandusky)", 41.9, -81.7, "Nearshore", 20.0, 6.0, 1.2, True),
    ("ERI-04", "Erie", "Central Basin (Cleveland offshore)", 42.2, -81.0, "Offshore", 17.0, 5.0, 4.0, True),
    ("ERI-05", "Erie", "Central Basin east", 42.4, -80.0, "Offshore", 14.0, 4.0, 1.0, True),
    ("ERI-06", "Erie", "Eastern Basin", 42.6, -79.6, "Offshore", 11.0, 3.0, 1.0, True),
    ("ERI-07", "Erie", "Central Basin north (Canadian waters)", 42.4, -81.8, "Nearshore", 16.0, 4.5, 1.2, True),
    ("ONT-01", "Ontario", "Hamilton Harbour approach", 43.45, -79.3, "Nearshore", 14.0, 6.0, -1.0, True),
    ("ONT-02", "Ontario", "Western basin", 43.6, -78.4, "Offshore", 10.0, 3.0, -1.0, True),
    ("ONT-03", "Ontario", "Central basin (Rochester)", 43.7, -77.4, "Offshore", 9.0, 2.5, -1.0, True),
    ("ONT-04", "Ontario", "Eastern basin", 43.9, -76.6, "Offshore", 8.0, 2.2, -1.0, True),
    ("ONT-05", "Ontario", "South shore (Sodus)", 43.55, -77.9, "Nearshore", 10.5, 3.5, -1.0, True),
    ("ONT-06", "Ontario", "North shore central", 43.95, -77.2, "Offshore", 8.0, 2.4, -1.0, True),
    # unmonitored prediction locations (hidden simulated truth is used only for validation)
    ("SUP-U1", "Superior", "Western Arm south shore", 46.95, -91.5, "Nearshore", 4.8, 2.5, 0.0, False),
    ("SUP-U2", "Superior", "North central basin", 48.1, -87.0, "Offshore", 2.5, 1.0, 0.0, False),
    ("MIC-U1", "Michigan", "Northern deep basin", 45.6, -86.2, "Offshore", 4.5, 1.5, 0.5, False),
    ("MIC-U2", "Michigan", "Southeast nearshore", 42.5, -86.6, "Nearshore", 10.0, 4.0, 0.5, False),
    ("HUR-U1", "Huron", "Central Huron east", 44.4, -82.0, "Offshore", 5.5, 2.0, 0.3, False),
    ("HUR-U2", "Huron", "Georgian Bay approach", 45.2, -81.8, "Offshore", 4.6, 1.5, 0.3, False),
    ("HUR-U3", "Huron", "Outer Saginaw Bay", 44.0, -83.2, "Bay", 14.0, 5.0, 2.0, False),
    ("ERI-U1", "Erie", "Western Basin south shore", 41.65, -82.4, "Bay", 33.0, 11.0, 1.5, False),
    ("ERI-U2", "Erie", "Central Basin mid-lake", 42.15, -80.5, "Offshore", 15.0, 4.0, 1.5, False),
    ("ERI-U3", "Erie", "Sandusky Bay mouth", 41.75, -82.0, "Bay", 25.0, 8.0, 1.5, False),
    ("ONT-U1", "Ontario", "Eastern basin central", 43.8, -77.0, "Offshore", 8.2, 2.4, -1.0, False),
    ("ONT-U2", "Ontario", "Niagara bar region", 43.55, -78.9, "Nearshore", 13.0, 5.0, -1.0, False),
]

LAKE_CLIMATE = {  # mean water temp (C), seasonal amplitude (C)
    "Superior": (5.5, 8.0), "Michigan": (9.0, 11.0), "Huron": (8.0, 10.0),
    "Erie": (11.5, 12.5), "Ontario": (9.5, 10.5),
}
ZONE_TEMP = {"Offshore": 0.0, "Nearshore": 1.2, "Bay": 2.4}
ZONE_TP_SEASON = {"Offshore": 0.12, "Nearshore": 0.28, "Bay": 0.35}

# Equipment outages (monitored stations only) so that stale-observation rules can be exercised
OUTAGES = {
    "MIC-05": ("2025-06-20", "2025-09-30"),
    "ERI-06": ("2025-07-25", "2025-10-10"),
    "HUR-05": ("2025-08-05", "2025-10-20"),
    "SUP-03": ("2025-07-01", "2025-09-15"),
    "ONT-04": ("2024-07-10", "2024-08-30"),
}


def point_in_poly(lat, lon, poly):
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        yi, xi = poly[i]
        yj, xj = poly[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


for s in STATIONS:
    assert point_in_poly(s[3], s[4], LAKES[s[1]]), f"{s[0]} is outside its lake polygon"


def haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


# ---------------------------------------------------------------------------
# 2. Synthetic observation generator
# ---------------------------------------------------------------------------
DATES = pd.date_range("2018-01-02", "2025-12-31", freq="14D")
N = len(DATES)
DOY = DATES.dayofyear.values
YRS = (DATES.year.values - 2018) + DOY / 365.0
MONTHS = DATES.month.values


def season_of(month):
    if month in (12, 1, 2):
        return "Winter"
    if month in (3, 4, 5):
        return "Spring"
    if month in (6, 7, 8):
        return "Summer"
    return "Autumn"


def ar1(phi, sd, n):
    x = np.zeros(n)
    x[0] = rng.normal(0, sd / math.sqrt(1 - phi ** 2))
    for t in range(1, n):
        x[t] = phi * x[t - 1] + rng.normal(0, sd)
    return x


# Lake-level weather and loading series shared by every station on a lake
lake_series = {}
for lake, (tmean, tamp) in LAKE_CLIMATE.items():
    seasonal_T = tmean + tamp * np.sin(2 * np.pi * (DOY - 130) / 365.0)
    rain_scale = np.array([{"Winter": 10, "Spring": 18, "Summer": 20, "Autumn": 17}[season_of(m)] for m in MONTHS])
    rain = rng.gamma(1.15, rain_scale / 1.15)
    storms = rng.random(N) < 0.03
    rain = np.where(storms, rain * 2.5, rain)
    lake_series[lake] = {
        "T": seasonal_T + ar1(0.5, 1.0, N),
        "rain": rain,
        "tp": ar1(0.8, 0.06, N),
        "shock": ar1(0.5, 0.35, N),
    }

Z0 = -6.4  # intercept of the latent bloom process (simulation parameter, not a fitted value)


def simulate_station(st):
    sid, lake, name, lat, lon, zone, base_tp, base_turb, trend_pct, monitored = st
    L = lake_series[lake]
    u_s = rng.normal(0, 0.35)  # unobserved station effect
    loc_T = ar1(0.3, 0.6, N)
    loc_tp = ar1(0.8, 0.10, N)
    loc_chl = ar1(0.5, 0.30, N)
    rows = []
    bloom_prev = 0
    for t in range(N):
        T = max(L["T"][t] + ZONE_TEMP[zone] + loc_T[t], 0.3)
        R = L["rain"][t] * math.exp(rng.normal(0, 0.3))
        trend = (1 + trend_pct / 100.0) ** YRS[t]
        sf = 1 + ZONE_TP_SEASON[zone] * math.cos(2 * math.pi * (DOY[t] - 110) / 365.0)
        runoff = 1 + 0.006 * min(R, 60) + 0.004 * max(R - 60, 0)
        tp = base_tp * trend * sf * math.exp(L["tp"][t] + loc_tp[t]) * runoff * math.exp(rng.normal(0, 0.05))
        # Rain raises risk via runoff up to a point; very heavy rain is assumed to dilute/mix (non-monotonic)
        rain_eff = 0.9 * min(R, 45) / 45 - 1.3 * max(R - 70, 0) / 40
        z = (Z0 + 1.35 * math.log(tp) + 0.14 * (T - 12) + 0.55 * math.cos(2 * math.pi * (DOY[t] - 225) / 365.0)
             + rain_eff + 1.0 * bloom_prev + u_s + L["shock"][t])
        p_true = 1 / (1 + math.exp(-z))
        bloom = int(rng.random() < p_true)
        ln_chl = -0.7 + 0.8 * math.log(tp) + 0.04 * (T - 12) + loc_chl[t]
        if bloom:
            ln_chl += math.log(2.6) + 0.6 * rng.random()
        chl = math.exp(ln_chl + rng.normal(0, 0.10))
        sat = 14.62 - 0.3898 * T + 0.006969 * T ** 2 - 0.00005896 * T ** 3
        do = sat * (0.985 + 0.010 * math.log(1 + chl)) + rng.normal(0, 0.30)
        if bloom:
            do -= 0.9 * rng.random()
        turb = base_turb * math.exp(rng.normal(0, 0.25)) * (1 + 0.012 * R) + 0.06 * chl
        rows.append({
            "Station_ID": sid, "Lake_Name": lake, "Latitude": lat, "Longitude": lon,
            "Observation_Date": DATES[t], "Total_Phosphorus": round(tp, 2), "Chlorophyll_a": round(chl, 2),
            "Water_Temperature": round(T, 1), "Turbidity": round(turb, 2),
            "Dissolved_Oxygen": round(float(np.clip(do, 2, 16)), 2), "Rainfall": round(R, 1),
            "Season": season_of(MONTHS[t]), "Bloom_Observed": bloom,
            "Monitoring_Status": "Monitored" if monitored else "Unmonitored",
        })
        bloom_prev = bloom
    return rows


all_rows = []
for st in STATIONS:
    all_rows.extend(simulate_station(st))
full = pd.DataFrame(all_rows)

hidden_truth = full[full["Monitoring_Status"] == "Unmonitored"].copy()  # used only for validation
obs = full[full["Monitoring_Status"] == "Monitored"].copy()

# Outages and random missing samples
keep = np.ones(len(obs), dtype=bool)
for sid, (a, b) in OUTAGES.items():
    m = (obs["Station_ID"] == sid) & (obs["Observation_Date"] >= a) & (obs["Observation_Date"] <= b)
    keep &= ~m.values
keep &= rng.random(len(obs)) > 0.02
obs = obs[keep].sort_values(["Station_ID", "Observation_Date"]).reset_index(drop=True)
obs.insert(0, "Observation_ID", [f"OBS-{i + 1:06d}" for i in range(len(obs))])
obs["Data_Source"] = "SIMULATED"

# ---------------------------------------------------------------------------
# 2b. Nitrate + nitrite as N (mg/L). Added in v2 with its OWN random streams, so every value generated
#     above (and every model fitted below) is identical to v1. Stations with more phosphorus loading carry more
#     nitrate; spring is the seasonal maximum, summer uptake the minimum; moderate rain adds runoff; a bloom draws
#     nitrate down slightly.
# ---------------------------------------------------------------------------
STATION_ROW = {st[0]: st for st in STATIONS}
STATION_IDX = {st[0]: i for i, st in enumerate(STATIONS)}
LAKE_IDX = {name: i for i, name in enumerate(LAKES)}
DATE_POS = {d: i for i, d in enumerate(DATES)}
ZONE_NO3 = {"Offshore": 1.0, "Nearshore": 1.08, "Bay": 1.18}


def ar1_stream(r, phi, sd, n):
    x = np.zeros(n)
    x[0] = r.normal(0, sd / math.sqrt(1 - phi ** 2))
    for t in range(1, n):
        x[t] = phi * x[t - 1] + r.normal(0, sd)
    return x


LAKE_NO3 = {lk: ar1_stream(np.random.default_rng([777, 1, i]), 0.7, 0.07, N) for lk, i in LAKE_IDX.items()}


def add_nitrate(df, col_after="Dissolved_Oxygen"):
    values = np.zeros(len(df))
    for sid, idx in df.groupby("Station_ID").indices.items():
        st = STATION_ROW[sid]
        r = np.random.default_rng([777, 2, STATION_IDX[sid]])
        local = ar1_stream(r, 0.5, 0.06, N)
        base = (0.20 + 0.0135 * st[6]) * ZONE_NO3[st[5]]
        pos = df.iloc[idx]["Observation_Date"].map(DATE_POS).values.astype(int)
        seasonal = 1 + 0.30 * np.cos(2 * np.pi * (DOY[pos] - 95) / 365.0)
        rain = df.iloc[idx]["Rainfall"].values
        bloom = df.iloc[idx]["Bloom_Observed"].values
        v = base * seasonal * np.exp(LAKE_NO3[st[1]][pos] + local[pos]) * (1 + 0.007 * np.minimum(rain, 60))
        v = v * np.where(bloom == 1, 0.88, 1.0) * np.exp(r.normal(0, 0.04, len(idx)))
        values[idx] = v
    df.insert(df.columns.get_loc(col_after) + 1, "Nitrate", np.round(values, 3))


add_nitrate(obs)
add_nitrate(hidden_truth)

print("Observations:", len(obs), "| stations:", obs["Station_ID"].nunique())
print("Overall bloom rate: %.3f" % obs["Bloom_Observed"].mean())
print(obs.groupby("Lake_Name")["Bloom_Observed"].mean().round(3).to_dict())
print(obs.groupby("Season")["Bloom_Observed"].mean().round(3).to_dict())

# ---------------------------------------------------------------------------
# 3. Modelling tables
# ---------------------------------------------------------------------------
obs["Observation_Date"] = pd.to_datetime(obs["Observation_Date"])
obs = obs.sort_values(["Station_ID", "Observation_Date"]).reset_index(drop=True)
short = {"Total_Phosphorus": "TP", "Chlorophyll_a": "Chl", "Water_Temperature": "Temp",
         "Rainfall": "Rain", "Dissolved_Oxygen": "DO"}
tbl = obs.rename(columns=short).copy()
g = tbl.groupby("Station_ID")
for v in ["TP", "Chl", "Temp", "Rain", "DO"]:
    tbl[v + "_prev"] = g[v].shift(1)
tbl["prev_date"] = g["Observation_Date"].shift(1)
tbl["gap_days"] = (tbl["Observation_Date"] - tbl["prev_date"]).dt.days
tbl = tbl[tbl["prev_date"].notna() & (tbl["gap_days"] <= 42)].reset_index(drop=True)
for s in ["Spring", "Summer", "Autumn"]:
    tbl[s] = (tbl["Season"] == s).astype(float)

LR_FEATURES = ["lnTP", "lnChl", "Temp", "Rain", "Rain2", "DO", "Spring", "Summer", "Autumn"]
RF_FEATURES = ["TP", "Chl", "Temp", "Rain", "DO", "Spring", "Summer", "Autumn"]


def build_X(df, cfg, features):
    sfx = "_prev" if cfg == "early" else ""
    cols = {
        "TP": df["TP" + sfx], "Chl": df["Chl" + sfx], "Temp": df["Temp" + sfx],
        "Rain": df["Rain" + sfx], "DO": df["DO" + sfx],
        "Spring": df["Spring"], "Summer": df["Summer"], "Autumn": df["Autumn"],
    }
    cols["lnTP"] = np.log(cols["TP"])
    cols["lnChl"] = np.log(cols["Chl"])
    cols["Rain2"] = cols["Rain"] ** 2
    return pd.DataFrame({f: cols[f] for f in features}).values.astype(float)


train_mask = (tbl["Observation_Date"] <= "2023-12-31").values
test_mask = ~train_mask
y_all = tbl["Bloom_Observed"].values
groups = tbl["Station_ID"].values
print("Modelling rows:", len(tbl), "train:", train_mask.sum(), "test:", test_mask.sum(),
      "| test bloom rate %.3f" % y_all[test_mask].mean())


def fit_lr(X, y):
    mu = X.mean(axis=0)
    sd = X.std(axis=0)
    dummy = np.isin(np.arange(X.shape[1]), [LR_FEATURES.index(c) for c in ["Spring", "Summer", "Autumn"]])
    mu[dummy] = 0.0
    sd[dummy] = 1.0
    sd[sd == 0] = 1.0
    clf = LogisticRegression(C=1.0, max_iter=2000)
    clf.fit((X - mu) / sd, y)
    return {"mu": mu, "sd": sd, "coef": clf.coef_[0], "intercept": float(clf.intercept_[0])}


def predict_lr(m, X):
    z = ((X - m["mu"]) / m["sd"]) @ m["coef"] + m["intercept"]
    return 1 / (1 + np.exp(-z))


def fit_rf(X, y):
    rf = RandomForestClassifier(n_estimators=60, max_depth=6, min_samples_leaf=15, max_features=3,
                                random_state=7, n_jobs=-1)
    rf.fit(X, y)
    return rf


def metrics_at(y, p, thr):
    pred = (p >= thr).astype(int)
    tn, fp, fn, tp_ = confusion_matrix(y, pred, labels=[0, 1]).ravel()
    return {
        "threshold": thr, "precision": float(precision_score(y, pred, zero_division=0)),
        "recall": float(recall_score(y, pred, zero_division=0)), "f1": float(f1_score(y, pred, zero_division=0)),
        "tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp_),
    }


results = {"early": {}, "nowcast": {}}
test_pred = pd.DataFrame({"station": tbl.loc[test_mask, "Station_ID"].values,
                          "date": tbl.loc[test_mask, "Observation_Date"].dt.strftime("%Y-%m-%d").values,
                          "y": y_all[test_mask]})
fitted = {}
for cfg in ["early", "nowcast"]:
    Xl = build_X(tbl, cfg, LR_FEATURES)
    Xr = build_X(tbl, cfg, RF_FEATURES)
    lr = fit_lr(Xl[train_mask], y_all[train_mask])
    rf = fit_rf(Xr[train_mask], y_all[train_mask])
    fitted[cfg] = (lr, rf)
    p_lr = predict_lr(lr, Xl[test_mask])
    p_rf = rf.predict_proba(Xr[test_mask])[:, 1]
    test_pred[f"{cfg}_lr"] = np.round(p_lr, 4)
    test_pred[f"{cfg}_rf"] = np.round(p_rf, 4)
    yt = y_all[test_mask]

    # Cross-validation: station-aware (GroupKFold) versus random folds (to show optimism)
    cv = {}
    for name, splitter, use_groups in [("station_aware", GroupKFold(n_splits=5), True),
                                       ("random", StratifiedKFold(n_splits=5, shuffle=True, random_state=1), False)]:
        aucs = {"lr": [], "rf": []}
        split_iter = splitter.split(Xl, y_all, groups) if use_groups else splitter.split(Xl, y_all)
        for tr, te in split_iter:
            if y_all[te].sum() == 0 or y_all[te].sum() == len(te):
                continue
            m = fit_lr(Xl[tr], y_all[tr])
            aucs["lr"].append(roc_auc_score(y_all[te], predict_lr(m, Xl[te])))
            r = fit_rf(Xr[tr], y_all[tr])
            aucs["rf"].append(roc_auc_score(y_all[te], r.predict_proba(Xr[te])[:, 1]))
        cv[name] = {k: {"mean": float(np.mean(v)), "sd": float(np.std(v)), "folds": [float(a) for a in v]}
                    for k, v in aucs.items()}

    results[cfg] = {
        "holdout": {
            "lr": {"auc": float(roc_auc_score(yt, p_lr)), "brier": float(brier_score_loss(yt, p_lr)),
                   **metrics_at(yt, p_lr, 0.4)},
            "rf": {"auc": float(roc_auc_score(yt, p_rf)), "brier": float(brier_score_loss(yt, p_rf)),
                   **metrics_at(yt, p_rf, 0.4)},
        },
        "cv": cv,
    }
    print(cfg, "holdout AUC  LR %.3f  RF %.3f" % (results[cfg]["holdout"]["lr"]["auc"], results[cfg]["holdout"]["rf"]["auc"]),
          "| station-aware CV  LR %.3f  RF %.3f" % (cv["station_aware"]["lr"]["mean"], cv["station_aware"]["rf"]["mean"]),
          "| random CV  LR %.3f  RF %.3f" % (cv["random"]["lr"]["mean"], cv["random"]["rf"]["mean"]))

# ---------------------------------------------------------------------------
# 4. Export fitted model parameters (logistic coefficients and random-forest trees)
# ---------------------------------------------------------------------------
GROUPS = {"TP": "Total phosphorus", "Chl": "Chlorophyll-a", "Temp": "Water temperature",
          "Rain": "Rainfall", "DO": "Dissolved oxygen", "Season": "Season"}


def group_of(feature):
    if feature in ("lnTP", "TP"):
        return "TP"
    if feature in ("lnChl", "Chl"):
        return "Chl"
    if feature in ("Rain", "Rain2"):
        return "Rain"
    if feature in ("Spring", "Summer", "Autumn"):
        return "Season"
    return feature


def export_lr(m):
    raw = m["coef"] / m["sd"]
    b0 = m["intercept"] - float(np.sum(m["coef"] * m["mu"] / m["sd"]))
    return {
        "features": LR_FEATURES, "mu": [float(v) for v in m["mu"]], "sd": [float(v) for v in m["sd"]],
        "coef_std": [float(v) for v in m["coef"]], "intercept_std": m["intercept"],
        "coef_raw": [float(v) for v in raw], "intercept_raw": b0,
        "odds_ratio_per_sd": [float(math.exp(v)) for v in m["coef"]],
    }


def export_rf(rf):
    trees = []
    for est in rf.estimators_:
        t = est.tree_
        val = t.value[:, 0, :]
        prob = val[:, 1] / val.sum(axis=1)
        trees.append({
            "f": [int(v) for v in t.feature], "t": [round(float(v), 5) for v in t.threshold],
            "l": [int(v) for v in t.children_left], "r": [int(v) for v in t.children_right],
            "v": [round(float(v), 4) for v in prob],
        })
    return {"features": RF_FEATURES, "trees": trees}


def grouped_permutation_importance(rf, X, y, features, n_rep=5):
    base = roc_auc_score(y, rf.predict_proba(X)[:, 1])
    out = {}
    for gkey, gname in GROUPS.items():
        idx = [i for i, f in enumerate(features) if group_of(f) == gkey]
        drops = []
        for _ in range(n_rep):
            Xp = X.copy()
            perm = rng.permutation(len(X))
            Xp[:, idx] = X[perm][:, idx]
            drops.append(base - roc_auc_score(y, rf.predict_proba(Xp)[:, 1]))
        out[gname] = float(np.mean(drops))
    return out


models_out = {}
for cfg in ["early", "nowcast"]:
    lr, rf = fitted[cfg]
    Xr = build_X(tbl, cfg, RF_FEATURES)
    imp = {}
    for gkey, gname in GROUPS.items():
        idx = [i for i, f in enumerate(RF_FEATURES) if group_of(f) == gkey]
        imp[gname] = float(sum(rf.feature_importances_[i] for i in idx))
    models_out[cfg] = {
        "lr": export_lr(lr), "rf": export_rf(rf),
        "rf_impurity_importance": imp,
        "rf_permutation_importance_test": grouped_permutation_importance(rf, Xr[test_mask], y_all[test_mask], RF_FEATURES),
    }

# Training-data ranges (used for extrapolation warnings) and reference values (used for contribution analysis)
train_tbl = tbl[train_mask]
ranges = {}
reference = {}
for v in ["TP", "Chl", "Temp", "Rain", "DO"]:
    col = train_tbl[v]
    ranges[v] = {"min": float(col.min()), "p01": float(col.quantile(0.01)), "p99": float(col.quantile(0.99)),
                 "max": float(col.max())}
    reference[v] = float(col.median())

# ---------------------------------------------------------------------------
# 5. Spatial model validation (leave-one-station-out)
# ---------------------------------------------------------------------------
stn_df = pd.DataFrame(STATIONS, columns=["id", "lake", "name", "lat", "lon", "zone", "base_tp", "base_turb", "trend", "monitored"])
mon = stn_df[stn_df["monitored"]].reset_index(drop=True)
grid = {}
for v, col in [("TP", "Total_Phosphorus"), ("Chl", "Chlorophyll_a"), ("Temp", "Water_Temperature"),
               ("Rain", "Rainfall"), ("DO", "Dissolved_Oxygen")]:
    grid[v] = obs.pivot(index="Observation_Date", columns="Station_ID", values=col).reindex(DATES)[list(mon["id"])]
bloom_grid = obs.pivot(index="Observation_Date", columns="Station_ID", values="Bloom_Observed").reindex(DATES)[list(mon["id"])]

IDW_P, IDW_EPS, RADIUS_KM, K_NEAR, HIST = 2.0, 1.0, 150.0, 4, 3
HW = np.array([1.0, 0.6, 0.36])


def estimate_vars(target_xy, lake, exclude_id, i, p=IDW_P, k=K_NEAR, radius=RADIUS_KM, hist=HIST, equal=False):
    """IDW estimate of every variable at grid-time index i from same-lake stations (as in the JS app)."""
    cand = []
    for j, row in mon.iterrows():
        if row["lake"] != lake or row["id"] == exclude_id:
            continue
        d = haversine_km(target_xy[0], target_xy[1], row["lat"], row["lon"])
        if d <= radius:
            cand.append((d, j, row["id"]))
    cand.sort()
    cand = cand[:k]
    est = {}
    used = 0
    for v in ["TP", "Chl", "Temp", "Rain", "DO"]:
        h = 1 if v in ("Temp", "Rain") else hist
        num = den = 0.0
        n_used = 0
        for d, j, sid in cand:
            vals = [grid[v][sid].iloc[i - a] if i - a >= 0 else np.nan for a in range(h)]
            w_h = HW[:h]
            ok = ~np.isnan(vals)
            if not ok.any():
                continue
            nv = float(np.sum(np.array(vals)[ok] * w_h[ok]) / np.sum(w_h[ok]))
            w = 1.0 if equal else 1.0 / (d + IDW_EPS) ** p
            num += w * nv
            den += w
            n_used += 1
        est[v] = num / den if den > 0 else np.nan
        used = max(used, n_used)
    return est, used


lr_early = fitted["early"][0]
lo_i = int(np.searchsorted(DATES, pd.Timestamp("2024-01-01")))
recs = []
for _, srow in mon.iterrows():
    sid = srow["id"]
    for i in range(lo_i, N - 1):
        if np.isnan(grid["TP"][sid].iloc[i]) or np.isnan(bloom_grid[sid].iloc[i + 1]):
            continue
        est, used = estimate_vars((srow["lat"], srow["lon"]), srow["lake"], sid, i)
        est_eq, _ = estimate_vars((srow["lat"], srow["lon"]), srow["lake"], sid, i, equal=True)
        if used == 0 or any(np.isnan(est[v]) for v in est):
            continue
        month = MONTHS[i + 1]
        seas = [float(month in (3, 4, 5)), float(month in (6, 7, 8)), float(month in (9, 10, 11))]

        def prob_from(e):
            x = np.array([[math.log(e["TP"]), math.log(e["Chl"]), e["Temp"], e["Rain"], e["Rain"] ** 2, e["DO"]] + seas])
            return float(predict_lr(lr_early, x)[0])

        own = {v: grid[v][sid].iloc[i] for v in ["TP", "Chl", "Temp", "Rain", "DO"]}
        recs.append({
            "sid": sid, "lake": srow["lake"], "act_tp": float(own["TP"]), "est_tp": est["TP"], "eq_tp": est_eq["TP"],
            "act_chl": float(own["Chl"]), "est_chl": est["Chl"],
            "act_temp": float(own["Temp"]), "est_temp": est["Temp"],
            "y_next": int(bloom_grid[sid].iloc[i + 1]),
            "p_spatial": prob_from(est), "p_equal": prob_from(est_eq), "p_own": prob_from(own),
        })
rv = pd.DataFrame(recs)


def r2(a, b):
    a, b = np.asarray(a), np.asarray(b)
    return float(1 - np.sum((a - b) ** 2) / np.sum((a - a.mean()) ** 2))


def rmse(a, b):
    return float(np.sqrt(np.mean((np.asarray(a) - np.asarray(b)) ** 2)))


spatial_validation = {
    "method": "Leave-one-station-out over 2024-2025: each monitored station is hidden and its conditions are estimated from same-lake neighbours.",
    "n_cases": int(len(rv)),
    "idw_params": {"power": IDW_P, "epsilon_km": IDW_EPS, "radius_km": RADIUS_KM, "k": K_NEAR, "history_window": HIST},
    "tp": {"rmse_idw": rmse(rv["act_tp"], rv["est_tp"]), "rmse_equal_weights": rmse(rv["act_tp"], rv["eq_tp"]),
           "r2_idw": r2(rv["act_tp"], rv["est_tp"]), "r2_equal_weights": r2(rv["act_tp"], rv["eq_tp"]),
           "mae_idw": float(np.mean(np.abs(rv["act_tp"] - rv["est_tp"])))},
    "chl": {"rmse_idw": rmse(rv["act_chl"], rv["est_chl"]), "r2_idw": r2(rv["act_chl"], rv["est_chl"])},
    "temp": {"rmse_idw": rmse(rv["act_temp"], rv["est_temp"]), "r2_idw": r2(rv["act_temp"], rv["est_temp"])},
    "bloom_auc": {
        "spatial_idw": float(roc_auc_score(rv["y_next"], rv["p_spatial"])),
        "equal_weights": float(roc_auc_score(rv["y_next"], rv["p_equal"])),
        "own_station_inputs": float(roc_auc_score(rv["y_next"], rv["p_own"])),
    },
}
print("Spatial validation:", json.dumps({k: v for k, v in spatial_validation.items() if k in ("tp", "bloom_auc", "n_cases")}, indent=1))

# Hidden-truth comparison for the unmonitored locations (simulated truth, available only because data are synthetic)
hid = hidden_truth.copy()
hid["Observation_Date"] = pd.to_datetime(hid["Observation_Date"])
hid_2425 = hid[hid["Observation_Date"] >= "2024-01-01"]
hidden_summary = {}
for _, urow in stn_df[~stn_df["monitored"]].iterrows():
    sub = hid_2425[hid_2425["Station_ID"] == urow["id"]]
    errs = []
    for i in range(lo_i, N):
        d = DATES[i]
        m = sub[sub["Observation_Date"] == d]
        if m.empty:
            continue
        est, used = estimate_vars((urow["lat"], urow["lon"]), urow["lake"], None, i)
        if used == 0 or np.isnan(est["TP"]):
            continue
        errs.append((float(m["Total_Phosphorus"].iloc[0]), est["TP"]))
    if errs:
        a = np.array(errs)
        hidden_summary[urow["id"]] = {"mae_tp": float(np.mean(np.abs(a[:, 0] - a[:, 1]))),
                                      "mean_true_tp": float(a[:, 0].mean()), "mean_est_tp": float(a[:, 1].mean())}
spatial_validation["hidden_truth_unmonitored"] = hidden_summary

# ---------------------------------------------------------------------------
# 6. Write everything out
# ---------------------------------------------------------------------------
out_obs = obs.copy()
out_obs["Observation_Date"] = out_obs["Observation_Date"].dt.strftime("%Y-%m-%d")
out_obs.to_csv(os.path.join(RAW, "observations_raw.csv"), index=False)
ht = hidden_truth.copy()
ht["Observation_Date"] = pd.to_datetime(ht["Observation_Date"]).dt.strftime("%Y-%m-%d")
ht.to_csv(os.path.join(RAW, "unmonitored_hidden_truth.csv"), index=False)

stations_json = []
for s in STATIONS:
    stations_json.append({"id": s[0], "lake": s[1], "name": s[2], "lat": s[3], "lon": s[4], "zone": s[5],
                          "monitored": s[9], "status": "Monitored" if s[9] else "Unmonitored"})
pd.DataFrame([{"Station_ID": s["id"], "Lake_Name": s["lake"], "Station_Name": s["name"], "Latitude": s["lat"],
               "Longitude": s["lon"], "Zone": s["zone"], "Monitoring_Status": s["status"]}
              for s in stations_json if s["monitored"]]).to_csv(os.path.join(PUB, "stations.csv"), index=False)
pd.DataFrame([{"Location_ID": s["id"], "Lake_Name": s["lake"], "Location_Name": s["name"], "Latitude": s["lat"],
               "Longitude": s["lon"], "Zone": s["zone"], "Monitoring_Status": s["status"]}
              for s in stations_json if not s["monitored"]]).to_csv(os.path.join(PUB, "unmonitored_locations.csv"), index=False)

analysis_dates = [d.strftime("%Y-%m-%d") for d in DATES]
model_results = {
    "meta": {
        "simulated": True,
        "note": "All observations and model outputs are SIMULATED for prototype demonstration. They are not real Great Lakes measurements.",
        "train_period": ["2018-01-02", "2023-12-31"], "test_period": ["2024-01-01", "2025-12-31"],
        "n_observations": int(len(obs)), "n_model_rows": int(len(tbl)), "n_train": int(train_mask.sum()), "n_test": int(test_mask.sum()),
        "test_bloom_rate": float(y_all[test_mask].mean()), "train_bloom_rate": float(y_all[train_mask].mean()),
        "default_analysis_date": "2025-09-02", "sampling_interval_days": 14,
    },
    "models": models_out, "metrics": results, "ranges": ranges, "reference": reference,
    "group_names": GROUPS, "spatial_validation": spatial_validation,
    "test_predictions": json.loads(test_pred.to_json(orient="records")),
}
with open(os.path.join(SRC, "model_results.json"), "w") as f:
    json.dump(model_results, f, separators=(",", ":"))
with open(os.path.join(PUB, "model_results.json"), "w") as f:
    json.dump({k: v for k, v in model_results.items() if k != "models"}, f, indent=1)
with open(os.path.join(SRC, "stations.json"), "w") as f:
    json.dump(stations_json, f, indent=1)
with open(os.path.join(SRC, "lakes.json"), "w") as f:
    json.dump(LAKES, f)
with open(os.path.join(RAW, "lakes.json"), "w") as f:
    json.dump(LAKES, f)
with open(os.path.join(RAW, "stations.json"), "w") as f:
    json.dump(stations_json, f, indent=1)
with open(os.path.join(SRC, "dates.json"), "w") as f:
    json.dump(analysis_dates, f)

# Parity fixtures: a few feature vectors with the sklearn probabilities, checked by scripts/verify_parity.mjs
fixtures = []
Xl_e = build_X(tbl, "early", LR_FEATURES)
Xr_e = build_X(tbl, "early", RF_FEATURES)
Xl_n = build_X(tbl, "nowcast", LR_FEATURES)
Xr_n = build_X(tbl, "nowcast", RF_FEATURES)
for idx in rng.choice(len(tbl), 40, replace=False):
    fixtures.append({
        "early_lr_x": [float(v) for v in Xl_e[idx]], "early_rf_x": [float(v) for v in Xr_e[idx]],
        "now_lr_x": [float(v) for v in Xl_n[idx]], "now_rf_x": [float(v) for v in Xr_n[idx]],
        "early_lr": float(predict_lr(fitted["early"][0], Xl_e[idx:idx + 1])[0]),
        "early_rf": float(fitted["early"][1].predict_proba(Xr_e[idx:idx + 1])[0, 1]),
        "now_lr": float(predict_lr(fitted["nowcast"][0], Xl_n[idx:idx + 1])[0]),
        "now_rf": float(fitted["nowcast"][1].predict_proba(Xr_n[idx:idx + 1])[0, 1]),
    })
with open(os.path.join(ROOT, "scripts", "parity_fixtures.json"), "w") as f:
    json.dump(fixtures, f)

print("Wrote data files. Early-warning LR coefficients (standardised):")
for name, c in zip(LR_FEATURES, fitted["early"][0]["coef"]):
    print("  %-8s %+.3f" % (name, c))
