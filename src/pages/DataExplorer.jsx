import { useMemo, useState } from "react";
import { useApp } from "../state.jsx";
import { Card, Field, Note, PageHeader, SimBadge } from "../components/ui.jsx";
import { LAKE_NAMES, observations, stationById, stations, SEASONS } from "../lib/data.js";
import { Tabs, RiskBadge } from "../components/ui.jsx";
import dictionary from "../data/dictionary.json";
import quality from "../data/data_quality.json";
import { fmt, mean, median, std, quantile } from "../lib/stats.js";

const COLS = [
  ["id", "Observation_ID"], ["station", "Station_ID"], ["lake", "Lake_Name"], ["lat", "Latitude"], ["lon", "Longitude"], ["date", "Observation_Date"],
  ["tp", "Total_Phosphorus"], ["chl", "Chlorophyll_a"], ["temp", "Water_Temperature"], ["turb", "Turbidity"], ["doxy", "Dissolved_Oxygen"], ["nitrate", "Nitrate"],
  ["rain", "Rainfall"], ["season", "Season"], ["bloom", "Bloom_Observed"], ["status", "Monitoring_Status"], ["dstatus", "Data_Status"],
];
const NUM = ["tp", "chl", "temp", "turb", "doxy", "nitrate", "rain"];
const PAGE = 25;

