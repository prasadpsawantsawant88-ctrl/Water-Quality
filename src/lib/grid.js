// Interpolated risk layer: a coarse grid clipped to the lake outlines.
// Cells are only produced where a same-lake station with recent data lies within the search radius,
// so the layer never spans land or other lakes and never extends into areas with no support.
import { LAKE_POLYGONS, LAKE_NAMES, addDays, seasonOfMonth } from "./data.js";
import { pointInPolygon } from "./spatial.js";
import { estimateInputs } from "./estimator.js";
import { predict } from "./model.js";
import { classify } from "./risk.js";

export { GRID_STEP } from "./gridStep.js";

export function computeGrid(dateStr, settings) {
  const season = seasonOfMonth(+addDays(dateStr, 14).slice(5, 7));
  const cells = [];
  LAKE_NAMES.forEach((lake) => {
    const poly = LAKE_POLYGONS[lake];
    const lats = poly.map((p) => p[0]);
    const lons = poly.map((p) => p[1]);
    for (let lat = Math.min(...lats); lat <= Math.max(...lats); lat += GRID_STEP.lat) {
      for (let lon = Math.min(...lons); lon <= Math.max(...lons); lon += GRID_STEP.lon) {
        if (!pointInPolygon(lat, lon, poly)) continue;
        const e = estimateInputs({ lat, lon, lake }, dateStr, settings.spatial);
        if (!e.ok) continue;
        const p = predict(settings.model, "early", { ...e.est, season }).p;
        cells.push({ lat, lon, lake, p, level: classify(p, settings.thresholds), nearestKm: e.nearestUsedKm, n: e.neighbors.length });
      }
    }
  });
  return cells;
}
