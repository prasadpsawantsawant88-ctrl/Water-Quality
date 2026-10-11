"""
GL-WQI Phase 1: reproducible data preparation.

Reads  data/raw/observations_raw.csv  (simulated generator output) and writes the cleaned, documented datasets
the analysis scripts and the app use. Every step is a real check: if the raw data contained duplicates, invalid
coordinates, out-of-range values or mixed units, they would be found, flagged and reported here. The synthetic
data are clean by construction, so the report records what was checked and what was (not) found.

Run:  python3 scripts/prepare_data.py
"""
import json
import os

import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
PUB = os.path.join(ROOT, "public", "data")
SRC = os.path.join(ROOT, "src", "data")
DOCS = os.path.join(ROOT, "docs")
for d in (PUB, SRC, DOCS):
    os.makedirs(d, exist_ok=True)

# ---------------------------------------------------------------------------
# Indicator catalogue: name, unit, physical plausibility range (used only to FLAG impossible values),
# and how the spatial analysis treats it. These are plausibility limits, not water-quality standards.
# ---------------------------------------------------------------------------
INDICATORS = {
    "Total_Phosphorus": {"key": "tp", "unit": "ug/L", "label": "Total phosphorus", "valid": (0.0, 500.0), "transform": "log"},
    "Chlorophyll_a": {"key": "chl", "unit": "ug/L", "label": "Chlorophyll-a", "valid": (0.0, 500.0), "transform": "log"},
    "Dissolved_Oxygen": {"key": "doxy", "unit": "mg/L", "label": "Dissolved oxygen", "valid": (0.0, 20.0), "transform": "none"},
    "Turbidity": {"key": "turb", "unit": "NTU", "label": "Turbidity", "valid": (0.0, 1000.0), "transform": "log"},
    "Nitrate": {"key": "nitrate", "unit": "mg/L as N", "label": "Nitrate + nitrite", "valid": (0.0, 20.0), "transform": "log"},
    "Water_Temperature": {"key": "temp", "unit": "degC", "label": "Water temperature", "valid": (-1.0, 35.0), "transform": "none"},
    "Rainfall": {"key": "rain", "unit": "mm", "label": "Recent rainfall", "valid": (0.0, 500.0), "transform": "log1p"},
}
REQUIRED = ["Observation_ID", "Station_ID", "Lake_Name", "Latitude", "Longitude", "Observation_Date", "Season",
            "Bloom_Observed", "Monitoring_Status"] + list(INDICATORS)
SEASON_OF_MONTH = {12: "Winter", 1: "Winter", 2: "Winter", 3: "Spring", 4: "Spring", 5: "Spring",
                   6: "Summer", 7: "Summer", 8: "Summer", 9: "Autumn", 10: "Autumn", 11: "Autumn"}
SAMPLING_DAYS = 14
issues = []  # (check, severity, count, detail)


def record(check, count, detail, severity_if_found="warning"):
    issues.append({"check": check, "found": int(count), "severity": severity_if_found if count else "pass", "detail": detail})


