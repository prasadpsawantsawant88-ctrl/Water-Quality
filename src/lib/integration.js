// App-side wrapper: krige the six AHP indicators at every unmonitored location, then score them with AHP.
import { unmonitoredStations } from "./data.js";
import { AHP_KEYS } from "./ahp.js";
import { assessLocation, monitoringAction, DEFAULT_INTEGRATION } from "./integrationCore.js";
import { INDICATORS } from "./spatialData.js";
import { KRIGING, defaultParams, krigeLake, predictPoint } from "./kriging.js";

export { DEFAULT_INTEGRATION };
export const DEFAULT_INT_CFG = { ...DEFAULT_INTEGRATION, model: "best", allowPrev: true };

export function assessUnmonitored(dateStr, ahp, ahpCfg, cfg) {
  const lakes = [...new Set(unmonitoredStations.map((s) => s.lake))];
  const fits = {}; // fits[lake][indicator]
  const problems = [];
  lakes.forEach((lake) => {
    fits[lake] = {};
    AHP_KEYS.forEach((k) => {
      const model = cfg.model === "best" ? KRIGING.best_by_cv[k] : cfg.model;
      const f = krigeLake({ key: k, model, params: defaultParams(k, model), lake, dateStr, allowPrev: cfg.allowPrev });
      fits[lake][k] = f;
      if (!f.ok) problems.push(`${lake} ${INDICATORS[k].short}: ${f.reason}`);
    });
  });
  const rows = unmonitoredStations.map((s, idx) => {
    const lf = fits[s.lake];
    if (AHP_KEYS.some((k) => !lf[k].ok)) return { ...s, ok: false, reason: "Too few same-lake stations with data for this date." };
    const points = Object.fromEntries(AHP_KEYS.map((k) => [k, predictPoint(lf[k], k, s.lat, s.lon)]));
    const est = Object.fromEntries(AHP_KEYS.map((k) => [k, { mu: points[k].estimate, se: points[k].se, transform: INDICATORS[k].transform }]));
    const a = assessLocation(est, ahp.weights, ahpCfg, { ...cfg, seed: cfg.seed + idx }, AHP_KEYS);
    const nearestKm = Math.max(...AHP_KEYS.map((k) => points[k].nearestKm));
    const flags = [...new Set(AHP_KEYS.flatMap((k) => points[k].flags))];
    const stationsUsed = Math.min(...AHP_KEYS.map((k) => lf[k].used.length));
    return { ...s, ok: true, ...a, points, nearestKm, flags, stationsUsed, action: monitoringAction(a.mc, nearestKm) };
  });
  rows.filter((r) => r.ok).sort((a, b) => b.action.rank - a.action.rank || b.mc.pExceed - a.mc.pExceed || (b.mc.p95 - b.mc.p05) - (a.mc.p95 - a.mc.p05)).forEach((r, i) => { r.priority = i + 1; });
  return { rows, problems, byId: Object.fromEntries(rows.map((r) => [r.id, r])) };
}
