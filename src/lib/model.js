// Evaluates the FITTED models exported by scripts/generate_data.py.
// Logistic regression: standardised inputs x coefficients. Random forest: walks the exported trees.
import { MODELS, RESULTS, SEASONS } from "./data.js";
import { mean } from "./stats.js";

// x = { tp, chl, temp, rain, doxy, season }
function featureValue(name, x) {
  switch (name) {
    case "lnTP": return Math.log(Math.max(x.tp, 0.01));
    case "lnChl": return Math.log(Math.max(x.chl, 0.01));
    case "TP": return x.tp;
    case "Chl": return x.chl;
    case "Temp": return x.temp;
    case "Rain": return x.rain;
    case "Rain2": return x.rain * x.rain;
    case "DO": return x.doxy;
    case "Spring": return x.season === "Spring" ? 1 : 0;
    case "Summer": return x.season === "Summer" ? 1 : 0;
    case "Autumn": return x.season === "Autumn" ? 1 : 0;
    default: return 0;
  }
}

export function lrLogit(cfg, x) {
  const m = MODELS[cfg].lr;
  let z = m.intercept_std;
  m.features.forEach((f, i) => {
    z += m.coef_std[i] * ((featureValue(f, x) - m.mu[i]) / m.sd[i]);
  });
  return z;
}

export function predictLR(cfg, x) {
  return 1 / (1 + Math.exp(-lrLogit(cfg, x)));
}

// returns { p, spread } where spread = standard deviation of the individual tree probabilities
export function predictRF(cfg, x) {
  const m = MODELS[cfg].rf;
  const vec = m.features.map((f) => featureValue(f, x));
  const probs = m.trees.map((t) => {
    let node = 0;
    while (t.l[node] !== -1) node = vec[t.f[node]] <= t.t[node] ? t.l[node] : t.r[node];
    return t.v[node];
  });
  const p = mean(probs);
  const spread = Math.sqrt(mean(probs.map((v) => (v - p) ** 2)));
  return { p, spread };
}

// modelKey: "lr" | "rf" | "avg"
export function predict(modelKey, cfg, x) {
  const pLR = predictLR(cfg, x);
  const rf = predictRF(cfg, x);
  const p = modelKey === "lr" ? pLR : modelKey === "rf" ? rf.p : (pLR + rf.p) / 2;
  return { p, pLR, pRF: rf.p, treeSpread: rf.spread };
}

export const VARIABLE_LABELS = {
  tp: "Total phosphorus",
  chl: "Chlorophyll-a",
  temp: "Water temperature",
  rain: "Rainfall",
  doxy: "Dissolved oxygen",
  season: "Season",
};

// One-at-a-time effect: how much the probability would change if this variable were set to its typical value.
// Positive = the variable is pushing risk up relative to typical conditions.
export function contributions(modelKey, cfg, x) {
  const ref = RESULTS.reference;
  const p0 = predict(modelKey, cfg, x).p;
  const swaps = { tp: ref.TP, chl: ref.Chl, temp: ref.Temp, rain: ref.Rain, doxy: ref.DO };
  const out = Object.keys(swaps).map((k) => ({
    key: k,
    label: VARIABLE_LABELS[k],
    delta: p0 - predict(modelKey, cfg, { ...x, [k]: swaps[k] }).p,
  }));
  const seasonMean = mean(SEASONS.map((s) => predict(modelKey, cfg, { ...x, season: s }).p));
  out.push({ key: "season", label: VARIABLE_LABELS.season, delta: p0 - seasonMean });
  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}