def point_in_polygon(lat, lon, poly):
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        yi, xi = poly[i]
        yj, xj = poly[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


# ---------------------------------------------------------------------------
# 1. Load and standardise
# ---------------------------------------------------------------------------
raw = pd.read_csv(os.path.join(RAW, "observations_raw.csv"))
stations = json.load(open(os.path.join(RAW, "stations.json")))
lakes = json.load(open(os.path.join(RAW, "lakes.json")))
dates_grid = json.load(open(os.path.join(SRC, "dates.json")))
n_raw = len(raw)

missing_cols = [c for c in REQUIRED if c not in raw.columns]
record("Required columns present", len(missing_cols), f"missing: {missing_cols}" if missing_cols else f"all {len(REQUIRED)} required columns found", "error")
if missing_cols:
    raise SystemExit(f"Cannot continue, missing columns: {missing_cols}")

df = raw.copy()
for c in ["Station_ID", "Lake_Name", "Season", "Monitoring_Status"]:
    df[c] = df[c].astype(str).str.strip()
df["Observation_Date"] = pd.to_datetime(df["Observation_Date"], errors="coerce")
bad_dates = df["Observation_Date"].isna().sum()
record("Dates parse as ISO dates", bad_dates, "rows with unparseable dates (dropped)" if bad_dates else "all dates parsed")
df = df[df["Observation_Date"].notna()]
for c in ["Latitude", "Longitude"] + list(INDICATORS):
    df[c] = pd.to_numeric(df[c], errors="coerce")

# ---------------------------------------------------------------------------
# 2. Checks
# ---------------------------------------------------------------------------
dup_id = df["Observation_ID"].duplicated().sum()
record("Duplicate Observation_ID", dup_id, "rows sharing an Observation_ID")
dup_key = df.duplicated(["Station_ID", "Observation_Date"], keep="first")
record("Duplicate station-date records", dup_key.sum(), "second and later records for the same station and date (dropped)")
df = df[~dup_key]

# coordinates: numeric range, constant per station, inside own lake outline
bad_range = ((df["Latitude"].abs() > 90) | (df["Longitude"].abs() > 180) | df[["Latitude", "Longitude"]].isna().any(axis=1))
record("Coordinates numeric and in range", bad_range.sum(), "rows with invalid latitude/longitude (dropped)", "error")
df = df[~bad_range]
coord_spread = df.groupby("Station_ID")[["Latitude", "Longitude"]].nunique().max(axis=1)
record("One coordinate pair per station", (coord_spread > 1).sum(), "stations whose coordinates change between rows")
station_lake_ok = []
for st in stations:
    if st["monitored"]:
        station_lake_ok.append(point_in_polygon(st["lat"], st["lon"], lakes[st["lake"]]))
record("Stations lie inside their lake outline", len(station_lake_ok) - sum(station_lake_ok), "stations outside the (schematic) lake polygon", "error")
lake_mismatch = df.merge(pd.DataFrame(stations)[["id", "lake"]], left_on="Station_ID", right_on="id", how="left")
record("Lake name matches station register", (lake_mismatch["lake"] != lake_mismatch["Lake_Name"]).sum(), "rows whose lake differs from the station register")

# categorical consistency
season_wrong = (df["Season"] != df["Observation_Date"].dt.month.map(SEASON_OF_MONTH)).sum()
record("Season consistent with date", season_wrong, "rows where Season does not match the month")
record("Bloom_Observed is binary", (~df["Bloom_Observed"].isin([0, 1])).sum(), "values other than 0 or 1")
record("Monitoring_Status values", (~df["Monitoring_Status"].isin(["Monitored"])).sum(), "monitored-station file should contain only 'Monitored'")

# value-level checks
range_flags = {}
for col, meta in INDICATORS.items():
    lo, hi = meta["valid"]
    bad = (df[col] < lo) | (df[col] > hi)
    range_flags[col] = int(bad.sum())
    df.loc[bad, col] = np.nan  # impossible values are blanked, never silently kept
record("Values inside physical plausibility range", sum(range_flags.values()), f"per-indicator counts: {range_flags} (blanked)")
nan_by_col = {c: int(df[c].isna().sum()) for c in INDICATORS}
record("Missing indicator values in delivered rows", sum(nan_by_col.values()), f"per-indicator counts: {nan_by_col}")

# unit consistency: a unit mix-up (e.g. mg/L vs ug/L) would shift a station's median by about 1000x
unit_flags = []
for col in INDICATORS:
    overall = df[col].median()
    med = df.groupby("Station_ID")[col].median()
    ratio = (med / overall).replace([np.inf], np.nan)
    unit_flags += [f"{sid}:{col}" for sid, r in ratio.items() if r > 30 or (r < 1 / 30 and r > 0)]
record("Unit consistency (station medians within 30x of overall median)", len(unit_flags), f"suspect: {unit_flags[:10]}" if unit_flags else "no station is off by an order of magnitude or more")

# ---------------------------------------------------------------------------
# 3. Missing observations against the planned sampling grid
# ---------------------------------------------------------------------------
df = df.sort_values(["Station_ID", "Observation_Date"]).reset_index(drop=True)
grid = pd.to_datetime(dates_grid)
mon_ids = [s["id"] for s in stations if s["monitored"]]
have = set(zip(df["Station_ID"], df["Observation_Date"]))
rows = []
for sid in mon_ids:
    miss_idx = [i for i, d in enumerate(grid) if (sid, d) not in have]
    # classify runs: three or more consecutive missed samples = outage, otherwise isolated gap
    runs, start = [], None
    for k, i in enumerate(miss_idx):
        if start is None:
            start = k
        if k == len(miss_idx) - 1 or miss_idx[k + 1] != i + 1:
            runs.append(miss_idx[start:k + 1])
            start = None
    for run in runs:
        kind = "outage" if len(run) >= 3 else "isolated"
        for i in run:
            rows.append({"Station_ID": sid, "Lake_Name": next(s["lake"] for s in stations if s["id"] == sid),
                         "Observation_Date": grid[i].strftime("%Y-%m-%d"), "Gap_Type": kind, "Run_Length": len(run),
                         "Data_Status": "MISSING"})
missing = pd.DataFrame(rows)
expected = len(mon_ids) * len(grid)
record("Planned station-date samples present", len(missing),
       f"{len(missing)} of {expected} planned samples absent ({100 * len(missing) / expected:.1f}%); "
       f"{int((missing['Gap_Type'] == 'outage').sum())} in outages (3+ consecutive), {int((missing['Gap_Type'] == 'isolated').sum())} isolated", "info")

# ---------------------------------------------------------------------------
# 4. Outputs
# ---------------------------------------------------------------------------
df["Data_Status"] = "SIMULATED_OBSERVED"
df["Quality_Flag"] = "OK"
df.loc[df[list(INDICATORS)].isna().any(axis=1), "Quality_Flag"] = "VALUE_BLANKED"
df["Observation_Date"] = df["Observation_Date"].dt.strftime("%Y-%m-%d")
out_cols = ["Observation_ID", "Station_ID", "Lake_Name", "Latitude", "Longitude", "Observation_Date",
            "Total_Phosphorus", "Chlorophyll_a", "Water_Temperature", "Turbidity", "Dissolved_Oxygen", "Nitrate",
            "Rainfall", "Season", "Bloom_Observed", "Monitoring_Status", "Data_Source", "Data_Status", "Quality_Flag"]
df[out_cols].to_csv(os.path.join(PUB, "observations.csv"), index=False)

long = df.melt(id_vars=["Lake_Name", "Station_ID", "Observation_Date", "Data_Status"], value_vars=list(INDICATORS),
               var_name="Indicator", value_name="Value")
long["Unit"] = long["Indicator"].map(lambda c: INDICATORS[c]["unit"])
long = long.sort_values(["Lake_Name", "Station_ID", "Indicator", "Observation_Date"])
long[["Lake_Name", "Station_ID", "Indicator", "Observation_Date", "Value", "Unit", "Data_Status"]].to_csv(os.path.join(PUB, "observations_long.csv"), index=False)
missing.to_csv(os.path.join(PUB, "missing_observations.csv"), index=False)

# columnar JSON for the app (the app reads this, not the CSV)
cols = {
    "id": "Observation_ID", "station": "Station_ID", "date": "Observation_Date", "tp": "Total_Phosphorus", "chl": "Chlorophyll_a",
    "temp": "Water_Temperature", "turb": "Turbidity", "do": "Dissolved_Oxygen", "no3": "Nitrate", "rain": "Rainfall",
    "season": "Season", "bloom": "Bloom_Observed",
}
columnar = {k: df[v].tolist() for k, v in cols.items()}
columnar["bloom"] = [int(v) for v in columnar["bloom"]]
with open(os.path.join(SRC, "observations.json"), "w") as f:
    json.dump(columnar, f, separators=(",", ":"))

station_summary = []
for sid in mon_ids:
    sub = df[df["Station_ID"] == sid]
    st = next(s for s in stations if s["id"] == sid)
    miss_n = int((missing["Station_ID"] == sid).sum()) if len(missing) else 0
    station_summary.append({"station": sid, "lake": st["lake"], "n_obs": int(len(sub)), "n_missing": miss_n,
                            "first": sub["Observation_Date"].min(), "last": sub["Observation_Date"].max(),
                            "completeness_pct": round(100 * len(sub) / len(grid), 1)})

n_clean = len(df)
report = {
    "generated_by": "scripts/prepare_data.py",
    "data_status": "ALL VALUES ARE SIMULATED (synthetic data generator, not real measurements)",
    "rows_raw": int(n_raw), "rows_clean": int(n_clean), "rows_removed": int(n_raw - n_clean),
    "stations_monitored": len(mon_ids), "stations_unmonitored": sum(1 for s in stations if not s["monitored"]),
    "date_range": [df["Observation_Date"].min(), df["Observation_Date"].max()], "planned_samples": expected,
    "sampling_interval_days": SAMPLING_DAYS, "checks": issues, "station_summary": station_summary,
    "missing_by_type": missing["Gap_Type"].value_counts().to_dict() if len(missing) else {},
    "indicator_summary": {c: {"unit": m["unit"], "n": int(df[c].notna().sum()), "min": float(df[c].min()), "median": float(df[c].median()),
                              "max": float(df[c].max()), "valid_range": list(m["valid"])} for c, m in INDICATORS.items()},
}
with open(os.path.join(SRC, "data_quality.json"), "w") as f:
    json.dump(report, f, indent=1)

# ---------------------------------------------------------------------------
# 5. Data dictionary
# ---------------------------------------------------------------------------
dictionary = [
    ("Observation_ID", "Unique observation identifier", "-", "text", "key"),
    ("Station_ID", "Monitoring station identifier (lake prefix + number)", "-", "text", "key"),
    ("Lake_Name", "Great Lake the station is on", "-", "category", "grouping; interpolation never crosses lakes"),
    ("Latitude", "Station latitude (WGS84, schematic)", "degrees", "float", "coordinates"),
    ("Longitude", "Station longitude (WGS84, schematic)", "degrees", "float", "coordinates"),
    ("Observation_Date", "Sampling date (ISO 8601), every 14 days", "date", "date", "time index"),
    ("Total_Phosphorus", "Total phosphorus concentration", "ug/L", "float", "Kriging, Moran, AHP, bloom model"),
    ("Chlorophyll_a", "Chlorophyll-a concentration", "ug/L", "float", "Kriging, Moran, AHP, bloom model"),
    ("Water_Temperature", "Water temperature", "degC", "float", "Kriging, Moran, AHP, bloom model"),
    ("Turbidity", "Water clarity indicator (higher = less clear)", "NTU", "float", "Kriging, Moran, AHP"),
    ("Dissolved_Oxygen", "Dissolved oxygen concentration", "mg/L", "float", "Kriging, Moran, AHP, bloom model"),
    ("Nitrate", "Nitrate + nitrite as nitrogen", "mg/L", "float", "Kriging, Moran, AHP (not in bloom model)"),
    ("Rainfall", "Recent rainfall indicator", "mm", "float", "Kriged as auxiliary input to the bloom model"),
    ("Season", "Meteorological season of the date", "-", "category", "bloom model"),
    ("Bloom_Observed", "Whether a bloom was observed at the sample (1/0)", "binary", "int", "bloom model target"),
    ("Monitoring_Status", "Monitored (has observations) or Unmonitored (prediction location)", "-", "category", "filter"),
    ("Data_Source", "Always SIMULATED in this prototype", "-", "category", "provenance"),
    ("Data_Status", "SIMULATED_OBSERVED (a simulated station measurement), MISSING (planned sample absent), ESTIMATED_KRIGING (value inferred by Kriging, never mixed into observed data)", "-", "category", "provenance"),
    ("Quality_Flag", "OK, or VALUE_BLANKED when an impossible value was removed during cleaning", "-", "category", "quality"),
]
dict_json = [{"field": f, "description": d, "unit": u, "type": t, "role": r,
              "valid_range": INDICATORS[f]["valid"] if f in INDICATORS else None} for f, d, u, t, r in dictionary]
with open(os.path.join(SRC, "dictionary.json"), "w") as f:
    json.dump(dict_json, f, indent=1)

with open(os.path.join(DOCS, "DATA_DICTIONARY.md"), "w") as f:
    f.write("# GL-WQI data dictionary\n\nAll values are SIMULATED. Plausibility ranges only flag impossible values; they are not water-quality standards.\n\n")
    f.write("| Field | Description | Unit | Type | Role / plausibility range |\n|---|---|---|---|---|\n")
    for f_, d, u, t, r in dictionary:
        rng = f"; range {INDICATORS[f_]['valid'][0]} to {INDICATORS[f_]['valid'][1]}" if f_ in INDICATORS else ""
        f.write(f"| {f_} | {d} | {u} | {t} | {r}{rng} |\n")
    f.write("\n## Files\n\n| File | Contents |\n|---|---|\n")
    for name, desc in [("data/raw/observations_raw.csv", "generator output before cleaning"),
                       ("data/raw/unmonitored_hidden_truth.csv", "simulated truth at the 12 unmonitored locations, used ONLY to validate spatial estimates"),
                       ("public/data/observations.csv", "cleaned wide table (one row per station and date)"),
                       ("public/data/observations_long.csv", "cleaned long table organised by lake, station, indicator, date"),
                       ("public/data/missing_observations.csv", "planned samples that are absent, with gap type"),
                       ("public/data/estimated_missing_values.csv", "Kriging estimates for those gaps (Phase 3), flagged ESTIMATED_KRIGING"),
                       ("src/data/data_quality.json", "machine-readable data quality report shown in the app")]:
        f.write(f"| {name} | {desc} |\n")

with open(os.path.join(DOCS, "DATA_QUALITY_REPORT.md"), "w") as f:
    f.write("# GL-WQI data quality report\n\n")
    f.write(f"All data are SIMULATED. Raw rows: {n_raw}. Clean rows: {n_clean}. Rows removed: {n_raw - n_clean}.\n\n")
    f.write(f"Monitored stations: {len(mon_ids)}. Unmonitored prediction locations: {report['stations_unmonitored']} (no observations by definition). "
            f"Period: {report['date_range'][0]} to {report['date_range'][1]}, planned every {SAMPLING_DAYS} days.\n\n")
    f.write("| Check | Result | Found | Detail |\n|---|---|---|---|\n")
    for i in issues:
        f.write(f"| {i['check']} | {i['severity']} | {i['found']} | {i['detail']} |\n")
    f.write("\n## Station completeness\n\n| Station | Lake | Observations | Missing | Completeness |\n|---|---|---|---|---|\n")
    for s in station_summary:
        f.write(f"| {s['station']} | {s['lake']} | {s['n_obs']} | {s['n_missing']} | {s['completeness_pct']}% |\n")
    f.write("\nThe synthetic generator produces internally consistent values, so only the missing-sample check finds anything. "
            "The other checks are real code paths that would flag and handle problems in real data.\n")

print(f"raw rows {n_raw} -> clean rows {n_clean}")
for i in issues:
    print(f"[{i['severity']:7}] {i['check']}: {i['found']}  {i['detail'][:110]}")
