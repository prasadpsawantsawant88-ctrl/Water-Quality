import test from "node:test";
import assert from "node:assert/strict";
import { prepareKriging, krigeAt, leaveOneOut, cvMetrics } from "../src/lib/krigingCore.js";
import { read } from "./helpers.mjs";

const fixtures = read("tests/fixtures/kriging_fixtures.json");
const P = { nugget: 0.02, psill: 0.5, range: 120 };
const pts = [[45, -83], [45.3, -82.4], [44.8, -82.1], [45.5, -83.2], [44.6, -83.3]].map(([lat, lon], i) => ({ lat, lon, z: 1 + 0.3 * i }));

test("matches PyKrige on every reference case (estimate and variance)", () => {
  assert.ok(fixtures.length >= 40);
  for (const f of fixtures) {
    const r = krigeAt(f.stations.map((s) => ({ lat: s.lat, lon: s.lon, z: s.z })), f.target, f.model, f.params);
    assert.ok(Math.abs(r.estimate - f.estimate) < 1e-5, `${f.indicator} ${f.model} estimate ${r.estimate} vs ${f.estimate}`);
    assert.ok(Math.abs(r.variance - f.variance) < 1e-5, `${f.indicator} ${f.model} variance ${r.variance} vs ${f.variance}`);
  }
});

for (const model of ["spherical", "exponential", "gaussian"]) {
  test(`${model}: exact at data points with zero variance`, () => {
    const k = prepareKriging(pts, model, P);
    for (const s of pts) {
      const r = k.predict(s.lat, s.lon);
      assert.ok(Math.abs(r.estimate - s.z) < 1e-8);
      assert.ok(r.variance < 1e-8);
    }
  });
  test(`${model}: weights sum to one, a constant field is reproduced`, () => {
    const flat = pts.map((p) => ({ ...p, z: 3.7 }));
    const r = krigeAt(flat, { lat: 45.1, lon: -82.7 }, model, P);
    assert.ok(Math.abs(r.weights.reduce((a, b) => a + b, 0) - 1) < 1e-9);
    assert.ok(Math.abs(r.estimate - 3.7) < 1e-9);
  });
}

test("variance grows with distance from the stations and is capped near the sill", () => {
  const near = krigeAt(pts, { lat: 45.0, lon: -82.95 }, "spherical", P).variance;
  const far = krigeAt(pts, { lat: 47, lon: -80 }, "spherical", P).variance;
  assert.ok(far > near);
  assert.ok(far < 2 * (P.nugget + P.psill) + 0.3);
});

test("two stations: symmetric midpoint gets the mean", () => {
  const two = [{ lat: 45, lon: -83, z: 1 }, { lat: 45, lon: -82, z: 3 }];
  const r = krigeAt(two, { lat: 45, lon: -82.5 }, "exponential", P);
  assert.ok(Math.abs(r.estimate - 2) < 0.02); // great-circle midpoint is very close to the lon midpoint
});

test("leave-one-out metrics are finite and computed per station", () => {
  const loo = leaveOneOut(pts, "spherical", P);
  assert.equal(loo.length, pts.length);
  const m = cvMetrics(loo);
  assert.ok(Number.isFinite(m.rmse) && m.rmse >= m.mae && m.coverage95 >= 0 && m.coverage95 <= 1);
});

test("duplicate stations are reported as a singular system", () => {
  const dup = [...pts, { ...pts[0] }];
  assert.throws(() => prepareKriging(dup, "gaussian", P));
});
