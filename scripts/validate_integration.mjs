// Phase 5 validation against the hidden truth. For every 2024-2025 sampling date and every unmonitored location, the six AHP
// indicators are kriged from the monitored stations of the same lake, scored with AHP (default judgments), and compared with
// the score computed from the (simulated) true values at that location. Also checks the Monte Carlo interval and exceedance probability.
// Baselines: inverse-distance weighting and lake mean in place of Kriging. Run: node scripts/validate_integration.mjs
import fs from "node:fs";
import { prepareKriging } from "../src/lib/krigingCore.js";
import { DEFAULT_AHP, AHP_KEYS, solveAhp, composite } from "../src/lib/ahp.js";
import { assessLocation } from "../src/lib/integrationCore.js";
import { haversineKm, forwardTransform, inverseTransform } from "../src/lib/spatialCore.js";

const read = (p) => JSON.parse(fs.readFileSync(new URL("../" + p, import.meta.url)));
const stations = read("src/data/stations.json"), dates = read("src/data/dates.json"), obs = read("src/data/observations.json"), K = read("src/data/kriging_results.json");
const TR = { tp: "log", chl: "log", nitrate: "log", temp: "none", doxy: "none", turb: "log" };
const COL = { tp: "tp", chl: "chl", nitrate: "no3", temp: "temp", doxy: "do", turb: "turb" };
const CSV_COL = { tp: "Total_Phosphorus", chl: "Chlorophyll_a", nitrate: "Nitrate", temp: "Water_Temperature", doxy: "Dissolved_Oxygen", turb: "Turbidity" };
const mon = stations.filter((s) => s.monitored), unm = stations.filter((s) => !s.monitored);
const ahp = solveAhp(DEFAULT_AHP.judgments);
const THR = DEFAULT_AHP.bands[1]; // exceedance threshold: score >= 50 (start of the High band)

const monIdx = Object.fromEntries(mon.map((s, i) => [s.id, i])), dIdx = Object.fromEntries(dates.map((d, i) => [d, i]));
const cube = {};
AHP_KEYS.forEach((k) => { cube[k] = dates.map(() => mon.map(() => NaN)); });
obs.id.forEach((_, i) => AHP_KEYS.forEach((k) => { cube[k][dIdx[obs.date[i]]][monIdx[obs.station[i]]] = obs[COL[k]][i]; }));

const [head, ...lines] = fs.readFileSync(new URL("../data/raw/unmonitored_hidden_truth.csv", import.meta.url), "utf8").trim().split("\n");
const cols = head.split(",");
const truth = {};
lines.forEach((l) => { const v = l.split(","); const r = Object.fromEntries(cols.map((c, i) => [c, v[i]])); truth[`${r.Station_ID}|${r.Observation_Date}`] = r; });

const recs = [];
let caseNo = 0;
dates.forEach((d, t) => {
  if (d < "2024-01-01") return;
  unm.forEach((u) => {
    const T = truth[`${u.id}|${d}`];
    if (!T) return;
    const sameLake = mon.map((s, i) => ({ s, i })).filter(({ s }) => s.lake === u.lake);
    const est = { kr: {}, idw: {}, lm: {} };
    let ok = true;
    for (const k of AHP_KEYS) {
      const pts = sameLake.filter(({ i }) => !Number.isNaN(cube[k][t][i])).map(({ s, i }) => ({ lat: s.lat, lon: s.lon, z: forwardTransform(cube[k][t][i], TR[k]) }));
      if (pts.length < 3) { ok = false; break; }
      const m = K.best_by_cv[k], p = K.default_params[k][m];
      const r = prepareKriging(pts, m, { nugget: p.nugget, psill: p.psill, range: p.range }).predict(u.lat, u.lon);
      est.kr[k] = { mu: r.estimate, se: r.se, transform: TR[k] };
      const w = pts.map((q) => 1 / (haversineKm(u.lat, u.lon, q.lat, q.lon) + 1) ** 2);
      est.idw[k] = { mu: pts.reduce((a, q, j) => a + w[j] * q.z, 0) / w.reduce((a, b) => a + b, 0), se: 0, transform: TR[k] };
      est.lm[k] = { mu: pts.reduce((a, q) => a + q.z, 0) / pts.length, se: 0, transform: TR[k] };
    }
    if (!ok) return;
    const trueScore = composite(Object.fromEntries(AHP_KEYS.map((k) => [k, +T[CSV_COL[k]]])), ahp.weights, DEFAULT_AHP).score;
    const a = assessLocation(est.kr, ahp.weights, DEFAULT_AHP, { nSim: 500, threshold: THR, seed: 100 + caseNo++ });
    const sIdw = assessLocation(est.idw, ahp.weights, DEFAULT_AHP, { nSim: 1, threshold: THR }).score;
    const sLm = assessLocation(est.lm, ahp.weights, DEFAULT_AHP, { nSim: 1, threshold: THR }).score;
    recs.push({ trueScore, kr: a.score, idw: sIdw, lm: sLm, p05: a.mc.p05, p95: a.mc.p95, pEx: a.mc.pExceed, trueEx: trueScore >= THR ? 1 : 0 });
  });
});

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const mae = (k) => mean(recs.map((r) => Math.abs(r[k] - r.trueScore)));
const rmse = (k) => Math.sqrt(mean(recs.map((r) => (r[k] - r.trueScore) ** 2)));
const bins = Array.from({ length: 5 }, (_, b) => {
  const inBin = recs.filter((r) => r.pEx >= b / 5 && (b === 4 ? r.pEx <= 1 : r.pEx < (b + 1) / 5));
  return { range: `${b * 20}-${(b + 1) * 20}%`, n: inBin.length, predicted: inBin.length ? mean(inBin.map((r) => r.pEx)) : null, observed: inBin.length ? mean(inBin.map((r) => r.trueEx)) : null };
});
const out = {
  meta: { simulated: true, cases: recs.length, dates: "2024-2025", locations: unm.length, threshold: THR, note: "Truth = AHP score computed from the simulated true values at each unmonitored location; same default AHP weights for all methods." },
  score_error: { kriging: { mae: mae("kr"), rmse: rmse("kr") }, idw: { mae: mae("idw"), rmse: rmse("idw") }, lake_mean: { mae: mae("lm"), rmse: rmse("lm") }, bias_kriging: mean(recs.map((r) => r.kr - r.trueScore)) },
  interval90_coverage: mean(recs.map((r) => (r.trueScore >= r.p05 && r.trueScore <= r.p95 ? 1 : 0))),
  mean_interval_width: mean(recs.map((r) => r.p95 - r.p05)),
  exceedance: { brier: mean(recs.map((r) => (r.pEx - r.trueEx) ** 2)), base_rate: mean(recs.map((r) => r.trueEx)), brier_climatology: (() => { const b = mean(recs.map((r) => r.trueEx)); return b * (1 - b); })(), reliability: bins },
};
fs.writeFileSync(new URL("../src/data/integration_validation.json", import.meta.url), JSON.stringify(out));
console.log(JSON.stringify(out, null, 1));
