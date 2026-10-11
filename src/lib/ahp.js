// Analytic Hierarchy Process: pairwise matrix -> priority weights -> consistency, plus risk-oriented normalisation
// and the weighted composite R(s) = sum_i w_i r_i(s) scaled to 0-100.
// The composite is a relative multi-criteria SCORE. It is not a probability and not a concentration.

export const AHP_KEYS = ["tp", "chl", "nitrate", "temp", "doxy", "turb"];
export const SAATY = [1 / 9, 1 / 8, 1 / 7, 1 / 6, 1 / 5, 1 / 4, 1 / 3, 1 / 2, 1, 2, 3, 4, 5, 6, 7, 8, 9];
export const SAATY_TEXT = { 1: "equal", 3: "moderately more important", 5: "strongly more important", 7: "very strongly more important", 9: "extremely more important" };
export const RANDOM_INDEX = [0, 0, 0.58, 0.9, 1.12, 1.24, 1.32, 1.41, 1.45, 1.49]; // Saaty's table for n = 1..10

// Judgments are stored as the upper triangle, row indicator versus column indicator, keyed "tp|chl" = how much more
// important TP is than chlorophyll-a (1/3 means chlorophyll-a is moderately more important).
// Illustrative defaults: chlorophyll-a and phosphorus lead, temperature next, then oxygen, turbidity and nitrate.
export const DEFAULT_JUDGMENTS = {
  "tp|chl": 1, "tp|nitrate": 3, "tp|temp": 2, "tp|doxy": 3, "tp|turb": 4,
  "chl|nitrate": 4, "chl|temp": 3, "chl|doxy": 3, "chl|turb": 5,
  "nitrate|temp": 1 / 2, "nitrate|doxy": 1 / 2, "nitrate|turb": 1,
  "temp|doxy": 1, "temp|turb": 2,
  "doxy|turb": 2,
};

// Reference ranges are ILLUSTRATIVE planning values, not regulatory criteria. "low" = risk contribution 0,
// "high" = risk contribution 1; for dissolved oxygen low < high is reversed (low oxygen is the risky direction).
export const DEFAULT_NORM = {
  method: "linear", // "linear" (piecewise linear) or "logistic"
  ranges: {
    tp: { low: 5, high: 40 },
    chl: { low: 2, high: 30 },
    nitrate: { low: 0.2, high: 1.0 },
    temp: { low: 10, high: 25 },
    doxy: { low: 12, high: 6 },
    turb: { low: 2, high: 20 },
  },
};
export const DEFAULT_AHP = {
  judgments: DEFAULT_JUDGMENTS,
  crThreshold: 0.1,
  norm: DEFAULT_NORM,
  bands: [25, 50, 75], // AHP score bands: Low < 25 <= Moderate < 50 <= High < 75 <= Critical (illustrative)
};
export const BAND_NAMES = ["Low", "Moderate", "High", "Critical"];

export function fullMatrix(judgments, keys = AHP_KEYS) {
  const n = keys.length;
  const A = Array.from({ length: n }, () => new Array(n).fill(1));
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const v = judgments[`${keys[i]}|${keys[j]}`] ?? 1;
      A[i][j] = v;
      A[j][i] = 1 / v;
    }
  return A;
}

// Principal right eigenvector by power iteration, normalised to sum 1; lambda_max from A w = lambda w.
export function priorityVector(A, tol = 1e-12, maxIter = 1000) {
  const n = A.length;
  let w = new Array(n).fill(1 / n);
  let iterations = 0;
  for (; iterations < maxIter; iterations++) {
    const next = A.map((row) => row.reduce((s, a, j) => s + a * w[j], 0));
    const total = next.reduce((a, b) => a + b, 0);
    const nw = next.map((v) => v / total);
    const diff = Math.max(...nw.map((v, i) => Math.abs(v - w[i])));
    w = nw;
    if (diff < tol) break;
  }
  const Aw = A.map((row) => row.reduce((s, a, j) => s + a * w[j], 0));
  const lambdaMax = Aw.reduce((s, v, i) => s + v / w[i], 0) / n;
  return { weights: w, lambdaMax, iterations };
}

export function consistency(lambdaMax, n, threshold = 0.1) {
  const ci = n > 1 ? (lambdaMax - n) / (n - 1) : 0;
  const ri = RANDOM_INDEX[Math.min(n, 10) - 1];
  const cr = ri > 0 ? ci / ri : 0;
  return { ci, ri, cr, threshold, consistent: cr <= threshold };
}

export function solveAhp(judgments, threshold = 0.1, keys = AHP_KEYS) {
  const A = fullMatrix(judgments, keys);
  const { weights, lambdaMax, iterations } = priorityVector(A);
  const cons = consistency(lambdaMax, keys.length, threshold);
  // the judgment that disagrees most with the weights it produced: a_ij versus w_i / w_j
  let worst = null;
  for (let i = 0; i < keys.length; i++)
    for (let j = i + 1; j < keys.length; j++) {
      const implied = weights[i] / weights[j];
      const ratio = Math.max(A[i][j] / implied, implied / A[i][j]);
      if (!worst || ratio > worst.ratio) worst = { i, j, key: `${keys[i]}|${keys[j]}`, given: A[i][j], implied, ratio };
    }
  return { keys, matrix: A, weights, lambdaMax, iterations, ...cons, worst };
}

// Risk contribution r in [0, 1] for a raw value. For "linear" it is clip((x - low) / (high - low)); for "logistic" an S-curve
// centred half way between low and high that reaches about 0.02 at low and 0.98 at high.
export function normalise(x, range, method = "linear") {
  if (!Number.isFinite(x)) return NaN;
  const { low, high } = range;
  if (low === high) return x >= high ? 1 : 0;
  const t = (x - low) / (high - low); // 0 at the low-risk end, 1 at the high-risk end (also works when high < low)
  if (method === "logistic") return 1 / (1 + Math.exp(-(t - 0.5) * 7.8));
  return Math.min(Math.max(t, 0), 1);
}

export function categoryOf(score, bands = DEFAULT_AHP.bands) {
  return score < bands[0] ? "Low" : score < bands[1] ? "Moderate" : score < bands[2] ? "High" : "Critical";
}

// values: { tp, chl, ... } raw numbers (NaN allowed: the missing indicator is dropped and the remaining weights are rescaled)
export function composite(values, weights, cfg = DEFAULT_AHP, keys = AHP_KEYS) {
  const parts = keys.map((k, i) => {
    const r = normalise(values[k], cfg.norm.ranges[k], cfg.norm.method);
    return { key: k, w: weights[i], r, contribution: Number.isFinite(r) ? weights[i] * r : NaN };
  });
  const usedW = parts.filter((p) => Number.isFinite(p.r)).reduce((s, p) => s + p.w, 0);
  if (usedW === 0) return { score: NaN, category: null, parts, usedWeight: 0 };
  const score = (100 * parts.reduce((s, p) => s + (Number.isFinite(p.r) ? p.w * p.r : 0), 0)) / usedW;
  return { score, category: categoryOf(score, cfg.bands), parts: parts.map((p) => ({ ...p, share: Number.isFinite(p.r) ? (100 * p.w * p.r) / usedW : NaN })), usedWeight: usedW };
}
