// Runs one prediction "run" for a given analysis date, then builds alerts by comparing two runs.
import {
  stations, obsByStation, indexAtOrBefore, addDays, seasonOfMonth, DAY_MS, observations,
} from "./data.js";
import { predict, contributions } from "./model.js";
import { classify, levelIndex, ACTIONS, DEFAULT_THRESHOLDS, CANDIDATE_NOTICE } from "./risk.js";
import { DEFAULT_SPATIAL, confidenceLabel } from "./spatial.js";
import { estimateInputs } from "./estimator.js";

export const DEFAULT_SETTINGS = {
  model: "lr", // "lr" | "rf" | "avg"
  thresholds: DEFAULT_THRESHOLDS,
  spatial: DEFAULT_SPATIAL,
  staleDays: 21, // a monitored station whose latest observation is older than this needs verification
  escalationDelta: 0.15, // probability jump between two runs that counts as escalation
};

const PREDICTION_HORIZON_DAYS = 14;

function targetSeason(dateStr) {
  return seasonOfMonth(+addDays(dateStr, PREDICTION_HORIZON_DAYS).slice(5, 7));
}

function topFactors(modelKey, x) {
  const all = contributions(modelKey, "early", x);
  const up = all.filter((c) => c.delta > 0.01).slice(0, 3);
  return { all, up };
}

function monitoredResult(st, dateStr, settings) {
  const ts = Date.parse(dateStr);
  const arr = obsByStation[st.id];
  const last = arr[indexAtOrBefore(arr, ts)];
  const x = { tp: last.tp, chl: last.chl, temp: last.temp, rain: last.rain, doxy: last.doxy, season: targetSeason(dateStr) };
  const pred = predict(settings.model, "early", x);
  const ageDays = Math.round((ts - last.ts) / DAY_MS);
  const freshness = ageDays <= 14 ? 1 : Math.exp(-(ageDays - 14) / 40);
  const agreement = 1 - Math.min(0.5, Math.abs(pred.pLR - pred.pRF));
  const treeFactor = 1 - Math.min(0.4, pred.treeSpread);
  const score = freshness * agreement * treeFactor;
  return {
    base: { st, x, pred, ageDays, lastObsDate: last.date, lastObs: last },
    inputSource: "observed",
    confidence: { score, label: confidenceLabel(score), parts: { freshness, agreement, treeFactor } },
    stale: ageDays > settings.staleDays,
    spatial: null,
  };
}

function unmonitoredResult(st, dateStr, settings) {
  const sp = estimateInputs(st, dateStr, settings.spatial);
  if (!sp.ok) {
    return { base: { st, x: null, pred: null, ageDays: null, lastObsDate: null }, inputSource: "estimated", confidence: { score: 0, label: "Low", parts: {} }, stale: false, spatial: sp };
  }
  const x = { ...sp.est, season: targetSeason(dateStr) };
  const pred = predict(settings.model, "early", x);
  const agreement = 1 - Math.min(0.5, Math.abs(pred.pLR - pred.pRF));
  const score = sp.confidence.score * agreement;
  const newest = Math.min(...sp.neighbors.map((n) => n.ageDays));
  return {
    base: { st, x, pred, ageDays: newest, lastObsDate: null },
    inputSource: "estimated",
    confidence: { score, label: confidenceLabel(score), parts: { ...sp.confidence.parts, agreement } },
    stale: false,
    spatial: sp,
  };
}

// One prediction run: every monitored station and unmonitored location at dateStr
export function runAnalysis(dateStr, settings) {
  const results = stations.map((st) => {
    const r = st.monitored ? monitoredResult(st, dateStr, settings) : unmonitoredResult(st, dateStr, settings);
    const { x, pred } = r.base;
    const p = pred ? pred.p : null;
    const level = classify(p, settings.thresholds);
    const factors = x ? topFactors(settings.model, x) : { all: [], up: [] };
    return {
      id: st.id, name: st.name, lake: st.lake, lat: st.lat, lon: st.lon, zone: st.zone,
      monitored: st.monitored, status: st.status,
      p, pLR: pred?.pLR ?? null, pRF: pred?.pRF ?? null, treeSpread: pred?.treeSpread ?? null,
      level, action: level === "Unknown" ? "Insufficient data: schedule field sampling" : ACTIONS[level],
      inputs: x, inputSource: r.inputSource,
      lastObsDate: r.base.lastObsDate, ageDays: r.base.ageDays, stale: r.stale,
      confidence: r.confidence, spatial: r.spatial,
      factors: factors.up, allFactors: factors.all,
    };
  });
  const byId = {};
  results.forEach((r) => (byId[r.id] = r));
  return { date: dateStr, results, byId };
}

// Attach previous-run values and the escalation flag to the current run
export function compareRuns(current, previous, settings) {
  current.results.forEach((r) => {
    const prev = previous.byId[r.id];
    r.prevP = prev ? prev.p : null;
    r.prevLevel = prev ? prev.level : null;
    r.delta = r.p !== null && r.prevP !== null ? r.p - r.prevP : null;
    r.escalating = r.delta !== null && (r.delta >= settings.escalationDelta || (levelIndex(r.level) - levelIndex(r.prevLevel) >= 2));
  });
  return current;
}

export function priorityScore(r) {
  if (r.p === null) return 0;
  return Math.min(100, 100 * r.p * (1 + 0.5 * (1 - r.confidence.score)));
}

