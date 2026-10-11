// Pure spatial-statistics functions (no app data, no imports) so they can be unit-tested in Node.
// Algorithms match scripts/spatial_common.py line for line; tests/ checks the two agree.
//
// Conventions: great-circle (haversine) distances in km on a sphere of radius 6371 km, variogram ranges in km,
// spatial relationships only between stations on the SAME lake unless explicitly allowed.

export const R_EARTH = 6371;

export function haversineKm(lat1, lon1, lat2, lon2) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(a));
}

// Seeded random numbers so permutation tests and Monte Carlo runs are reproducible
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function gaussianRandom(rand) {
  // Box-Muller
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}
function shuffleInPlace(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

// ------------------------------------------------------------------ transforms
export function forwardTransform(x, kind) {
  if (kind === "log") return Math.log(x);
  if (kind === "log1p") return Math.log1p(x);
  return x;
}
export function inverseTransform(x, kind) {
  if (kind === "log") return Math.exp(x);
  if (kind === "log1p") return Math.expm1(x);
  return x;
}

// ------------------------------------------------------------------ variogram models (same definitions as PyKrige)
export const VARIOGRAM_MODELS = ["spherical", "exponential", "gaussian"];

export function variogramModel(name, h, psill, range, nugget) {
  if (name === "spherical") return h <= range ? psill * (1.5 * (h / range) - 0.5 * (h / range) ** 3) + nugget : psill + nugget;
  if (name === "exponential") return psill * (1 - Math.exp(-h / (range / 3))) + nugget;
  if (name === "gaussian") return psill * (1 - Math.exp(-(h * h) / ((range * 4) / 7) ** 2)) + nugget;
  throw new Error("unknown variogram model " + name);
}

export const RANGE_GRID = Array.from({ length: 296 }, (_, i) => 10 + 2 * i); // 10 ... 600 km

// Weighted least squares. For every candidate range the nugget and partial sill are linear and solved exactly
// (kept non-negative); the range with the smallest weighted residual is returned.
export function fitVariogram(name, h, gamma, w) {
  let best = null;
  for (const r of RANGE_GRID) {
    let sw = 0, swp = 0, swpp = 0, swg = 0, swpg = 0;
    for (let k = 0; k < h.length; k++) {
      const phi = variogramModel(name, h[k], 1, r, 0);
      sw += w[k];
      swp += w[k] * phi;
      swpp += w[k] * phi * phi;
      swg += w[k] * gamma[k];
      swpg += w[k] * phi * gamma[k];
    }
    const det = sw * swpp - swp * swp;
    if (Math.abs(det) < 1e-12) continue;
    let nug = (swpp * swg - swp * swpg) / det;
    let ps = (sw * swpg - swp * swg) / det;
    if (nug < 0) {
      nug = 0;
      ps = swpp > 0 ? swpg / swpp : 0;
    }
    if (ps < 0) {
      ps = 0;
      nug = swg / sw;
    }
    let wrss = 0;
    for (let k = 0; k < h.length; k++) {
      const phi = variogramModel(name, h[k], 1, r, 0);
      wrss += w[k] * (gamma[k] - (nug + ps * phi)) ** 2;
    }
    if (best === null || wrss < best.wrss - 1e-15) best = { model: name, nugget: nug, psill: ps, range: r, wrss };
  }
  best.sill = best.nugget + best.psill;
  const totalW = w.reduce((a, b) => a + b, 0);
  best.rmse = Math.sqrt(best.wrss / totalW);
  best.range_at_limit = best.range >= RANGE_GRID[RANGE_GRID.length - 1];
  return best;
}

export function fitAllModels(bins) {
  const h = bins.map((b) => b.h);
  const g = bins.map((b) => b.gamma);
  const w = bins.map((b) => b.n_pairs);
  const out = {};
  VARIOGRAM_MODELS.forEach((m) => (out[m] = fitVariogram(m, h, g, w)));
  return out;
}

// stations: [{id, lake, lat, lon}] (monitored only). Returns pairs of stations on the same lake.
export function lakePairs(stations, onlyLake = null) {
  const pairs = [];
  for (let a = 0; a < stations.length; a++) {
    for (let b = a + 1; b < stations.length; b++) {
      if (stations[a].lake !== stations[b].lake) continue; // never pair stations on different lakes
      if (onlyLake && stations[a].lake !== onlyLake) continue;
      pairs.push({ a, b, d: haversineKm(stations[a].lat, stations[a].lon, stations[b].lat, stations[b].lon) });
    }
  }
  return pairs;
}

// rows: array of snapshots (each an array over stations on the analysis scale, NaN where missing).
// Semivariance = mean of 0.5*(zi - zj)^2 over the pairs in a distance bin and over all snapshots.
export function experimentalVariogram(rows, pairs, lag, cutoff) {
  const nb = Math.ceil(cutoff / lag);
  const out = [];
  for (let k = 0; k < nb; k++) {
    const lo = k * lag;
    const hi = (k + 1) * lag;
    const sel = pairs.filter((p) => p.d > lo && p.d <= hi && p.d <= cutoff);
    if (!sel.length) continue;
    let sum = 0;
    let n = 0;
    sel.forEach((p) => {
      rows.forEach((row) => {
        const zi = row[p.a];
        const zj = row[p.b];
        if (Number.isNaN(zi) || Number.isNaN(zj)) return;
        sum += 0.5 * (zi - zj) ** 2;
        n++;
      });
    });
    if (n === 0) continue;
    out.push({ h: sel.reduce((s, p) => s + p.d, 0) / sel.length, gamma: sum / n, n_pairs: sel.length, n_obs: n });
  }
  return out;
}

// ------------------------------------------------------------------ spatial weights
// opts: { kind: "knn"|"band"|"idw", k, bandKm, power, sameLake, standardize }
export function buildWeights(stations, opts) {
  const { kind = "knn", k = 4, bandKm = 120, power = 1, sameLake = true, standardize = true } = opts;
  const n = stations.length;
  const D = stations.map((s) => stations.map((t) => haversineKm(s.lat, s.lon, t.lat, t.lon)));
  const neigh = [];
  const wts = [];
  for (let i = 0; i < n; i++) {
    let cand = [];
    for (let j = 0; j < n; j++) if (j !== i && (!sameLake || stations[j].lake === stations[i].lake)) cand.push(j);
    cand.sort((x, y) => D[i][x] - D[i][y] || x - y);
    cand = kind === "knn" ? cand.slice(0, k) : cand.filter((j) => D[i][j] <= bandKm);
    let w = cand.map((j) => (kind === "idw" ? 1 / D[i][j] ** power : 1));
    if (standardize && w.length) {
      const s = w.reduce((a, b) => a + b, 0);
      w = w.map((x) => x / s);
    }
    neigh.push(cand);
    wts.push(w);
  }
  return { neigh, wts };
}

function denseW(neigh, wts) {
  const n = neigh.length;
  const W = Array.from({ length: n }, () => new Array(n).fill(0));
  neigh.forEach((nb, i) => nb.forEach((j, idx) => (W[i][j] = wts[i][idx])));
  return W;
}

// ------------------------------------------------------------------ Moran's I
function demean(z) {
  const m = z.reduce((a, b) => a + b, 0) / z.length;
  return z.map((v) => v - m);
}

export function moranStat(z, neigh, wts) {
  const zc = demean(z);
  let s0 = 0;
  let num = 0;
  neigh.forEach((nb, i) => nb.forEach((j, idx) => {
    s0 += wts[i][idx];
    num += wts[i][idx] * zc[i] * zc[j];
  }));
  const den = zc.reduce((a, v) => a + v * v, 0);
  return s0 > 0 && den > 0 ? (z.length / s0) * (num / den) : NaN;
}

// Expected value and analytic z-score under the normality assumption (same as PySAL z_norm)
export function moranNormal(z, neigh, wts) {
  const n = z.length;
  const W = denseW(neigh, wts);
  let s0 = 0, s1 = 0, s2 = 0;
  for (let i = 0; i < n; i++) {
    let row = 0, col = 0;
    for (let j = 0; j < n; j++) {
      s0 += W[i][j];
      s1 += 0.5 * (W[i][j] + W[j][i]) ** 2;
      row += W[i][j];
      col += W[j][i];
    }
    s2 += (row + col) ** 2;
  }
  const ei = -1 / (n - 1);
  const vi = (n * n * s1 - n * s2 + 3 * s0 * s0) / ((n * n - 1) * s0 * s0) - ei * ei;
  return { expected: ei, z_norm: (moranStat(z, neigh, wts) - ei) / Math.sqrt(vi) };
}

function permuted(z, groups, rand, scheme) {
  if (scheme === "within_lake") {
    const out = z.slice();
    const byGroup = {};
    groups.forEach((g, i) => (byGroup[g] = byGroup[g] || []).push(i));
    Object.values(byGroup).forEach((idx) => {
      const vals = shuffleInPlace(idx.map((i) => z[i]), rand);
      idx.forEach((i, k) => (out[i] = vals[k]));
    });
    return out;
  }
  return shuffleInPlace(z.slice(), rand);
}

// Two-sided pseudo p-value. Ties count toward both tails so they can never fake significance.
function pseudoP(sims, obs) {
  let up = 0, lo = 0;
  sims.forEach((s) => {
    if (s >= obs) up++;
    if (s <= obs) lo++;
  });
  const m = sims.length;
  return Math.min(1, 2 * Math.min((up + 1) / (m + 1), (lo + 1) / (m + 1)));
}

export function globalMoran(z, groups, neigh, wts, perms = 999, scheme = "all", seed = 1) {
  const rand = mulberry32(seed);
  const I = moranStat(z, neigh, wts);
  const sims = [];
  for (let r = 0; r < perms; r++) sims.push(moranStat(permuted(z, groups, rand, scheme), neigh, wts));
  const mean = sims.reduce((a, b) => a + b, 0) / perms;
  const sd = Math.sqrt(sims.reduce((a, v) => a + (v - mean) ** 2, 0) / (perms - 1));
  const normal = moranNormal(z, neigh, wts);
  return { I, expected: normal.expected, z_norm: normal.z_norm, perm_mean: mean, perm_sd: sd, z_perm: sd > 0 ? (I - mean) / sd : NaN, p_perm_two_sided: pseudoP(sims, I), perms, scheme, sims };
}

// Local Moran: I_i = (z_i / m2) * sum_j w_ij z_j, m2 = sum(z^2)/(n-1) (PySAL convention); conditional permutation.
export function localMoran(z, groups, neigh, wts, perms = 999, scheme = "within_lake", seed = 1) {
  const rand = mutableRand(seed);
  const n = z.length;
  const zc = demean(z);
  const m2 = zc.reduce((a, v) => a + v * v, 0) / (n - 1);
  const lagOf = (vals, i) => neigh[i].reduce((s, j, idx) => s + wts[i][idx] * vals[j], 0);
  const out = [];
  for (let i = 0; i < n; i++) {
    const lag = lagOf(zc, i);
    const Ii = (zc[i] / m2) * lag;
    const pool = [];
    for (let j = 0; j < n; j++) if (j !== i && (scheme !== "within_lake" || groups[j] === groups[i])) pool.push(j);
    const sims = [];
    for (let r = 0; r < perms; r++) {
      const vals = zc.slice();
      const shuffled = shuffleInPlace(pool.map((j) => zc[j]), rand);
      pool.forEach((j, k) => (vals[j] = shuffled[k]));
      sims.push((zc[i] / m2) * lagOf(vals, i));
    }
    const quadrant = zc[i] > 0 && lag > 0 ? "HH" : zc[i] < 0 && lag < 0 ? "LL" : zc[i] > 0 && lag < 0 ? "HL" : "LH";
    out.push({ I: Ii, p: pseudoP(sims, Ii), quadrant, z: zc[i], lag });
  }
  return out;
}
const mutableRand = mulberry32;

export function benjaminiHochberg(p, alpha = 0.05) {
  const n = p.length;
  const order = p.map((v, i) => i).sort((a, b) => p[a] - p[b]);
  let k = 0;
  order.forEach((idx, rank) => {
    if (p[idx] <= (alpha * (rank + 1)) / n) k = rank + 1;
  });
  const sig = new Array(n).fill(false);
  order.slice(0, k).forEach((idx) => (sig[idx] = true));
  return sig;
}