function ObservationsTab() {
  const [lake, setLake] = useState("All");
  const [station, setStation] = useState("All");
  const [season, setSeason] = useState("All");
  const [bloom, setBloom] = useState("All");
  const [sort, setSort] = useState({ key: "date", dir: -1 });
  const [page, setPage] = useState(0);

  const rows = useMemo(() => {
    const out = observations
      .filter((o) => (lake === "All" || stationById[o.station].lake === lake) && (station === "All" || o.station === station) && (season === "All" || o.season === season) && (bloom === "All" || o.bloom === +bloom))
      .map((o) => ({ ...o, lake: stationById[o.station].lake, lat: stationById[o.station].lat, lon: stationById[o.station].lon, status: "Monitored", dstatus: "SIMULATED_OBSERVED" }));
    out.sort((a, b) => (a[sort.key] < b[sort.key] ? -sort.dir : a[sort.key] > b[sort.key] ? sort.dir : 0));
    return out;
  }, [lake, station, season, bloom, sort]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const cur = Math.min(page, pages - 1);
  const view = rows.slice(cur * PAGE, cur * PAGE + PAGE);

  function download() {
    const header = COLS.map((c) => c[1]).join(",");
    const lines = rows.map((r) => COLS.map((c) => r[c[0]]).join(","));
    const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "gl-wqi_simulated_observations_filtered.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }
  const toggle = (key) => setSort(sort.key === key ? { key, dir: -sort.dir } : { key, dir: 1 });
  const stationList = stations.filter((s) => s.monitored && (lake === "All" || s.lake === lake));

  return (
    <div>
      <Card>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <Field label="Lake"><select className="select" value={lake} onChange={(e) => { setLake(e.target.value); setStation("All"); setPage(0); }}><option>All</option>{LAKE_NAMES.map((l) => <option key={l}>{l}</option>)}</select></Field>
          <Field label="Station"><select className="select" value={station} onChange={(e) => { setStation(e.target.value); setPage(0); }}><option>All</option>{stationList.map((s) => <option key={s.id}>{s.id}</option>)}</select></Field>
          <Field label="Season"><select className="select" value={season} onChange={(e) => { setSeason(e.target.value); setPage(0); }}><option>All</option>{SEASONS.map((s) => <option key={s}>{s}</option>)}</select></Field>
          <Field label="Bloom"><select className="select" value={bloom} onChange={(e) => { setBloom(e.target.value); setPage(0); }}><option value="All">All</option><option value="1">Observed</option><option value="0">Not observed</option></select></Field>
          <div className="pb-1 text-xs text-slate-500">{rows.length.toLocaleString()} rows</div>
          <button className="btn btn-ghost ml-auto" onClick={download}>Download filtered CSV</button>
        </div>
        <div className="max-h-[520px] overflow-auto rounded-lg border border-slate-200">
          <table className="w-full whitespace-nowrap">
            <thead><tr>{COLS.map(([k, label]) => <th key={k} className="th cursor-pointer" onClick={() => toggle(k)}>{label}{sort.key === k ? (sort.dir > 0 ? " ▲" : " ▼") : ""}</th>)}</tr></thead>
            <tbody>{view.map((r) => <tr key={r.id} className="hover:bg-slate-50">{COLS.map(([k]) => <td key={k} className="td">{typeof r[k] === "number" && !["bloom"].includes(k) ? (k === "lat" || k === "lon" ? r[k].toFixed(3) : r[k]) : String(r[k])}</td>)}</tr>)}</tbody>
          </table>
        </div>
        <div className="mt-3 flex items-center justify-between text-xs">
          <span>Page {cur + 1} of {pages}</span>
          <div className="flex gap-2"><button className="btn btn-ghost" disabled={cur === 0} onClick={() => setPage(cur - 1)}>Previous</button><button className="btn btn-ghost" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Next</button></div>
        </div>
      </Card>
      <Card className="mt-4" title="Descriptive statistics (filtered rows)">
        <table className="w-full"><thead><tr><th className="th">Variable</th><th className="th">n</th><th className="th">Mean</th><th className="th">SD</th><th className="th">Min</th><th className="th">Median</th><th className="th">P90</th><th className="th">Max</th></tr></thead>
          <tbody>{NUM.map((k) => { const v = rows.map((r) => r[k]); return <tr key={k}><td className="td">{COLS.find((c) => c[0] === k)[1]}</td><td className="td">{v.length}</td><td className="td">{fmt(mean(v), 2)}</td><td className="td">{fmt(std(v), 2)}</td><td className="td">{fmt(Math.min(...v), 2)}</td><td className="td">{fmt(median(v), 2)}</td><td className="td">{fmt(quantile(v, 0.9), 2)}</td><td className="td">{fmt(Math.max(...v), 2)}</td></tr>; })}
            <tr><td className="td">Bloom_Observed (rate)</td><td className="td">{rows.length}</td><td className="td">{fmt(mean(rows.map((r) => r.bloom)) * 100, 1)}%</td><td className="td" colSpan={5} /></tr></tbody></table>
      </Card>
      <div className="mt-4"><Note>Full datasets are also bundled as CSV in <code>public/data/</code> (observations, stations, unmonitored locations, model results) and can be regenerated with <code>npm run data</code>.</Note></div>
    </div>
  );
}

function DictionaryTab() {
  return (
    <Card title="Data dictionary" subtitle="Every field in the cleaned dataset. Plausibility ranges only flag impossible values; they are not water-quality standards.">
      <div className="overflow-x-auto"><table className="w-full"><thead><tr><th className="th">Field</th><th className="th">Description</th><th className="th">Unit</th><th className="th">Type</th><th className="th">Role</th><th className="th">Plausible range</th></tr></thead>
        <tbody>{dictionary.map((d) => <tr key={d.field}><td className="td font-semibold">{d.field}</td><td className="td text-xs">{d.description}</td><td className="td">{d.unit}</td><td className="td">{d.type}</td><td className="td text-xs">{d.role}</td><td className="td">{d.valid_range ? `${d.valid_range[0]} to ${d.valid_range[1]}` : ""}</td></tr>)}</tbody></table></div>
      <div className="mt-3 grid gap-2 text-xs md:grid-cols-4">
        {[["SIMULATED_OBSERVED", "A simulated station measurement", "#5aa9e6"], ["MISSING", "Planned sample that is absent", "#f2c14e"], ["ESTIMATED_KRIGING", "Value inferred by Kriging, never mixed into observed data", "#a98bff"], ["SIMULATED", "Everything in this prototype", "#ff5c6c"]].map(([k, t, c]) => (
          <div key={k} className="rounded-lg border p-2" style={{ borderColor: c }}><div className="font-semibold" style={{ color: c }}>{k}</div><div className="text-slate-600">{t}</div></div>
        ))}
      </div>
    </Card>
  );
}

function QualityTab() {
  const q = quality;
  const sevTone = { pass: "#3ecf8e", info: "#5aa9e6", warning: "#f2c14e", error: "#ff5c6c" };
  return (
    <div className="space-y-4">
      <Note tone="info" title="Simulated data.">{q.data_status}. The checks below are real code paths (scripts/prepare_data.py); on this synthetic dataset only the missing-sample check finds anything.</Note>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card><div className="label">Raw rows</div><div className="text-xl font-semibold">{q.rows_raw.toLocaleString()}</div></Card>
        <Card><div className="label">Clean rows</div><div className="text-xl font-semibold">{q.rows_clean.toLocaleString()}</div></Card>
        <Card><div className="label">Planned samples</div><div className="text-xl font-semibold">{q.planned_samples.toLocaleString()}</div></Card>
        <Card><div className="label">Missing samples</div><div className="text-xl font-semibold">{(q.planned_samples - q.rows_clean).toLocaleString()}</div><div className="text-[11px] text-slate-500">{q.missing_by_type.outage || 0} in outages, {q.missing_by_type.isolated || 0} isolated</div></Card>
      </div>
      <Card title="Checks">
        <table className="w-full"><thead><tr><th className="th">Check</th><th className="th">Result</th><th className="th">Found</th><th className="th">Detail</th></tr></thead>
          <tbody>{q.checks.map((c) => <tr key={c.check}><td className="td">{c.check}</td><td className="td font-semibold" style={{ color: sevTone[c.severity] }}>{c.severity}</td><td className="td">{c.found}</td><td className="td text-xs text-slate-600">{c.detail}</td></tr>)}</tbody></table>
      </Card>
      <Card title="Indicator summary (cleaned data)">
        <table className="w-full"><thead><tr><th className="th">Indicator</th><th className="th">Unit</th><th className="th">n</th><th className="th">Min</th><th className="th">Median</th><th className="th">Max</th><th className="th">Plausible range</th></tr></thead>
          <tbody>{Object.entries(q.indicator_summary).map(([k, v]) => <tr key={k}><td className="td">{k}</td><td className="td">{v.unit}</td><td className="td">{v.n}</td><td className="td">{fmt(v.min, 2)}</td><td className="td">{fmt(v.median, 2)}</td><td className="td">{fmt(v.max, 2)}</td><td className="td">{v.valid_range[0]} to {v.valid_range[1]}</td></tr>)}</tbody></table>
      </Card>
      <Card title="Station completeness">
        <table className="w-full"><thead><tr><th className="th">Station</th><th className="th">Lake</th><th className="th">Observations</th><th className="th">Missing</th><th className="th">Completeness</th><th className="th">Last sample</th></tr></thead>
          <tbody>{q.station_summary.map((s) => <tr key={s.station} className={s.completeness_pct < 95 ? "bg-amber-50" : ""}><td className="td font-semibold">{s.station}</td><td className="td">{s.lake}</td><td className="td">{s.n_obs}</td><td className="td">{s.n_missing}</td><td className="td">{s.completeness_pct}%</td><td className="td">{s.last}</td></tr>)}</tbody></table>
      </Card>
    </div>
  );
}

export default function DataExplorer() {
  const [tab, setTab] = useState("obs");
  return (
    <div>
      <PageHeader title="Data Explorer" subtitle="Browse, filter and export the cleaned simulated observations, read the data dictionary, and review the data quality report. Unmonitored locations have no observations by definition; their values are estimates shown elsewhere." right={<SimBadge />} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "obs", label: "Observations" }, { id: "dict", label: "Data dictionary" }, { id: "quality", label: "Data quality report" }]} />
      <div className="mt-4">{tab === "obs" ? <ObservationsTab /> : tab === "dict" ? <DictionaryTab /> : <QualityTab />}</div>
    </div>
  );
}
