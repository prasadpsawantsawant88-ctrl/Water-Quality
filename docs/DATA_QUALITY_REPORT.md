# GL-WQI data quality report

All data are SIMULATED. Raw rows: 6324. Clean rows: 6324. Rows removed: 0.

Monitored stations: 31. Unmonitored prediction locations: 12 (no observations by definition). Period: 2018-01-02 to 2025-12-23, planned every 14 days.

| Check | Result | Found | Detail |
|---|---|---|---|
| Required columns present | pass | 0 | all 16 required columns found |
| Dates parse as ISO dates | pass | 0 | all dates parsed |
| Duplicate Observation_ID | pass | 0 | rows sharing an Observation_ID |
| Duplicate station-date records | pass | 0 | second and later records for the same station and date (dropped) |
| Coordinates numeric and in range | pass | 0 | rows with invalid latitude/longitude (dropped) |
| One coordinate pair per station | pass | 0 | stations whose coordinates change between rows |
| Stations lie inside their lake outline | pass | 0 | stations outside the (schematic) lake polygon |
| Lake name matches station register | pass | 0 | rows whose lake differs from the station register |
| Season consistent with date | pass | 0 | rows where Season does not match the month |
| Bloom_Observed is binary | pass | 0 | values other than 0 or 1 |
| Monitoring_Status values | pass | 0 | monitored-station file should contain only 'Monitored' |
| Values inside physical plausibility range | pass | 0 | per-indicator counts: {'Total_Phosphorus': 0, 'Chlorophyll_a': 0, 'Dissolved_Oxygen': 0, 'Turbidity': 0, 'Nitrate': 0, 'Water_Temperature': 0, 'Rainfall': 0} (blanked) |
| Missing indicator values in delivered rows | pass | 0 | per-indicator counts: {'Total_Phosphorus': 0, 'Chlorophyll_a': 0, 'Dissolved_Oxygen': 0, 'Turbidity': 0, 'Nitrate': 0, 'Water_Temperature': 0, 'Rainfall': 0} |
| Unit consistency (station medians within 30x of overall median) | pass | 0 | no station is off by an order of magnitude or more |
| Planned station-date samples present | info | 155 | 155 of 6479 planned samples absent (2.4%); 30 in outages (3+ consecutive), 125 isolated |

## Station completeness

| Station | Lake | Observations | Missing | Completeness |
|---|---|---|---|---|
| SUP-01 | Superior | 205 | 4 | 98.1% |
| SUP-02 | Superior | 203 | 6 | 97.1% |
| SUP-03 | Superior | 200 | 9 | 95.7% |
| SUP-04 | Superior | 205 | 4 | 98.1% |
| SUP-05 | Superior | 204 | 5 | 97.6% |
| SUP-06 | Superior | 204 | 5 | 97.6% |
| MIC-01 | Michigan | 206 | 3 | 98.6% |
| MIC-02 | Michigan | 206 | 3 | 98.6% |
| MIC-03 | Michigan | 205 | 4 | 98.1% |
| MIC-04 | Michigan | 207 | 2 | 99.0% |
| MIC-05 | Michigan | 193 | 16 | 92.3% |
| MIC-06 | Michigan | 208 | 1 | 99.5% |
| HUR-01 | Huron | 203 | 6 | 97.1% |
| HUR-02 | Huron | 205 | 4 | 98.1% |
| HUR-03 | Huron | 206 | 3 | 98.6% |
| HUR-04 | Huron | 202 | 7 | 96.7% |
| HUR-05 | Huron | 198 | 11 | 94.7% |
| HUR-06 | Huron | 205 | 4 | 98.1% |
| ERI-01 | Erie | 205 | 4 | 98.1% |
| ERI-02 | Erie | 206 | 3 | 98.6% |
| ERI-03 | Erie | 203 | 6 | 97.1% |
| ERI-04 | Erie | 206 | 3 | 98.6% |
| ERI-05 | Erie | 204 | 5 | 97.6% |
| ERI-06 | Erie | 199 | 10 | 95.2% |
| ERI-07 | Erie | 205 | 4 | 98.1% |
| ONT-01 | Ontario | 206 | 3 | 98.6% |
| ONT-02 | Ontario | 206 | 3 | 98.6% |
| ONT-03 | Ontario | 206 | 3 | 98.6% |
| ONT-04 | Ontario | 201 | 8 | 96.2% |
| ONT-05 | Ontario | 207 | 2 | 99.0% |
| ONT-06 | Ontario | 205 | 4 | 98.1% |

The synthetic generator produces internally consistent values, so only the missing-sample check finds anything. The other checks are real code paths that would flag and handle problems in real data.
