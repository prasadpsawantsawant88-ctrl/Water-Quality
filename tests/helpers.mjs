// Shared test helpers: load the same JSON files the app uses and rebuild station-by-date arrays.
import fs from "node:fs";
import { forwardTransform } from "../src/lib/spatialCore.js";

export const read = (p) => JSON.parse(fs.readFileSync(new URL("../" + p, import.meta.url)));
export const stations = read("src/data/stations.json");
export const monitored = stations.filter((s) => s.monitored);
export const dates = read("src/data/dates.json");
export const obsCols = read("src/data/observations.json");
export const spatialStats = read("src/data/spatial_stats.json");
export const COLUMN = { tp: "tp", chl: "chl", doxy: "do", turb: "turb", nitrate: "no3", temp: "temp", rain: "rain" };

// rows[t][s] on the analysis scale, NaN where the station has no sample on that date
export function buildCube(key, transform) {
  const dateIdx = Object.fromEntries(dates.map((d, i) => [d, i]));
  const stIdx = Object.fromEntries(monitored.map((s, i) => [s.id, i]));
  const rows = dates.map(() => new Array(monitored.length).fill(NaN));
  obsCols.id.forEach((_, i) => {
    rows[dateIdx[obsCols.date[i]]][stIdx[obsCols.station[i]]] = forwardTransform(obsCols[COLUMN[key]][i], transform);
  });
  return rows;
}
export const trainRows = (rows) => rows.filter((_, t) => dates[t] <= "2023-12-31");
