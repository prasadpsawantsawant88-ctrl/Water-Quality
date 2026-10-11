import test from "node:test";
import assert from "node:assert/strict";
import { fullMatrix, priorityVector, consistency, solveAhp, normalise, composite, categoryOf, DEFAULT_JUDGMENTS, DEFAULT_AHP, AHP_KEYS, RANDOM_INDEX } from "../src/lib/ahp.js";
import { read } from "./helpers.mjs";

const fixtures = read("tests/fixtures/ahp_fixtures.json");

test("power iteration matches numpy eigen-decomposition (weights, lambda_max, CI, CR)", () => {
  for (const f of fixtures) {
    const { weights, lambdaMax } = priorityVector(f.matrix);
    weights.forEach((w, i) => assert.ok(Math.abs(w - f.weights[i]) < 1e-7, `weight ${i}: ${w} vs ${f.weights[i]}`));
    assert.ok(Math.abs(lambdaMax - f.lambda_max) < 1e-7);
    const c = consistency(lambdaMax, f.matrix.length);
    assert.ok(Math.abs(c.ci - f.ci) < 1e-7 && Math.abs(c.cr - f.cr) < 1e-6);
  }
});

test("a perfectly consistent matrix has lambda_max = n and CR = 0", () => {
  const w = [0.5, 0.25, 0.125, 0.125];
  const A = w.map((a) => w.map((b) => a / b));
  const r = priorityVector(A);
  assert.ok(Math.abs(r.lambdaMax - 4) < 1e-9);
  r.weights.forEach((v, i) => assert.ok(Math.abs(v - w[i]) < 1e-9));
  assert.ok(Math.abs(consistency(r.lambdaMax, 4).cr) < 1e-9);
});

test("the equal matrix gives equal weights", () => {
  const r = solveAhp({});
  r.weights.forEach((v) => assert.ok(Math.abs(v - 1 / 6) < 1e-12));
  assert.equal(r.consistent, true);
});

test("default judgments are reciprocal, weights sum to one and CR is below 0.10", () => {
  const A = fullMatrix(DEFAULT_JUDGMENTS);
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) assert.ok(Math.abs(A[i][j] * A[j][i] - 1) < 1e-12);
  const r = solveAhp(DEFAULT_JUDGMENTS);
  assert.ok(Math.abs(r.weights.reduce((a, b) => a + b, 0) - 1) < 1e-12);
  assert.ok(r.cr < 0.1);
  assert.equal(RANDOM_INDEX[5], 1.24);
});

test("a circular set of judgments is flagged as inconsistent", () => {
  const bad = { ...DEFAULT_JUDGMENTS, "tp|chl": 9, "chl|nitrate": 9, "tp|nitrate": 1 / 9 };
  const r = solveAhp(bad);
  assert.ok(r.cr > 0.1 && !r.consistent);
  assert.ok(r.worst.ratio > 2);
});

test("threshold is configurable", () => {
  const r = solveAhp({ ...DEFAULT_JUDGMENTS, "tp|chl": 4 }, 0.001);
  assert.equal(r.consistent, false);
});

test("normalisation: bounds, direction and logistic shape", () => {
  const up = { low: 5, high: 40 }, inv = { low: 12, high: 6 };
  assert.equal(normalise(5, up), 0);
  assert.equal(normalise(40, up), 1);
  assert.equal(normalise(100, up), 1);
  assert.equal(normalise(-3, up), 0);
  assert.ok(Math.abs(normalise(22.5, up) - 0.5) < 1e-12);
  assert.equal(normalise(12, inv), 0); // plenty of oxygen = no risk contribution
  assert.equal(normalise(6, inv), 1); // low oxygen = full contribution
  assert.ok(Math.abs(normalise(9, inv) - 0.5) < 1e-12);
  assert.ok(Math.abs(normalise(22.5, up, "logistic") - 0.5) < 1e-12);
  assert.ok(normalise(5, up, "logistic") < 0.03 && normalise(40, up, "logistic") > 0.97);
  assert.ok(Number.isNaN(normalise(NaN, up)));
});

test("composite is the weighted sum on 0-100; all indicators at the high end gives 100, at the low end 0", () => {
  const r = solveAhp(DEFAULT_JUDGMENTS);
  const hi = Object.fromEntries(AHP_KEYS.map((k) => [k, DEFAULT_AHP.norm.ranges[k].high]));
  const lo = Object.fromEntries(AHP_KEYS.map((k) => [k, DEFAULT_AHP.norm.ranges[k].low]));
  assert.ok(Math.abs(composite(hi, r.weights).score - 100) < 1e-9);
  assert.ok(Math.abs(composite(lo, r.weights).score) < 1e-9);
  const mid = Object.fromEntries(AHP_KEYS.map((k) => [k, (DEFAULT_AHP.norm.ranges[k].low + DEFAULT_AHP.norm.ranges[k].high) / 2]));
  assert.ok(Math.abs(composite(mid, r.weights).score - 50) < 1e-9);
  const c = composite({ ...hi, tp: lo.tp }, r.weights);
  assert.ok(Math.abs(c.score - 100 * (1 - r.weights[0])) < 1e-9);
  assert.ok(Math.abs(c.parts.reduce((s, p) => s + p.share, 0) - c.score) < 1e-9);
});

test("a missing indicator is dropped and the remaining weights are rescaled (not treated as zero risk)", () => {
  const r = solveAhp(DEFAULT_JUDGMENTS);
  const hi = Object.fromEntries(AHP_KEYS.map((k) => [k, DEFAULT_AHP.norm.ranges[k].high]));
  const c = composite({ ...hi, nitrate: NaN }, r.weights);
  assert.ok(Math.abs(c.score - 100) < 1e-9);
  assert.ok(Math.abs(c.usedWeight - (1 - r.weights[2])) < 1e-12);
});

test("score bands", () => {
  assert.deepEqual([10, 25, 49.9, 50, 74, 75, 99].map((s) => categoryOf(s)), ["Low", "Moderate", "Moderate", "High", "High", "Critical", "Critical"]);
});
