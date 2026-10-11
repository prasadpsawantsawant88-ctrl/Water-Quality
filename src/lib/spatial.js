// Spatial estimation for unmonitored locations: inverse-distance weighting (IDW) over same-lake stations.
//   Z(x) = sum(w_i Z_i) / sum(w_i),   w_i = 1 / (d_i + eps)^p
// d_i is the great-circle (haversine) distance in km.
import { monitoredStations, obsByStation, indexAtOrBefore, DAY_MS, RESULTS } from "./data.js";

export const DEFAULT_SPATIAL = {
  power: 2, // distance-decay exponent p
  radiusKm: 150, // only stations within this distance contribute
  k: 4, // maximum number of nearest stations used
  history: 3, // how many recent observations per station feed TP, chlorophyll-a and DO (temperature and rain use the latest only)
  staleDays: 45, // observations older than this are ignored
  farKm: 100, // nearest station beyond this distance is flagged as weak support
  estimator: "kriging", // "kriging" (Ordinary Kriging inputs) or "idw" (inverse-distance weighting, the original method)
};
const EPS_KM = 1;
const HISTORY_WEIGHTS = [1, 0.6, 0.36]; // newest first

export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// polygon = [[lat, lon], ...]
export function pointInPolygon(lat, lon, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Convex hull (monotone chain) of [{lat, lon}] using lon as x and lat as y
export function convexHull(points) {
  const pts = [...points].sort((a, b) => a.lon - b.lon || a.lat - b.lat);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a.lon - o.lon) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lon - o.lon);
  const lower = [];
  pts.forEach((p) => {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  });
  const upper = [];
  [...pts].reverse().forEach((p) => {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  });
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function insideHull(pt, hull) {
  if (hull.length < 3) return false;
  return pointInPolygon(pt.lat, pt.lon, hull.map((h) => [h.lat, h.lon]));
}

function recentObs(stationId, ts, n, maxAgeDays) {
  const arr = obsByStation[stationId];
  let i = indexAtOrBefore(arr, ts);
  const out = [];
  while (i >= 0 && out.length < n) {
    if ((ts - arr[i].ts) / DAY_MS > maxAgeDays) break;
    out.push(arr[i]);
    i--;
  }
  return out;
}

function weightedHistory(hist, key, h) {
  const use = hist.slice(0, h);
  let num = 0;
  let den = 0;
  use.forEach((o, i) => {
    num += o[key] * HISTORY_WEIGHTS[i];
    den += HISTORY_WEIGHTS[i];
  });
  return num / den;
}

// loc = { lat, lon, lake }. excludeId lets us hide a monitored station (leave-one-out).
export function estimateAt(loc, dateStr, sp, excludeId = null) {
  const ts = Date.parse(dateStr);
  const sameLake = monitoredStations
    .filter((s) => s.lake === loc.lake && s.id !== excludeId)
    .map((s) => ({ s, d: haversineKm(loc.lat, loc.lon, s.lat, s.lon) }))
    .sort((a, b) => a.d - b.d);
  const nearest = sameLake.length ? { id: sameLake[0].s.id, name: sameLake[0].s.name, distKm: sameLake[0].d } : null;

  const candidates = sameLake.filter((c) => c.d <= sp.radiusKm).slice(0, sp.k);
  const neighbors = [];
  candidates.forEach((c) => {
    const hist = recentObs(c.s.id, ts, sp.history, sp.staleDays);
    if (!hist.length) return;
    neighbors.push({
      id: c.s.id,
      name: c.s.name,
      lat: c.s.lat,
      lon: c.s.lon,
      distKm: c.d,
      obsDate: hist[0].date,
      ageDays: Math.round((ts - hist[0].ts) / DAY_MS),
      values: {
        tp: weightedHistory(hist, "tp", sp.history),
        chl: weightedHistory(hist, "chl", sp.history),
        doxy: weightedHistory(hist, "doxy", sp.history),
        temp: hist[0].temp,
        rain: hist[0].rain,
      },
    });
  });

  if (!neighbors.length) {
    return { ok: false, nearest, neighbors: [], warnings: ["No monitoring station within the search radius has recent data. No defensible estimate."] };
  }

  const raw = neighbors.map((n) => 1 / (n.distKm + EPS_KM) ** sp.power);
  const total = raw.reduce((a, b) => a + b, 0);
  neighbors.forEach((n, i) => (n.weight = raw[i] / total));
  const est = {};
  ["tp", "chl", "doxy", "temp", "rain"].forEach((k) => {
    est[k] = neighbors.reduce((s, n) => s + n.weight * n.values[k], 0);
  });

  // Interpolation if the location sits inside the area spanned by the contributing stations
  const hull = convexHull(neighbors.map((n) => ({ lat: n.lat, lon: n.lon })));
  const interpolation = neighbors.length >= 3 && insideHull(loc, hull);

  const tpValues = neighbors.map((n) => n.values.tp);
  const tpMean = tpValues.reduce((a, b) => a + b, 0) / tpValues.length;
  const tpSd = tpValues.length > 1 ? Math.sqrt(tpValues.reduce((s, v) => s + (v - tpMean) ** 2, 0) / (tpValues.length - 1)) : 0;
  const tpCV = tpSd / tpMean;

  const warnings = [];
  const nearestUsed = neighbors[0].distKm;
  if (nearestUsed > sp.farKm) warnings.push(`Nearest contributing station is ${nearestUsed.toFixed(0)} km away (weak spatial support).`);
  if (neighbors.length < 3) warnings.push(`Only ${neighbors.length} contributing station(s); estimate is not well constrained.`);
  if (!interpolation) warnings.push("Extrapolation: the location lies outside the area spanned by the contributing stations.");
  if (tpCV > 0.5) warnings.push(`Neighbouring stations disagree strongly on phosphorus (CV ${tpCV.toFixed(2)}); local conditions may differ from the estimate.`);
  const r = RESULTS.ranges;
  const outside = [];
  if (est.tp < r.TP.p01 || est.tp > r.TP.p99) outside.push("phosphorus");
  if (est.chl < r.Chl.p01 || est.chl > r.Chl.p99) outside.push("chlorophyll-a");
  if (est.temp < r.Temp.p01 || est.temp > r.Temp.p99) outside.push("temperature");
  if (outside.length) warnings.push(`Estimated ${outside.join(", ")} fall outside the range the model was trained on.`);

  // Heuristic confidence index (not a statistical confidence interval)
  const distFactor = Math.exp(-nearestUsed / 80);
  const countFactor = Math.min(1, neighbors.length / 3);
  const agreeFactor = 1 / (1 + tpCV);
  const interpFactor = interpolation ? 1 : 0.75;
  const score = distFactor * countFactor * agreeFactor * interpFactor;

  return {
    ok: true, est, neighbors, nearest, interpolation, tpCV, warnings,
    nearestUsedKm: nearestUsed,
    confidence: { score, parts: { distFactor, countFactor, agreeFactor, interpFactor } },
  };
}

export const confidenceLabel = (score) => (score >= 0.6 ? "High" : score >= 0.35 ? "Medium" : "Low");
