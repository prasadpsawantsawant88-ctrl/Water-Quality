import { estimateAt } from "./spatial.js";
import { krigedInputs } from "./kriging.js";

// Same neighbour search, confidence and warnings as before, but the model inputs can come from Ordinary Kriging instead of IDW.
export function estimateInputs(loc, dateStr, sp) {
  const e = estimateAt(loc, dateStr, sp);
  e.estimator = "idw";
  if (e.ok && sp.estimator === "kriging") {
    const k = krigedInputs(loc, dateStr);
    if (k) { e.est = k.est; e.krigingSE = k.se; e.estimator = "kriging"; }
    else e.warnings = [...e.warnings, "Kriging was not possible for this date (fewer than 3 same-lake stations); inverse-distance weighting used instead."];
  }
  return e;
}

