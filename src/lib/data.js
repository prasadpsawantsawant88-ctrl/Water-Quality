// Loads the bundled SIMULATED data and builds simple lookup tables.
import obsCols from "../data/observations.json";
import stationsRaw from "../data/stations.json";
import results from "../data/model_results.json";
import lakes from "../data/lakes.json";
import dates from "../data/dates.json";

export const LAKE_NAMES = ["Superior", "Michigan", "Huron", "Erie", "Ontario"];
export const LAKE_POLYGONS = lakes; // schematic outlines, [lat, lon]
export const RESULTS = results;
export const MODELS = results.models;
export const DATES = dates; // every 14-day sampling date, 2018-2025
export const DEFAULT_DATE = results.meta.default_analysis_date;
export const DAY_MS = 86400000;

export const observations = obsCols.id.map((id, i) => {
  const date = obsCols.date[i];
  return {
    id,
    station: obsCols.station[i],
    date,
    ts: Date.parse(date),
    year: +date.slice(0, 4),
    month: +date.slice(5, 7),
    tp: obsCols.tp[i],
    chl: obsCols.chl[i],
    temp: obsCols.temp[i],
    turb: obsCols.turb[i],
    doxy: obsCols.do[i],
    nitrate: obsCols.no3[i],
    rain: obsCols.rain[i],
    season: obsCols.season[i],
    bloom: obsCols.bloom[i],
  };
});

export const stations = stationsRaw;
export const stationById = {};
stations.forEach((s) => (stationById[s.id] = s));
export const monitoredStations = stations.filter((s) => s.monitored);
export const unmonitoredStations = stations.filter((s) => !s.monitored);

// observations per station, already sorted by date
export const obsByStation = {};
monitoredStations.forEach((s) => (obsByStation[s.id] = []));
observations.forEach((o) => obsByStation[o.station].push(o));

// index of the last observation with date <= ts (binary search), or -1
export function indexAtOrBefore(arr, ts) {
  let lo = 0;
  let hi = arr.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].ts <= ts) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

export function addDays(dateStr, n) {
  return new Date(Date.parse(dateStr) + n * DAY_MS).toISOString().slice(0, 10);
}

export function seasonOfMonth(m) {
  if (m === 12 || m <= 2) return "Winter";
  if (m <= 5) return "Spring";
  if (m <= 8) return "Summer";
  return "Autumn";
}
export const SEASONS = ["Winter", "Spring", "Summer", "Autumn"];
