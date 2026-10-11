import test from "node:test";
import assert from "node:assert/strict";
import { assessLocation, monitoringAction } from "../src/lib/integrationCore.js";
import { solveAhp, DEFAULT_AHP, AHP_KEYS, composite } from "../src/lib/ahp.js";

const ahp = solveAhp(DEFAULT_AHP.judgments);
const TR = { tp: "log", chl: "log", nitrate: "log", temp: "none", doxy: "none", turb: "log" };
const mk = (raw, se) => Object.fromEntries(AHP_KEYS.map((k) => [k, { mu: TR[k] === "log" ? Math.log(raw[k]) : raw[k], se: typeof se === "number" ? se : se[k], transform: TR[k] }]));
const mid = { tp: 20, chl: 12, nitrate: 0.5, temp: 17, doxy: 9, turb: 8 };

test("with zero Kriging error the Monte Carlo collapses onto the point score", () => {
  const a = assessLocation(mk(mid, 0), ahp.weights, DEFAULT_AHP, { nSim: 50 });
  assert.ok(Math.abs(a.mc.p05 - a.score) < 1e-9 && Math.abs(a.mc.p95 - a.score) < 1e-9);
  assert.equal(a.mc.pExceed, a.score >= 50 ? 1 : 0);
  assert.ok(Math.abs(a.score - composite(mid, ahp.weights, DEFAULT_AHP).score) < 1e-9);
});

test("the interval widens with Kriging standard error and is reproducible for a seed", () => {
  const narrow = assessLocation(mk(mid, 0.1), ahp.weights, DEFAULT_AHP, { nSim: 800, seed: 3 });
  const wide = assessLocation(mk(mid, 0.6), ahp.weights, DEFAULT_AHP, { nSim: 800, seed: 3 });
  assert.ok(wide.mc.p95 - wide.mc.p05 > 2 * (narrow.mc.p95 - narrow.mc.p05));
  const again = assessLocation(mk(mid, 0.6), ahp.weights, DEFAULT_AHP, { nSim: 800, seed: 3 });
  assert.equal(again.mc.p50, wide.mc.p50);
  assert.equal(wide.mc.hist.reduce((s, b) => s + b.count, 0), 800);
});

test("exceedance probability responds to the threshold and is about one half when the point score sits on it", () => {
  const base = assessLocation(mk(mid, 0.4), ahp.weights, DEFAULT_AHP, { nSim: 4000, seed: 5 });
  const hi = assessLocation(mk(mid, 0.4), ahp.weights, DEFAULT_AHP, { nSim: 4000, seed: 5, threshold: base.mc.p50 });
  assert.ok(Math.abs(hi.mc.pExceed - 0.5) < 0.03);
  const lo = assessLocation(mk(mid, 0.4), ahp.weights, DEFAULT_AHP, { nSim: 4000, seed: 5, threshold: 1 });
  assert.ok(lo.mc.pExceed > 0.99);
});

test("correlated errors give a wider interval than independent ones when the indicators push the score the same way", () => {
  const ind = assessLocation(mk(mid, 0.5), ahp.weights, DEFAULT_AHP, { nSim: 3000, seed: 9, rho: 0 });
  const cor = assessLocation(mk(mid, 0.5), ahp.weights, DEFAULT_AHP, { nSim: 3000, seed: 9, rho: 0.8 });
  assert.ok(cor.mc.p95 - cor.mc.p05 > ind.mc.p95 - ind.mc.p05);
});

test("drivers: the indicator with the largest weight x error is listed first", () => {
  const a = assessLocation(mk(mid, { tp: 0.1, chl: 0.8, nitrate: 0.1, temp: 0.1, doxy: 0.1, turb: 0.1 }), ahp.weights, DEFAULT_AHP, { nSim: 10 });
  assert.equal(a.drivers[0].key, "chl");
});

test("monitoring action rules", () => {
  const mc = (pExceed, p05, p95) => ({ pExceed, p05, p95 });
  assert.equal(monitoringAction(mc(0.7, 50, 80), 20).level, "Priority");
  assert.equal(monitoringAction(mc(0.3, 30, 55), 20).level, "Soon");
  assert.equal(monitoringAction(mc(0.02, 5, 40), 20).level, "Reduce uncertainty");
  assert.equal(monitoringAction(mc(0.02, 5, 15), 150).level, "Reduce uncertainty");
  assert.equal(monitoringAction(mc(0.02, 5, 15), 20).level, "Routine");
});
