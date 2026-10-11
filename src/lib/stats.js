// Small statistics helpers (plain functions, no dependencies).
export const sum = (a) => a.reduce((s, v) => s + v, 0);
export const mean = (a) => (a.length ? sum(a) / a.length : NaN);
export function std(a) {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return Math.sqrt(sum(a.map((v) => (v - m) ** 2)) / (a.length - 1));
}
export function quantile(a, q) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
export const median = (a) => quantile(a, 0.5);

export function pearson(x, y) {
  const n = Math.min(x.length, y.length);
  if (n < 3) return NaN;
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}

// Ordinary least squares y = a + b x
export function linearFit(x, y) {
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  const b = sxy / sxx;
  return { slope: b, intercept: my - b * mx, r2: syy === 0 ? 0 : (sxy * sxy) / (sxx * syy), n: x.length };
}

// Univariate logistic regression P(y=1) = 1/(1+exp(-(a + b x))) fitted by Newton-Raphson
export function logisticFit1D(x, y) {
  let a = 0;
  let b = 0;
  for (let iter = 0; iter < 50; iter++) {
    let g0 = 0, g1 = 0, h00 = 0, h01 = 0, h11 = 0;
    for (let i = 0; i < x.length; i++) {
      const p = 1 / (1 + Math.exp(-(a + b * x[i])));
      const w = p * (1 - p) + 1e-9;
      g0 += y[i] - p;
      g1 += (y[i] - p) * x[i];
      h00 += w;
      h01 += w * x[i];
      h11 += w * x[i] * x[i];
    }
    const det = h00 * h11 - h01 * h01;
    if (!isFinite(det) || Math.abs(det) < 1e-12) break;
    const da = (h11 * g0 - h01 * g1) / det;
    const db = (-h01 * g0 + h00 * g1) / det;
    a += da;
    b += db;
    if (Math.abs(da) + Math.abs(db) < 1e-8) break;
  }
  return { a, b };
}

export function histogram(values, bins, lo, hi) {
  const min = lo ?? Math.min(...values);
  const max = hi ?? Math.max(...values);
  const width = (max - min) / bins || 1;
  const out = Array.from({ length: bins }, (_, i) => ({ x0: min + i * width, x1: min + (i + 1) * width, count: 0 }));
  values.forEach((v) => {
    let k = Math.floor((v - min) / width);
    if (k >= bins) k = bins - 1;
    if (k >= 0) out[k].count += 1;
  });
  return out;
}

export function groupBy(arr, keyFn) {
  const m = {};
  arr.forEach((r) => {
    const k = keyFn(r);
    (m[k] = m[k] || []).push(r);
  });
  return m;
}

export const fmt = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? "n/a" : Number(v).toFixed(d));
export const pct = (v, d = 0) => (v === null || v === undefined || Number.isNaN(v) ? "n/a" : (v * 100).toFixed(d) + "%");

// ROC curve and AUC from labels and scores
export function rocCurve(y, p) {
  const idx = y.map((_, i) => i).sort((a, b) => p[b] - p[a]);
  const P = sum(y);
  const N = y.length - P;
  let tp = 0, fp = 0;
  const pts = [{ fpr: 0, tpr: 0 }];
  let auc = 0;
  let prevF = 0, prevT = 0;
  idx.forEach((i, k) => {
    if (y[i] === 1) tp++;
    else fp++;
    const last = k === idx.length - 1 || p[idx[k + 1]] !== p[i];
    if (last) {
      const f = fp / N;
      const t = tp / P;
      auc += ((f - prevF) * (t + prevT)) / 2;
      pts.push({ fpr: f, tpr: t });
      prevF = f;
      prevT = t;
    }
  });
  return { points: pts, auc };
}

export function confusionAt(y, p, thr) {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  y.forEach((yy, i) => {
    const pred = p[i] >= thr ? 1 : 0;
    if (pred && yy) tp++;
    else if (pred && !yy) fp++;
    else if (!pred && yy) fn++;
    else tn++;
  });
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { tp, fp, tn, fn, precision, recall, f1 };
}
