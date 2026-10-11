# GL-WQI data dictionary

All values are SIMULATED. Plausibility ranges only flag impossible values; they are not water-quality standards.

| Field | Description | Unit | Type | Role / plausibility range |
|---|---|---|---|---|
| Observation_ID | Unique observation identifier | - | text | key |
| Station_ID | Monitoring station identifier (lake prefix + number) | - | text | key |
| Lake_Name | Great Lake the station is on | - | category | grouping; interpolation never crosses lakes |
| Latitude | Station latitude (WGS84, schematic) | degrees | float | coordinates |
| Longitude | Station longitude (WGS84, schematic) | degrees | float | coordinates |
| Observation_Date | Sampling date (ISO 8601), every 14 days | date | date | time index |
| Total_Phosphorus | Total phosphorus concentration | ug/L | float | Kriging, Moran, AHP, bloom model; range 0.0 to 500.0 |
| Chlorophyll_a | Chlorophyll-a concentration | ug/L | float | Kriging, Moran, AHP, bloom model; range 0.0 to 500.0 |
| Water_Temperature | Water temperature | degC | float | Kriging, Moran, AHP, bloom model; range -1.0 to 35.0 |
| Turbidity | Water clarity indicator (higher = less clear) | NTU | float | Kriging, Moran, AHP; range 0.0 to 1000.0 |
| Dissolved_Oxygen | Dissolved oxygen concentration | mg/L | float | Kriging, Moran, AHP, bloom model; range 0.0 to 20.0 |
| Nitrate | Nitrate + nitrite as nitrogen | mg/L | float | Kriging, Moran, AHP (not in bloom model); range 0.0 to 20.0 |
| Rainfall | Recent rainfall indicator | mm | float | Kriged as auxiliary input to the bloom model; range 0.0 to 500.0 |
| Season | Meteorological season of the date | - | category | bloom model |
| Bloom_Observed | Whether a bloom was observed at the sample (1/0) | binary | int | bloom model target |
| Monitoring_Status | Monitored (has observations) or Unmonitored (prediction location) | - | category | filter |
| Data_Source | Always SIMULATED in this prototype | - | category | provenance |
| Data_Status | SIMULATED_OBSERVED (a simulated station measurement), MISSING (planned sample absent), ESTIMATED_KRIGING (value inferred by Kriging, never mixed into observed data) | - | category | provenance |
| Quality_Flag | OK, or VALUE_BLANKED when an impossible value was removed during cleaning | - | category | quality |

## Files

| File | Contents |
|---|---|
| data/raw/observations_raw.csv | generator output before cleaning |
| data/raw/unmonitored_hidden_truth.csv | simulated truth at the 12 unmonitored locations, used ONLY to validate spatial estimates |
| public/data/observations.csv | cleaned wide table (one row per station and date) |
| public/data/observations_long.csv | cleaned long table organised by lake, station, indicator, date |
| public/data/missing_observations.csv | planned samples that are absent, with gap type |
| public/data/estimated_missing_values.csv | Kriging estimates for those gaps (Phase 3), flagged ESTIMATED_KRIGING |
| src/data/data_quality.json | machine-readable data quality report shown in the app |
