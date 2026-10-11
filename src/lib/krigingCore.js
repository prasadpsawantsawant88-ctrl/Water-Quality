// Ordinary Kriging, written out in full so every step can be inspected and tested against PyKrige.
// Distances are great-circle km. Variogram parameters: { nugget, psill, range } with range in km (sill = nugget + psill).
//
// System for n stations (zero diagonal; the extra row/column is the unbiasedness constraint, mu is the Lagrange multiplier):
//   [ G  1 ] [ lambda ]   [ g0 ]        G[i][j] = gamma(d_ij),  g0[i] = gamma(d_0i)
//   [ 1' 0 ] [   mu   ] = [ 1  ]
// estimate = sum(lambda_i z_i);   kriging variance = sum(lambda_i g0_i) + mu;   standard error = sqrt(variance)
import { haversineKm, variogramModel } from "./spatialCore.js";

// Gauss-Jordan inverse with partial pivoting. Throws if the matrix is singular.
export function invertMatrix(A) {
  const n = A.length;
  const M = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) throw new Error("Kriging system is singular (stations too close together for this model).");
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c];
    for (let j = 0; j < 2 * n; j++) M[c][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c];
      if (f !== 0) for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((row) => row.slice(n));
}

// Build the kriging system once for a fixed set of stations; then predict at as many points as needed.
// stations: [{ lat, lon, z }] with z on the analysis scale.
export function prepareKriging(stations, model, params) {
  const n = stations.length;
  if (n < 2) throw new Error("Ordinary Kriging needs at least two stations.");
  const gamma = (h) => (h < 1e-9 ? 0 : variogramModel(model, h, params.psill, params.range, params.nugget));
  const A = Array.from({ length: n + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) A[i][j] = i === j ? 0 : gamma(haversineKm(stations[i].lat, stations[i].lon, stations[j].lat, stations[j].lon));
    A[i][n] = 1;
    A[n][i] = 1;
  }
  const inv = invertMatrix(A);
  const z = stations.map((s) => s.z);
  function predict(lat, lon) {
    const rhs = new Array(n + 1);
    let nearest = Infinity;
    for (let i = 0; i < n; i++) {
      const d = haversineKm(lat, lon, stations[i].lat, stations[i].lon);
      nearest = Math.min(nearest, d);
      rhs[i] = gamma(d);
    }
    rhs[n] = 1;
    const sol = inv.map((row) => row.reduce((acc, v, j) => acc + v * rhs[j], 0));
    let est = 0, variance = 0; // variance = sum(lambda g0) + mu = sol . rhs
    for (let i = 0; i <= n; i++) variance += sol[i] * rhs[i];
    for (let i = 0; i < n; i++) est += sol[i] * z[i];
    return { estimate: est, variance: Math.max(variance, 0), se: Math.sqrt(Math.max(variance, 0)), weights: sol.slice(0, n), mu: sol[n], nearestKm: nearest };
  }
  return { predict, n };
}

export function krigeAt(stations, target, model, params) {
  return prepareKriging(stations, model, params).predict(target.lat, target.lon);
}

// Leave-one-station-out cross-validation on one snapshot. Returns one record per station.
export function leaveOneOut(stations, model, params) {
  return stations.map((s, i) => {
    const rest = stations.filter((_, j) => j !== i);
    const r = prepareKriging(rest, model, params).predict(s.lat, s.lon);
    return { index: i, observed: s.z, predicted: r.estimate, se: r.se, error: s.z - r.estimate, std: r.se > 0 ? (s.z - r.estimate) / r.se : NaN };
  });
}

// ME, MAE, RMSE, mean standardized error and RMSSE (about 1 when the kriging variance is realistic) from LOO records.
export function cvMetrics(records) {
  const n = records.length;
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const std = records.map((r) => r.std).filter(Number.isFinite);
  return {
    n,
    me: mean(records.map((r) => r.predicted - r.observed)),
    mae: mean(records.map((r) => Math.abs(r.error))),
    rmse: Math.sqrt(mean(records.map((r) => r.error ** 2))),
    meanStd: std.length ? mean(std) : NaN,
    rmsse: std.length ? Math.sqrt(mean(std.map((v) => v * v))) : NaN,
    coverage95: mean(records.map((r) => (Math.abs(r.error) <= 1.96 * r.se ? 1 : 0))),
  };
}
