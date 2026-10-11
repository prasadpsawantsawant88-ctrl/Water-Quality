// Connects the Kriging core to the app's data. Every function is a plain calculation on the current selections.
import { LAKE_POLYGONS, LAKE_NAMES, stations, DATES } from "./data.js";
import { pointInPolygon } from "./spatial.js";
import { GRID_STEP } from "./gridStep.js";
import { inverseTransform } from "./spatialCore.js";
import { prepareKriging, leaveOneOut, cvMetrics } from "./krigingCore.js";
import { INDICATORS, rawCube, analysisCube } from "./spatialData.js";
import KRIGING from "../data/kriging_results.json";
import SPATIAL from "../data/spatial_stats.json";
import { monitoredStations } from "./data.js";

export { KRIGING };
export const MODELS = ["spherical", "exponential", "gaussian"];
export const SPARSE_KM = 100; // a location this far from every used station is flagged as weakly supported

export const defaultParams = (key, model) => {
  const p = KRIGING.default_params[key][model];
  return { nugget: p.nugget, psill: p.psill, range: p.range };
};

const stationPos = Object.fromEntries(monitoredStations.map((s, i) => [s.id, i]));
const dateIndex = Object.fromEntries(DATES.map((d, i) => [d, i]));

// Stations of one lake that have a sample on dateStr, or (when allowPrev) in the previous 14-day sample.
// z is on the analysis scale (log for TP, Chl-a, nitrate, turbidity), raw is in the original unit.
export function snapshotStations(key, lake, dateStr, allowPrev = true) {
  const t = dateIndex[dateStr];
  const cube = analysisCube(key);
  const raw = rawCube(key);
  const out = [];
  monitoredStations.filter((s) => s.lake === lake).forEach((s) => {
    const i = stationPos[s.id];
    for (let back = 0; back <= (allowPrev ? 1 : 0) && t - back >= 0; back++) {
      if (!Number.isNaN(cube[t - back][i])) {
        out.push({ id: s.id, name: s.name, lat: s.lat, lon: s.lon, z: cube[t - back][i], raw: raw[t - back][i], ageDays: back * 14 });
        break;
      }
    }
  });
  return out;
}

// original-unit estimate and 95% interval from the analysis-scale estimate and standard error
export function backTransform(key, mu, se) {
  const tr = INDICATORS[key].transform;
  return { value: inverseTransform(mu, tr), lower: inverseTransform(mu - 1.96 * se, tr), upper: inverseTransform(mu + 1.96 * se, tr) };
}

// Everything for one lake on one date: prepared system, leave-one-out check, and a function to predict anywhere in the lake.
export function krigeLake({ key, model, params, lake, dateStr, allowPrev = true }) {
  const used = snapshotStations(key, lake, dateStr, allowPrev);
  if (used.length < 3) return { ok: false, lake, used, reason: `Only ${used.length} ${lake} station(s) have a sample for this date; at least 3 are needed.` };
  try {
    const k = prepareKriging(used, model, params);
    const loo = leaveOneOut(used, model, params).map((r, i) => ({ ...r, id: used[i].id }));
    return { ok: true, lake, used, k, loo, metrics: cvMetrics(loo) };
  } catch (e) {
    return { ok: false, lake, used, reason: e.message };
  }
}

// Predict at one point with quality flags and back-transformed value.
export function predictPoint(lakeFit, key, lat, lon) {
  const r = lakeFit.k.predict(lat, lon);
  const total = SPATIAL.variograms[key].total_variance_train;
  const flags = [];
  if (r.nearestKm > SPARSE_KM) flags.push("Far from sampled stations");
  if (lakeFit.used.length < 4) flags.push("Few stations");
  if (r.se ** 2 > 0.8 * total) flags.push("Close to the lake average (little spatial information)");
  const contributions = lakeFit.used.map((s, i) => ({ ...s, weight: r.weights[i] })).sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  return { ...r, ...backTransform(key, r.estimate, r.se), flags, contributions };
}

// Lake-clipped grid cells, built once. A cell exists only inside a lake outline.
let cellCache = null;
export function lakeCells() {
  if (!cellCache) {
    cellCache = [];
    LAKE_NAMES.forEach((lake) => {
      const poly = LAKE_POLYGONS[lake];
      const lats = poly.map((p) => p[0]);
      const lons = poly.map((p) => p[1]);
      for (let lat = Math.min(...lats); lat <= Math.max(...lats); lat += GRID_STEP.lat)
        for (let lon = Math.min(...lons); lon <= Math.max(...lons); lon += GRID_STEP.lon)
          if (pointInPolygon(lat, lon, poly)) cellCache.push({ lat, lon, lake });
    });
  }
  return cellCache;
}

export function lakeOfPoint(lat, lon) {
  return LAKE_NAMES.find((l) => pointInPolygon(lat, lon, LAKE_POLYGONS[l])) || null;
}

export const allLocations = stations.map((s) => ({ ...s }));

// ---- Kriged inputs for the bloom model (alternative to inverse-distance weighting) ---------------------------------
// Uses each same-lake station's sample for the date (or the previous 14-day sample), the best variogram by cross-validation,
// and returns the median (back-transformed) estimate for the five inputs of the early-warning model.
const fitCache = new Map();
function cachedLake(key, lake, dateStr) {
  const id = `${key}|${lake}|${dateStr}`;
  if (!fitCache.has(id)) {
    const model = KRIGING.best_by_cv[key];
    const used = snapshotStations(key, lake, dateStr, true);
    let fit = { ok: false, used };
    if (used.length >= 3) {
      try { fit = { ok: true, used, k: prepareKriging(used, model, defaultParams(key, model)) }; } catch { /* leave as not ok */ }
    }
    fitCache.set(id, fit);
  }
  return fitCache.get(id);
}
export function krigedInputs(loc, dateStr) {
  const est = {}, se = {};
  for (const key of ["tp", "chl", "doxy", "temp", "rain"]) {
    const f = cachedLake(key, loc.lake, dateStr);
    if (!f.ok) return null;
    const r = f.k.predict(loc.lat, loc.lon);
    est[key] = inverseTransform(r.estimate, INDICATORS[key].transform);
    se[key] = r.se;
  }
  return { est, se };
}
