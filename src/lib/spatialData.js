// Connects the pure spatial functions to the app's data: station-by-date arrays for every indicator.
import { monitoredStations, observations, DATES } from "./data.js";
import { forwardTransform } from "./spatialCore.js";
import SPATIAL from "../data/spatial_stats.json";

export { SPATIAL };
export const TRAIN_END = "2023-12-31";
export const STALE_DAYS = 45;

// key, label, unit, transform on the analysis scale, decimals to show
export const INDICATORS = {
  tp: { label: "Total phosphorus", short: "TP", unit: "µg/L", transform: "log", digits: 1 },
  chl: { label: "Chlorophyll-a", short: "Chl-a", unit: "µg/L", transform: "log", digits: 1 },
  nitrate: { label: "Nitrate + nitrite", short: "NO₃", unit: "mg/L", transform: "log", digits: 2 },
  temp: { label: "Water temperature", short: "Temp", unit: "°C", transform: "none", digits: 1 },
  doxy: { label: "Dissolved oxygen", short: "DO", unit: "mg/L", transform: "none", digits: 1 },
  turb: { label: "Turbidity", short: "Turb", unit: "NTU", transform: "log", digits: 1 },
  rain: { label: "Recent rainfall (auxiliary input)", short: "Rain", unit: "mm", transform: "log1p", digits: 0 },
};
export const MAIN_INDICATORS = ["tp", "chl", "nitrate", "temp", "doxy", "turb"]; // kriged, in AHP
export const KRIGED_INDICATORS = [...MAIN_INDICATORS, "rain"]; // rain is kriged only as input to the bloom model

const stationIndex = Object.fromEntries(monitoredStations.map((s, i) => [s.id, i]));
const dateIndex = Object.fromEntries(DATES.map((d, i) => [d, i]));

// raw[t][s]: raw observed value or NaN. Built once per indicator.
const rawCache = {};
export function rawCube(key) {
  if (!rawCache[key]) {
    const rows = DATES.map(() => new Array(monitoredStations.length).fill(NaN));
    observations.forEach((o) => {
      rows[dateIndex[o.date]][stationIndex[o.station]] = o[key];
    });
    rawCache[key] = rows;
  }
  return rawCache[key];
}

export function analysisCube(key) {
  return rawCube(key).map((row) => row.map((v) => (Number.isNaN(v) ? NaN : forwardTransform(v, INDICATORS[key].transform))));
}

// Latest raw value per station at or before dateStr, ignoring samples older than staleDays
export function snapshotRaw(key, dateStr, staleDays = STALE_DAYS) {
  const cube = rawCube(key);
  const t = dateIndex[dateStr] ?? DATES.filter((d) => d <= dateStr).length - 1;
  const out = new Array(monitoredStations.length).fill(NaN);
  for (let s = 0; s < out.length; s++) {
    for (let back = 0; back <= Math.ceil(staleDays / 14) && t - back >= 0; back++) {
      const v = cube[t - back][s];
      if (!Number.isNaN(v)) {
        if ((Date.parse(DATES[t]) - Date.parse(DATES[t - back])) / 86400000 <= staleDays) out[s] = v;
        break;
      }
    }
  }
  return out;
}

// Mean per station over a date window; asRaw=false averages the analysis-scale (e.g. log) values (NaN if no samples)
export function stationMean(key, from = DATES[0], to = DATES[DATES.length - 1], asRaw = false) {
  const cube = asRaw ? rawCube(key) : analysisCube(key);
  return monitoredStations.map((_, s) => {
    let sum = 0, n = 0;
    DATES.forEach((d, t) => {
      if (d >= from && d <= to && !Number.isNaN(cube[t][s])) {
        sum += cube[t][s];
        n++;
      }
    });
    return n ? sum / n : NaN;
  });
}

export function analysisRowsBetween(key, from, to) {
  const cube = analysisCube(key);
  return cube.filter((_, t) => DATES[t] >= from && DATES[t] <= to);
}
