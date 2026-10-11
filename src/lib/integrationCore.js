// Kriging + AHP for one location. Pure functions (no app data), so the same code runs in the app and in the validation script.
//   1. each indicator is kriged: estimate mu and standard error se on the analysis scale
//   2. the estimate (median, back-transformed) is normalised to r in [0, 1] and combined with the AHP weights -> score 0-100
//   3. Monte Carlo: draw each indicator from N(mu, se^2) on the analysis scale, back-transform, rescore.
//      The spread of those scores is the risk interval; the share of draws at or above the threshold is the exceedance probability.
// Only Kriging uncertainty is propagated. Variogram error, weight (judgment) uncertainty and temporal change are not.
import { AHP_KEYS, composite, normalise } from "./ahp.js";
import { gaussianRandom, inverseTransform, mulberry32 } from "./spatialCore.js";

export const DEFAULT_INTEGRATION = { nSim: 1000, rho: 0, threshold: 50, seed: 1 };

const quantile = (sorted, q) => {
  const x = (sorted.length - 1) * q;
  const i = Math.floor(x);
  return sorted[i] + (sorted[Math.min(i + 1, sorted.length - 1)] - sorted[i]) * (x - i);
};

// est: { tp: { mu, se, transform }, ... }  (analysis scale)
export function assessLocation(est, weights, ahpCfg, opts = {}, keys = AHP_KEYS) {
  const { nSim, rho, threshold, seed } = { ...DEFAULT_INTEGRATION, ...opts };
  const rawOf = (k, z) => inverseTransform(z, est[k].transform);
  const point = composite(Object.fromEntries(keys.map((k) => [k, rawOf(k, est[k].mu)])), weights, ahpCfg, keys);

  const rand = mulberry32(seed);
  const scores = new Array(nSim);
  const sr = Math.sqrt(Math.min(Math.max(rho, 0), 0.99)), si = Math.sqrt(1 - Math.min(Math.max(rho, 0), 0.99));
  for (let s = 0; s < nSim; s++) {
    const common = gaussianRandom(rand); // shared component when indicator errors are assumed correlated
    const vals = {};
    keys.forEach((k) => {
      vals[k] = rawOf(k, est[k].mu + est[k].se * (sr * common + si * gaussianRandom(rand)));
    });
    scores[s] = composite(vals, weights, ahpCfg, keys).score;
  }
  scores.sort((a, b) => a - b);
  const hist = Array.from({ length: 20 }, (_, b) => ({ from: b * 5, to: b * 5 + 5, count: 0 })); // 5-point bins of the simulated scores
  scores.forEach((v) => { hist[Math.min(Math.floor(v / 5), 19)].count++; });
  const mean = scores.reduce((a, b) => a + b, 0) / nSim;
  const mc = {
    n: nSim, mean, p05: quantile(scores, 0.05), p25: quantile(scores, 0.25), p50: quantile(scores, 0.5), p75: quantile(scores, 0.75), p95: quantile(scores, 0.95),
    hist, pExceed: scores.filter((v) => v >= threshold).length / nSim, threshold, rho,
  };
  // how many score points one standard error of each indicator moves the result (a guide to where to sample)
  const drivers = keys.map((k, i) => {
    const lo = normalise(rawOf(k, est[k].mu - est[k].se), ahpCfg.norm.ranges[k], ahpCfg.norm.method);
    const hi = normalise(rawOf(k, est[k].mu + est[k].se), ahpCfg.norm.ranges[k], ahpCfg.norm.method);
    return { key: k, pointsPerSE: (100 * weights[i] * Math.abs(hi - lo)) / 2 };
  }).sort((a, b) => b.pointsPerSE - a.pointsPerSE);
  return { score: point.score, category: point.category, parts: point.parts, mc, drivers };
}

// Recommended monitoring action from the exceedance probability, interval width and distance to the nearest used station.
export function monitoringAction(mc, nearestKm, sparseKm = 100) {
  const width = mc.p95 - mc.p05;
  if (mc.pExceed >= 0.5) return { level: "Priority", text: "Field-sample within 7 days; the estimate says this location is more likely than not to reach the threshold.", rank: 3 };
  if (mc.pExceed >= 0.2) return { level: "Soon", text: "Add to the next scheduled sampling run (within 14 days).", rank: 2 };
  if (width > 25 || nearestKm > sparseKm) return { level: "Reduce uncertainty", text: "Estimate is poorly constrained; a targeted sample (or a new station) would confirm it.", rank: 1 };
  return { level: "Routine", text: "Rely on the interpolation; revisit at the next scheduled review.", rank: 0 };
}
