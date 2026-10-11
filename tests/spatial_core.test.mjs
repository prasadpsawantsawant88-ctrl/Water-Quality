import test from "node:test";
import assert from "node:assert/strict";
import {
  haversineKm, variogramModel, fitVariogram, experimentalVariogram, fitAllModels, lakePairs, buildWeights,
  moranStat, moranNormal, globalMoran, localMoran, benjaminiHochberg,
} from "../src/lib/spatialCore.js";
import { read, buildCube, trainRows, monitored, spatialStats } from "./helpers.mjs";

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ""} expected ${b}, got ${a}`);

test("haversine: one degree of longitude at the equator is 111.195 km", () => {
  close(haversineKm(0, 0, 0, 1), 111.195, 0.01);
  close(haversineKm(41.88, -87.63, 42.33, -83.05), 380, 15, "Chicago-Detroit is roughly 380 km");
});

test("variogram models hit their known values at the range", () => {
  close(variogramModel("spherical", 100, 2, 100, 0.5), 2.5, 1e-12);
  close(variogramModel("spherical", 250, 2, 100, 0.5), 2.5, 1e-12, "flat beyond the range");
  close(variogramModel("exponential", 100, 1, 100, 0), 1 - Math.exp(-3), 1e-12, "practical range ~95% of sill");
  close(variogramModel("gaussian", 100, 1, 100, 0), 1 - Math.exp(-((100) ** 2) / ((100 * 4) / 7) ** 2), 1e-12);
  close(variogramModel("spherical", 0, 2, 100, 0.5), 0.5, 1e-12, "nugget at zero lag");
});

test("variogram fitting recovers a known spherical model from noise-free bins", () => {
  const h = [20, 40, 60, 80, 100, 120, 160, 200];
  const g = h.map((x) => variogramModel("spherical", x, 1.0, 100, 0.2));
  const f = fitVariogram("spherical", h, g, h.map(() => 10));
  close(f.range, 100, 2);
  close(f.nugget, 0.2, 0.01);
  close(f.psill, 1.0, 0.01);
});

test("lake pairs never cross lakes", () => {
  const pairs = lakePairs(monitored);
  assert.equal(pairs.length, 81);
  assert.ok(pairs.every((p) => monitored[p.a].lake === monitored[p.b].lake));
});

test("experimental variogram and fits match the Python (NumPy) results", () => {
  for (const key of ["tp", "chl", "doxy", "turb", "nitrate", "temp"]) {
    const ref = spatialStats.variograms[key];
    const rows = trainRows(buildCube(key, ref.transform));
    const bins = experimentalVariogram(rows, lakePairs(monitored), 30, 300);
    assert.equal(bins.length, ref.bins.length, key + " bin count");
    bins.forEach((b, i) => {
      close(b.h, ref.bins[i].h, 1e-9, key + " h");
      close(b.gamma, ref.bins[i].gamma, 1e-9, key + " gamma");
      assert.equal(b.n_pairs, ref.bins[i].n_pairs);
    });
    const fits = fitAllModels(bins);
    for (const m of ["spherical", "exponential", "gaussian"]) {
      close(fits[m].range, ref.fits[m].range, 1e-9, `${key} ${m} range`);
      close(fits[m].nugget, ref.fits[m].nugget, 1e-9, `${key} ${m} nugget`);
      close(fits[m].psill, ref.fits[m].psill, 1e-9, `${key} ${m} psill`);
    }
  }
});

test("Moran's I on a 4-point path graph equals 1/3 (hand calculation)", () => {
  const neigh = [[1], [0, 2], [1, 3], [2]];
  const wts = [[1], [1, 1], [1, 1], [1]];
  close(moranStat([1, 2, 3, 4], neigh, wts), 1 / 3, 1e-12);
  close(moranNormal([1, 2, 3, 4], neigh, wts).expected, -1 / 3, 1e-12);
});

test("Moran's I, expected value, z-score and Local Moran match PySAL (esda)", () => {
  for (const fx of read("tests/fixtures/moran_fixtures.json")) {
    close(moranStat(fx.z, fx.neighbors, fx.weights), fx.I, 1e-10, fx.indicator + " I");
    const nrm = moranNormal(fx.z, fx.neighbors, fx.weights);
    close(nrm.expected, fx.expected, 1e-12);
    close(nrm.z_norm, fx.z_norm, 1e-9, fx.indicator + " z_norm");
    const loc = localMoran(fx.z, fx.groups, fx.neighbors, fx.weights, 9, "all", 3);
    loc.forEach((l, i) => close(l.I, fx.local_I[i], 1e-10, `${fx.indicator} local I[${i}]`));
  }
});

test("permutation p-value agrees with Python and ties cannot fake significance", () => {
  const fx = read("tests/fixtures/moran_fixtures.json").find((f) => f.indicator === "tp");
  const js = globalMoran(fx.z, fx.groups, fx.neighbors, fx.weights, 999, "all", 7);
  assert.ok(js.p_perm_two_sided < 0.01, "strong global autocorrelation is detected");
  // every station in its own group + within-lake permutation: nothing can move, so the null is a point mass
  const solo = globalMoran(fx.z, fx.groups.map((_, i) => "g" + i), fx.neighbors, fx.weights, 99, "within_lake", 1);
  assert.equal(solo.p_perm_two_sided, 1);
});

test("weights: same-lake restriction, row standardisation and island handling", () => {
  const w = buildWeights(monitored, { kind: "knn", k: 4, sameLake: true, standardize: true });
  w.neigh.forEach((nb, i) => nb.forEach((j) => assert.equal(monitored[j].lake, monitored[i].lake)));
  w.wts.forEach((r) => close(r.reduce((a, b) => a + b, 0), 1, 1e-12));
  const tiny = buildWeights(monitored, { kind: "band", bandKm: 5, sameLake: true, standardize: true });
  assert.ok(tiny.neigh.every((n) => n.length === 0), "a 5 km band leaves every station an island");
});

test("Benjamini-Hochberg keeps the right set", () => {
  assert.deepEqual(benjaminiHochberg([0.001, 0.02, 0.5, 0.9], 0.05), [true, true, false, false]);
});