// Alert rules (all model-generated candidates, never official warnings)
export function buildAlerts(run, settings, integration = null) {
  const th = settings.thresholds;
  const alerts = [];
  run.results.forEach((r) => {
    const add = (type, title, detail) =>
      alerts.push({
        id: `${r.id}-${type}`, type, title, detail, locationId: r.id, name: r.name, lake: r.lake,
        status: r.status, severity: r.level, p: r.p, delta: r.delta, priority: priorityScore(r), notice: CANDIDATE_NOTICE,
      });
    if (r.p === null) {
      add("FIELD_SAMPLING", "No defensible estimate", "No station with recent data is close enough. Targeted field sampling is the only way to assess this location.");
      return;
    }
    if (r.p >= th.critical) add("CRITICAL", "Critical-risk candidate", `Predicted bloom probability ${(r.p * 100).toFixed(0)}% is at or above the critical threshold (${(th.critical * 100).toFixed(0)}%). ${r.monitored ? "Prioritise field verification" : "Verify in the field before treating as confirmed"}.`);
    else if (r.p >= th.high) add("HIGH", "High-risk candidate", `Predicted bloom probability ${(r.p * 100).toFixed(0)}% is in the High band (${(th.high * 100).toFixed(0)}% to <${(th.critical * 100).toFixed(0)}%). Increase monitoring frequency.`);
    if (r.monitored && r.p >= th.moderate && r.stale) add("VERIFY", "Verify: observation is old", `Elevated risk, but the latest observation is ${r.ageDays} days old (limit ${settings.staleDays}). The estimate rests on stale data.`);
    if (!r.monitored && r.p >= th.high) {
      const weak = r.confidence.label === "Low" || (r.spatial && (r.spatial.neighbors.length < 3 || r.spatial.nearestUsedKm > settings.spatial.farKm));
      if (weak) add("FIELD_SAMPLING", "Targeted field sampling recommended", `High estimated risk with weak supporting data (confidence ${r.confidence.label.toLowerCase()}, ${r.spatial.neighbors.length} contributing station(s), nearest ${r.spatial.nearestUsedKm.toFixed(0)} km). Treat as unconfirmed.`);
    }
    if (r.escalating) add("ESCALATION", "Risk escalation", `Probability moved from ${(r.prevP * 100).toFixed(0)}% (${r.prevLevel}) to ${(r.p * 100).toFixed(0)}% (${r.level}) since the previous run.`);
  });

  // Kriging + AHP rules for unmonitored locations. These use the AHP score band and the Monte Carlo exceedance probability, which are
  // different quantities from bloom probability; "severity" is the AHP band and "p" stays the bloom probability.
  if (integration) {
    const bandIdx = { Low: 0, Moderate: 1, High: 2, Critical: 3 };
    integration.rows.filter((a) => a.ok).forEach((a) => {
      const bloom = run.byId[a.id];
      const add = (type, title, detail, priority) =>
        alerts.push({ id: `${a.id}-${type}`, type, title, detail, locationId: a.id, name: a.name, lake: a.lake, status: "Unmonitored", severity: a.category, p: bloom?.p ?? null, delta: null, priority, notice: CANDIDATE_NOTICE });
      const pct0 = (v) => `${(v * 100).toFixed(0)}%`;
      if (a.action.level === "Priority")
        add("AHP_PRIORITY", "Interpolated AHP risk: priority sampling", `Kriged indicators give an AHP score of ${a.score.toFixed(0)} (${a.category} band; 90% interval ${a.mc.p05.toFixed(0)}-${a.mc.p95.toFixed(0)}); the chance it reaches ${a.mc.threshold} is ${pct0(a.mc.pExceed)}. This is an interpolated multi-criteria score, not a bloom probability. Field-sample within 7 days.`, 100 * a.mc.pExceed);
      else if (a.action.level === "Reduce uncertainty")
        add("AHP_UNCERTAIN", "Interpolated risk poorly constrained", `AHP score ${a.score.toFixed(0)} with a wide 90% interval (${a.mc.p05.toFixed(0)}-${a.mc.p95.toFixed(0)}) or distant stations (nearest ${a.nearestKm.toFixed(0)} km). A targeted sample would confirm it.`, 40 + (a.mc.p95 - a.mc.p05) / 2);
      const bloomIdx = bloom?.level in bandIdx ? bandIdx[bloom.level] : null;
      if (bloomIdx !== null && Math.abs(bloomIdx - bandIdx[a.category]) >= 2)
        add("DISAGREE", "Indicators and bloom model disagree", `The AHP band is ${a.category} (score ${a.score.toFixed(0)}) but the bloom model gives ${pct0(bloom.p)} (${bloom.level}). They measure different things, so a large gap is a reason for field verification rather than for trusting either number.`, 60);
    });
  }
  return alerts;
}

// Predicted probability for every historical monitored observation that has a prior sample (14-42 days earlier).
// Uses the early-warning configuration, so each probability only uses information from the previous sample.
export function historicalProbabilities(modelKey) {
  const out = [];
  Object.keys(obsByStation).forEach((sid) => {
    const arr = obsByStation[sid];
    for (let i = 1; i < arr.length; i++) {
      const prev = arr[i - 1];
      const gap = (arr[i].ts - prev.ts) / DAY_MS;
      if (gap > 42) continue;
      const x = { tp: prev.tp, chl: prev.chl, temp: prev.temp, rain: prev.rain, doxy: prev.doxy, season: arr[i].season };
      out.push({
        station: sid, lake: stations.find((s) => s.id === sid).lake, date: arr[i].date, year: arr[i].year, month: arr[i].month,
        season: arr[i].season, bloom: arr[i].bloom, p: predict(modelKey, "early", x).p, tp: arr[i].tp,
      });
    }
  });
  return out;
}

export const allObservations = observations;
