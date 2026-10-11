import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend as RLegend, Line, LineChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { useApp } from "../state.jsx";
import { Card, Field, Note, PageHeader, Tabs, AXIS, LAKE_COLORS } from "../components/ui.jsx";
import { LAKE_NAMES, SEASONS, monitoredStations, observations, stationById, RESULTS } from "../lib/data.js";
import { predict } from "../lib/model.js";
import { fmt, groupBy, linearFit, logisticFit1D, mean, median, pearson, quantile } from "../lib/stats.js";

const VARS = {
  tp: { label: "Total phosphorus", unit: "µg/L" },
  chl: { label: "Chlorophyll-a", unit: "µg/L" },
  temp: { label: "Water temperature", unit: "°C" },
  rain: { label: "Rainfall", unit: "mm" },
  doxy: { label: "Dissolved oxygen", unit: "mg/L" },
  turb: { label: "Turbidity", unit: "NTU" },
};
const CORR_VARS = ["tp", "chl", "temp", "turb", "doxy", "rain", "bloom"];
const CORR_LABEL = { ...Object.fromEntries(Object.entries(VARS).map(([k, v]) => [k, v.label])), bloom: "Bloom observed" };
const PALETTE = ["#6f8fd9", "#5aa9e6", "#35d0c4", "#a98bff", "#d4a95a", "#4f8a3c", "#b05a8a", "#9aa4c4"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function corrColor(r) {
  if (Number.isNaN(r)) return "rgba(255,255,255,0.05)";
  const a = Math.min(1, Math.abs(r));
  return r >= 0 ? `rgba(26,166,160,${0.12 + a * 0.85})` : `rgba(122,94,168,${0.12 + a * 0.85})`;
}

export default function Analytics() {
  const { history } = useApp();
  const [tab, setTab] = useState("tp");
  const [lake, setLake] = useState("All");
  const [station, setStation] = useState("All");
  const [years, setYears] = useState([2018, 2025]);
  const [variable, setVariable] = useState("temp");

  const stationOptions = monitoredStations.filter((s) => lake === "All" || s.lake === lake);
  const rows = useMemo(
    () => observations.filter((o) => o.year >= years[0] && o.year <= years[1] && (station === "All" ? lake === "All" || stationById[o.station].lake === lake : o.station === station)),
    [lake, station, years]
  );

  // series grouping: lakes when everything is shown, stations when a lake is chosen, single series for one station
  const groupOf = (o) => (station !== "All" ? o.station : lake !== "All" ? o.station : stationById[o.station].lake);
  const groupNames = [...new Set(rows.map(groupOf))].sort();
  const colorOf = (g) => LAKE_COLORS[g] || PALETTE[groupNames.indexOf(g) % PALETTE.length];

  function monthlySeries(key) {
    const byMonth = groupBy(rows, (o) => o.date.slice(0, 7));
    return Object.keys(byMonth).sort().map((m) => {
      const row = { month: m };
      const byGroup = groupBy(byMonth[m], groupOf);
      Object.keys(byGroup).forEach((g) => (row[g] = mean(byGroup[g].map((o) => o[key]))));
      return row;
    });
  }
  function seasonalBars(key) {
    return SEASONS.map((s) => {
      const row = { season: s };
      const byGroup = groupBy(rows.filter((o) => o.season === s), groupOf);
      groupNames.forEach((g) => (row[g] = byGroup[g] ? mean(byGroup[g].map((o) => o[key])) : 0));
      return row;
    });
  }
  function bloomByBin(key, edges) {
    return edges.slice(0, -1).map((lo, i) => {
      const hi = edges[i + 1];
      const sub = rows.filter((o) => o[key] >= lo && o[key] < hi);
      return { bin: `${lo}-${hi}`, mid: (lo + hi) / 2, rate: sub.length >= 10 ? (sub.filter((o) => o.bloom).length / sub.length) * 100 : null, n: sub.length };
    });
  }
  const lineChart = (key, unit) => (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={monthlySeries(key)}>
        <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
        <XAxis dataKey="month" tick={AXIS} interval={Math.max(0, Math.floor(monthlySeries(key).length / 10))} />
        <YAxis tick={AXIS} unit={unit ? ` ${unit}` : ""} />
        <Tooltip formatter={(v) => (typeof v === "number" ? v.toFixed(2) : v)} />
        <RLegend wrapperStyle={{ fontSize: 12 }} />
        {groupNames.map((g) => <Line key={g} dataKey={g} stroke={colorOf(g)} dot={false} strokeWidth={1.6} connectNulls />)}
      </LineChart>
    </ResponsiveContainer>
  );
  const seasonChart = (key, unit) => (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={seasonalBars(key)}>
        <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
        <XAxis dataKey="season" tick={AXIS} />
        <YAxis tick={AXIS} unit={unit ? ` ${unit}` : ""} />
        <Tooltip formatter={(v) => v.toFixed(2)} />
        <RLegend wrapperStyle={{ fontSize: 12 }} />
        {groupNames.map((g) => <Bar key={g} dataKey={g} fill={colorOf(g)} />)}
      </BarChart>
    </ResponsiveContainer>
  );
  const byLakeStats = (key) => LAKE_NAMES.map((l) => {
    const v = rows.filter((o) => stationById[o.station].lake === l).map((o) => o[key]);
    return { lake: l, Median: v.length ? median(v) : 0, P90: v.length ? quantile(v, 0.9) : 0 };
  }).filter((d) => d.Median > 0);
  const stationMeans = (key) => monitoredStations
    .map((s) => ({ id: s.id, lake: s.lake, v: mean(rows.filter((o) => o.station === s.id).map((o) => o[key])) }))
    .filter((d) => !Number.isNaN(d.v)).sort((a, b) => b.v - a.v);

  return (
    <div>
      <PageHeader title="Water Quality Analytics" subtitle="Explore the simulated observations. Every chart on this page responds to the filters below." />
      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Lake"><select className="select" value={lake} onChange={(e) => { setLake(e.target.value); setStation("All"); }}><option>All</option>{LAKE_NAMES.map((l) => <option key={l}>{l}</option>)}</select></Field>
          <Field label="Station"><select className="select" value={station} onChange={(e) => setStation(e.target.value)}><option>All</option>{stationOptions.map((s) => <option key={s.id} value={s.id}>{s.id} · {s.name}</option>)}</select></Field>
          <Field label="From year"><select className="select" value={years[0]} onChange={(e) => setYears([Math.min(+e.target.value, years[1]), years[1]])}>{[2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025].map((y) => <option key={y}>{y}</option>)}</select></Field>
          <Field label="To year"><select className="select" value={years[1]} onChange={(e) => setYears([years[0], Math.max(+e.target.value, years[0])])}>{[2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025].map((y) => <option key={y}>{y}</option>)}</select></Field>
          <Field label="Environmental variable (drivers, scatter, trends)"><select className="select" value={variable} onChange={(e) => setVariable(e.target.value)}>{Object.entries(VARS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
          <div className="pb-1 text-xs text-slate-500">{rows.length.toLocaleString()} observations selected</div>
        </div>
      </Card>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "tp", label: "Phosphorus" }, { id: "chl", label: "Chlorophyll-a" }, { id: "drivers", label: "Environmental drivers" },
          { id: "corr", label: "Correlation" }, { id: "trends", label: "Historical trends" }, { id: "nutrient", label: "Nutrient-bloom relationship" },
        ]}
      />
      <div className="mt-4 space-y-4">
        {rows.length < 20 && <Note tone="warn">Very few observations match these filters; charts may be sparse.</Note>}

        {tab === "tp" && (
          <div className="grid gap-4 md:grid-cols-2">
            <Card title="Total phosphorus over time (monthly mean, µg/L)">{lineChart("tp", "")}</Card>
            <Card title="Phosphorus by lake (median and 90th percentile, µg/L)">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={byLakeStats("tp")}><CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} /><XAxis dataKey="lake" tick={AXIS} /><YAxis tick={AXIS} /><Tooltip formatter={(v) => v.toFixed(1)} /><RLegend wrapperStyle={{ fontSize: 12 }} /><Bar dataKey="Median" fill="#5aa9e6" /><Bar dataKey="P90" fill="#8fc1e3" /></BarChart>
              </ResponsiveContainer>
            </Card>
            <Card title="Mean phosphorus by station (µg/L)" subtitle="Distribution across monitoring stations">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={stationMeans("tp")}><CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} /><XAxis dataKey="id" tick={{ ...AXIS, fontSize: 9 }} angle={-60} textAnchor="end" height={55} interval={0} /><YAxis tick={AXIS} /><Tooltip formatter={(v) => v.toFixed(1)} /><Bar dataKey="v" name="Mean TP">{stationMeans("tp").map((d) => <Cell key={d.id} fill={LAKE_COLORS[d.lake]} />)}</Bar></BarChart>
              </ResponsiveContainer>
            </Card>
            <Card title="Observed bloom frequency by phosphorus level (%)" subtitle="Bins with fewer than 10 observations are hidden">
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={bloomByBin("tp", [0, 3, 5, 8, 12, 18, 25, 35, 50, 100])}><CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} /><XAxis dataKey="bin" tick={AXIS} label={{ value: "TP bin (µg/L)", position: "insideBottom", offset: -2, fontSize: 11 }} /><YAxis tick={AXIS} unit="%" /><Tooltip formatter={(v, n) => (n === "n" ? v : `${v.toFixed(1)}%`)} /><Bar dataKey="rate" name="Bloom frequency" fill="#35d0c4" /></ComposedChart>
              </ResponsiveContainer>
            </Card>
          </div>
        )}

        {tab === "chl" && (
          <div className="grid gap-4 md:grid-cols-2">
            <Card title="Chlorophyll-a over time (monthly mean, µg/L)">{lineChart("chl", "")}</Card>
            <Card title="Chlorophyll-a by lake (median and 90th percentile, µg/L)">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={byLakeStats("chl")}><CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} /><XAxis dataKey="lake" tick={AXIS} /><YAxis tick={AXIS} /><Tooltip formatter={(v) => v.toFixed(1)} /><RLegend wrapperStyle={{ fontSize: 12 }} /><Bar dataKey="Median" fill="#35d0c4" /><Bar dataKey="P90" fill="#8fd6d2" /></BarChart>
              </ResponsiveContainer>
            </Card>
            <Card title="Observed bloom frequency by chlorophyll-a level (%)" subtitle="Chlorophyll-a measured at the same time as the bloom label. See the leakage warning on Model Performance.">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={bloomByBin("chl", [0, 1, 2, 4, 8, 12, 20, 35, 60, 200])}><CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} /><XAxis dataKey="bin" tick={AXIS} /><YAxis tick={AXIS} unit="%" /><Tooltip formatter={(v) => `${v.toFixed(1)}%`} /><Bar dataKey="rate" fill="#35d0c4" /></BarChart>
              </ResponsiveContainer>
            </Card>
            <Card title="Mean chlorophyll-a: bloom versus no bloom (µg/L)">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={LAKE_NAMES.map((l) => {
                  const sub = rows.filter((o) => stationById[o.station].lake === l);
                  const b = sub.filter((o) => o.bloom).map((o) => o.chl);
                  const n = sub.filter((o) => !o.bloom).map((o) => o.chl);
                  return { lake: l, "Bloom observed": b.length ? mean(b) : 0, "No bloom": n.length ? mean(n) : 0 };
                })}><CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} /><XAxis dataKey="lake" tick={AXIS} /><YAxis tick={AXIS} /><Tooltip formatter={(v) => v.toFixed(1)} /><RLegend wrapperStyle={{ fontSize: 12 }} /><Bar dataKey="Bloom observed" fill="#a98bff" /><Bar dataKey="No bloom" fill="#6b7494" /></BarChart>
              </ResponsiveContainer>
            </Card>
          </div>
        )}

        {tab === "drivers" && (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <Card title={`${VARS[variable].label} over time (monthly mean, ${VARS[variable].unit})`}>{lineChart(variable, "")}</Card>
              <Card title={`${VARS[variable].label} by season (${VARS[variable].unit})`}>{seasonChart(variable, "")}</Card>
              <Card title={`Bloom frequency by ${VARS[variable].label.toLowerCase()} level (%)`}>
                {(() => {
                  const vals = rows.map((o) => o[variable]);
                  const edges = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0001].map((q) => quantile(vals, q));
                  const bins = edges.slice(0, -1).map((lo, i) => {
                    const sub = rows.filter((o) => o[variable] >= lo && (i === 9 ? o[variable] <= edges[10] : o[variable] < edges[i + 1]));
                    return { bin: fmt(lo, variable === "rain" ? 0 : 1), rate: sub.length ? (sub.filter((o) => o.bloom).length / sub.length) * 100 : 0 };
                  });
                  return (
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={bins}><CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} /><XAxis dataKey="bin" tick={AXIS} label={{ value: `${VARS[variable].label} decile start (${VARS[variable].unit})`, position: "insideBottom", offset: -2, fontSize: 11 }} /><YAxis tick={AXIS} unit="%" /><Tooltip formatter={(v) => `${v.toFixed(1)}%`} /><Bar dataKey="rate" fill="#5aa9e6" /></BarChart>
                    </ResponsiveContainer>
                  );
                })()}
              </Card>
              <Card title="Driver summary (selected observations)">
                <table className="w-full"><thead><tr><th className="th">Variable</th><th className="th">Mean</th><th className="th">Median</th><th className="th">P10</th><th className="th">P90</th><th className="th">r with bloom</th></tr></thead>
                  <tbody>{Object.entries(VARS).map(([k, v]) => { const vals = rows.map((o) => o[k]); return (
                    <tr key={k} className={k === variable ? "bg-teal-50" : ""}><td className="td">{v.label} <span className="text-slate-400">({v.unit})</span></td><td className="td">{fmt(mean(vals), 2)}</td><td className="td">{fmt(median(vals), 2)}</td><td className="td">{fmt(quantile(vals, 0.1), 2)}</td><td className="td">{fmt(quantile(vals, 0.9), 2)}</td><td className="td">{fmt(pearson(vals, rows.map((o) => o.bloom)), 2)}</td></tr>); })}</tbody></table>
                <p className="mt-2 text-[11px] text-slate-500">Rainfall is not assumed to raise risk everywhere: in this simulation moderate rain adds nutrient runoff, while very heavy rain is assumed to dilute and mix.</p>
              </Card>
            </div>
          </>
        )}

        {tab === "corr" && <CorrelationTab rows={rows} />}

        {tab === "trends" && (
          <TrendsTab rows={rows} variable={variable} lake={lake} station={station} years={years} history={history} groupNames={groupNames} groupOf={groupOf} colorOf={colorOf} seasonChart={seasonChart} />
        )}

        {tab === "nutrient" && <NutrientTab rows={rows} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- correlation
function CorrelationTab({ rows }) {
  const [hover, setHover] = useState(null);
  const [xv, setXv] = useState("tp");
  const [yv, setYv] = useState("chl");
  const matrix = CORR_VARS.map((a) => CORR_VARS.map((b) => pearson(rows.map((o) => o[a]), rows.map((o) => o[b]))));
  const sample = rows.filter((_, i) => i % Math.max(1, Math.ceil(rows.length / 1200)) === 0);
  const r = pearson(rows.map((o) => o[xv]), rows.map((o) => o[yv]));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Correlation matrix (Pearson r)" subtitle="Hover for the coefficient. Click a cell to plot that pair.">
        <div className="overflow-x-auto">
          <table className="border-separate border-spacing-0.5 text-[11px]">
            <thead><tr><th />{CORR_VARS.map((v) => <th key={v} className="px-1 pb-1 text-left font-medium text-slate-600" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", height: 90 }}>{CORR_LABEL[v]}</th>)}</tr></thead>
            <tbody>
              {CORR_VARS.map((a, i) => (
                <tr key={a}>
                  <td className="pr-2 text-right font-medium text-slate-600">{CORR_LABEL[a]}</td>
                  {CORR_VARS.map((b, j) => (
                    <td key={b} title={`${CORR_LABEL[a]} vs ${CORR_LABEL[b]}: r = ${fmt(matrix[i][j], 3)}`} onMouseEnter={() => setHover({ a, b, r: matrix[i][j] })} onMouseLeave={() => setHover(null)} onClick={() => { if (a !== b && a !== "bloom") { setXv(a); setYv(b); } }}
                      className="h-9 w-12 cursor-pointer rounded text-center font-medium" style={{ background: corrColor(matrix[i][j]), color: Math.abs(matrix[i][j]) > 0.6 ? "#fff" : "#e3e7f6" }}>
                      {fmt(matrix[i][j], 2)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 h-5 text-xs text-slate-600">{hover ? `${CORR_LABEL[hover.a]} vs ${CORR_LABEL[hover.b]}: r = ${fmt(hover.r, 3)}` : "Teal = positive, purple = negative."}</div>
        <Note tone="warn" title="Correlation is not causation.">Two variables can move together because of a shared driver (for example season or station) without one causing the other.</Note>
      </Card>
      <Card title="Scatter plot" subtitle={`Pearson r = ${fmt(r, 3)} · ${sample.length} sampled points`}
        right={<div className="flex gap-2"><select className="select" value={xv} onChange={(e) => setXv(e.target.value)}>{Object.entries(VARS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select><select className="select" value={yv} onChange={(e) => setYv(e.target.value)}>{Object.entries(VARS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>}>
        <ResponsiveContainer width="100%" height={340}>
          <ScatterChart margin={{ left: 0, right: 10, top: 5, bottom: 15 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.08)" />
            <XAxis dataKey="x" type="number" name={VARS[xv].label} tick={AXIS} label={{ value: `${VARS[xv].label} (${VARS[xv].unit})`, position: "insideBottom", offset: -8, fontSize: 11 }} />
            <YAxis dataKey="y" type="number" name={VARS[yv].label} tick={AXIS} label={{ value: `${VARS[yv].label} (${VARS[yv].unit})`, angle: -90, position: "insideLeft", fontSize: 11 }} />
            <ZAxis range={[14, 14]} />
            <Tooltip cursor={{ strokeDasharray: "3 3" }} formatter={(v) => Number(v).toFixed(2)} />
            <RLegend wrapperStyle={{ fontSize: 12 }} />
            <Scatter name="No bloom" data={sample.filter((o) => !o.bloom).map((o) => ({ x: o[xv], y: o[yv] }))} fill="#7d89ad" fillOpacity={0.5} />
            <Scatter name="Bloom observed" data={sample.filter((o) => o.bloom).map((o) => ({ x: o[xv], y: o[yv] }))} fill="#a98bff" fillOpacity={0.7} />
          </ScatterChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- historical trends
function TrendsTab({ rows, variable, lake, station, years, history, groupNames, groupOf, colorOf, seasonChart }) {
  const annual = [];
  for (let y = years[0]; y <= years[1]; y++) {
    const sub = rows.filter((o) => o.year === y);
    if (!sub.length) continue;
    const prev = annual.length ? annual[annual.length - 1] : null;
    const value = mean(sub.map((o) => o[variable]));
    const bloom = (sub.filter((o) => o.bloom).length / sub.length) * 100;
    annual.push({ year: y, value, bloom, change: prev ? ((value - prev.value) / prev.value) * 100 : null });
  }
  const monthly = MONTHS.map((m, i) => {
    const row = { month: m };
    const byGroup = groupBy(rows.filter((o) => o.month === i + 1), groupOf);
    groupNames.forEach((g) => (row[g] = byGroup[g] ? mean(byGroup[g].map((o) => o[variable])) : 0));
    return row;
  });

  // locations with increasing risk: slope of summer-season (Jun-Sep) mean predicted probability across years
  const increasing = monitoredStations.filter((s) => (lake === "All" || s.lake === lake) && (station === "All" || s.id === station)).map((s) => {
    const sub = history.filter((h) => h.station === s.id && h.month >= 6 && h.month <= 9 && h.year >= years[0] && h.year <= years[1]);
    const byYear = groupBy(sub, (h) => h.year);
    const ys = Object.keys(byYear).map(Number).sort();
    if (ys.length < 3) return null;
    const pFit = linearFit(ys, ys.map((y) => mean(byYear[y].map((h) => h.p)) * 100));
    const bFit = linearFit(ys, ys.map((y) => (byYear[y].filter((h) => h.bloom).length / byYear[y].length) * 100));
    return { id: s.id, name: s.name, lake: s.lake, slopeP: pFit.slope, slopeB: bFit.slope, last: mean(byYear[ys[ys.length - 1]].map((h) => h.p)) * 100 };
  }).filter(Boolean).sort((a, b) => b.slopeP - a.slopeP);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title={`Monthly comparison: ${VARS[variable].label} (${VARS[variable].unit})`}>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={monthly}><CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} /><XAxis dataKey="month" tick={AXIS} /><YAxis tick={AXIS} /><Tooltip formatter={(v) => v.toFixed(2)} /><RLegend wrapperStyle={{ fontSize: 12 }} />{groupNames.map((g) => <Bar key={g} dataKey={g} fill={colorOf(g)} />)}</BarChart>
        </ResponsiveContainer>
      </Card>
      <Card title={`Seasonal comparison: ${VARS[variable].label} (${VARS[variable].unit})`}>{seasonChart(variable, "")}</Card>
      <Card title="Year-over-year change" subtitle={`${VARS[variable].label} annual mean and observed bloom frequency`}>
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={annual}><CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} /><XAxis dataKey="year" tick={AXIS} /><YAxis yAxisId="l" tick={AXIS} /><YAxis yAxisId="r" orientation="right" tick={AXIS} unit="%" /><Tooltip formatter={(v) => v.toFixed(2)} /><RLegend wrapperStyle={{ fontSize: 12 }} /><Bar yAxisId="l" dataKey="value" name={VARS[variable].label} fill="#5aa9e6" /><Line yAxisId="r" dataKey="bloom" name="Bloom frequency (%)" stroke="#a98bff" strokeWidth={2} /></ComposedChart>
        </ResponsiveContainer>
        <table className="mt-2 w-full"><thead><tr><th className="th">Year</th><th className="th">Mean</th><th className="th">Change vs prior year</th><th className="th">Bloom freq.</th></tr></thead>
          <tbody>{annual.map((a) => <tr key={a.year}><td className="td">{a.year}</td><td className="td">{fmt(a.value, 2)}</td><td className="td">{a.change === null ? "-" : `${a.change >= 0 ? "+" : ""}${a.change.toFixed(1)}%`}</td><td className="td">{fmt(a.bloom, 1)}%</td></tr>)}</tbody></table>
      </Card>
      <Card title="Locations with increasing risk" subtitle="Trend in summer (Jun-Sep) mean predicted bloom probability, percentage points per year (early-warning model)">
        {increasing.length === 0 ? <p className="text-sm text-slate-500">Select a wider year range (at least three years).</p> : (
          <table className="w-full"><thead><tr><th className="th">Station</th><th className="th">Trend in predicted prob.</th><th className="th">Trend in observed freq.</th><th className="th">Latest summer</th></tr></thead>
            <tbody>{increasing.slice(0, 10).map((d) => <tr key={d.id}><td className="td font-semibold">{d.id}<div className="text-[11px] font-normal text-slate-500">{d.name}</div></td><td className="td"><span className={d.slopeP > 0.5 ? "font-semibold text-red-700" : ""}>{d.slopeP >= 0 ? "+" : ""}{d.slopeP.toFixed(2)} pts/yr</span></td><td className="td">{d.slopeB >= 0 ? "+" : ""}{d.slopeB.toFixed(2)} pts/yr</td><td className="td">{d.last.toFixed(0)}%</td></tr>)}</tbody></table>
        )}
        <p className="mt-2 text-[11px] text-slate-500">Trends over a few seasons are noisy. Treat the ranking as a prompt for review, not a finding.</p>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- nutrient-bloom relationship (Model 4)
function NutrientTab({ rows }) {
  const { settings } = useApp();
  const ref = RESULTS.reference;
  const [tpValue, setTpValue] = useState(20);
  const [others, setOthers] = useState({ chl: Math.round(ref.Chl * 10) / 10, temp: 22, rain: Math.round(ref.Rain), doxy: Math.round(ref.DO * 10) / 10, season: "Summer" });
  const [seasonFilter, setSeasonFilter] = useState("All");
  const modelKey = settings.model;

  const sub = seasonFilter === "All" ? rows : rows.filter((o) => o.season === seasonFilter);
  const fit = useMemo(() => (sub.length > 30 ? logisticFit1D(sub.map((o) => Math.log(o.tp)), sub.map((o) => o.bloom)) : null), [sub]);
  const uniP = (tp) => (fit ? 1 / (1 + Math.exp(-(fit.a + fit.b * Math.log(tp)))) : null);

  // observed bloom frequency in log-spaced phosphorus bins
  const edges = [1, 2, 3, 4, 6, 8, 11, 15, 20, 28, 40, 60, 90];
  const binned = edges.slice(0, -1).map((lo, i) => {
    const s = sub.filter((o) => o.tp >= lo && o.tp < edges[i + 1]);
    return { tp: Math.sqrt(lo * edges[i + 1]), rate: s.length >= 8 ? s.filter((o) => o.bloom).length / s.length : null, n: s.length };
  }).filter((b) => b.rate !== null);

  const grid = Array.from({ length: 60 }, (_, i) => Math.exp(Math.log(1.5) + (i / 59) * (Math.log(90) - Math.log(1.5))));
  const curve = grid.map((tp) => {
    const cond = predict(modelKey, "early", { ...others, tp });
    const row = { tp, Conditional: cond.p * 100, Univariate: uniP(tp) === null ? null : uniP(tp) * 100 };
    SEASONS.forEach((s) => (row[s] = predict(modelKey, "early", { ...others, tp, season: s }).p * 100));
    return row;
  });
  const plotData = [...curve, ...binned.map((b) => ({ tp: b.tp, Observed: b.rate * 100 }))].sort((a, b) => a.tp - b.tp);
  const atSelected = predict(modelKey, "early", { ...others, tp: tpValue });

  // chlorophyll-a versus phosphorus (log-log regression)
  const cp = sub.filter((o) => o.tp > 0 && o.chl > 0);
  const lf = cp.length > 30 ? linearFit(cp.map((o) => Math.log(o.tp)), cp.map((o) => Math.log(o.chl))) : null;
  const sample = cp.filter((_, i) => i % Math.max(1, Math.ceil(cp.length / 900)) === 0);
  const lineTP = [2, 5, 10, 20, 40, 80].map((t) => ({ x: t, y: lf ? Math.exp(lf.intercept + lf.slope * Math.log(t)) : null }));

  // univariate fit by season
  const seasonFits = SEASONS.map((s) => {
    const q = rows.filter((o) => o.season === s);
    if (q.length < 30 || q.filter((o) => o.bloom).length < 5) return { season: s, n: q.length, slope: null };
    const f = logisticFit1D(q.map((o) => Math.log(o.tp)), q.map((o) => o.bloom));
    return { season: s, n: q.length, slope: f.b, or2: Math.exp(f.b * Math.log(2)), rate: q.filter((o) => o.bloom).length / q.length };
  });
  const setO = (k, v) => setOthers({ ...others, [k]: v });

  return (
    <div className="space-y-4">
      <Note tone="warn" title="Conditional estimate, not proof of causation.">The curves show how the fitted models respond when phosphorus changes and everything else is held fixed. In this simulation phosphorus was built into the data-generating process, so the relationship is expected here; in real data, phosphorus is entangled with temperature, season and location, and a model fit alone cannot establish cause.</Note>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Phosphorus versus bloom probability" subtitle="Dots: observed bloom frequency per phosphorus bin. Lines: fitted probability curves."
          right={<select className="select" value={seasonFilter} onChange={(e) => setSeasonFilter(e.target.value)}><option>All</option>{SEASONS.map((s) => <option key={s}>{s}</option>)}</select>}>
          <ResponsiveContainer width="100%" height={340}>
            <ComposedChart data={plotData} margin={{ left: 0, right: 10, top: 5, bottom: 15 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" />
              <XAxis dataKey="tp" type="number" scale="log" domain={[1.5, 90]} ticks={[2, 5, 10, 20, 50, 90]} tickFormatter={(v) => Math.round(v)} tick={AXIS} label={{ value: "Total phosphorus (µg/L, log scale)", position: "insideBottom", offset: -8, fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={AXIS} unit="%" />
              <Tooltip formatter={(v) => (v === null ? "n/a" : `${Number(v).toFixed(1)}%`)} labelFormatter={(v) => `TP ${Number(v).toFixed(1)} µg/L`} />
              <RLegend verticalAlign="top" wrapperStyle={{ fontSize: 12 }} />
              <Line dataKey="Univariate" name="Fitted: bloom ~ ln(TP) only" stroke="#5aa9e6" strokeWidth={2.5} dot={false} connectNulls />
              <Line dataKey="Conditional" name="Model, other inputs fixed" stroke="#35d0c4" strokeWidth={2.5} strokeDasharray="6 3" dot={false} connectNulls />
              <Line dataKey="Observed" name="Observed bin frequency" stroke="#a98bff" strokeWidth={0} legendType="circle" dot={{ r: 5, fill: "#a98bff", stroke: "#fff", strokeWidth: 1 }} activeDot={{ r: 6 }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
          {fit && <p className="text-xs text-slate-600">Fitted on {sub.length.toLocaleString()} observations: logit P = {fit.a.toFixed(2)} + {fit.b.toFixed(2)} × ln(TP). Doubling TP multiplies the odds by {Math.exp(fit.b * Math.log(2)).toFixed(2)}. This marginal fit ignores other variables, so it mixes lake, station and season differences.</p>}
        </Card>
        <Card title="Interactive phosphorus control" subtitle="Move phosphorus; other inputs stay fixed (early-warning model)">
          <Field label={`Total phosphorus: ${tpValue} µg/L`}><input type="range" min="2" max="80" step="1" value={tpValue} onChange={(e) => setTpValue(+e.target.value)} className="w-full" /></Field>
          <div className="mt-3 rounded-lg bg-slate-50 p-3">
            <div className="label">Predicted bloom probability</div>
            <div className="text-3xl font-semibold text-ink">{(atSelected.p * 100).toFixed(0)}%</div>
            <div className="text-[11px] text-slate-500">Logistic {(atSelected.pLR * 100).toFixed(0)}% · Random forest {(atSelected.pRF * 100).toFixed(0)}% · Marginal fit {uniP(tpValue) === null ? "n/a" : (uniP(tpValue) * 100).toFixed(0) + "%"}</div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Field label={`Chl-a ${others.chl} µg/L`}><input type="range" min="0.5" max="40" step="0.5" value={others.chl} onChange={(e) => setO("chl", +e.target.value)} className="w-full" /></Field>
            <Field label={`Temp ${others.temp} °C`}><input type="range" min="0" max="28" step="0.5" value={others.temp} onChange={(e) => setO("temp", +e.target.value)} className="w-full" /></Field>
            <Field label={`Rain ${others.rain} mm`}><input type="range" min="0" max="120" step="1" value={others.rain} onChange={(e) => setO("rain", +e.target.value)} className="w-full" /></Field>
            <Field label={`DO ${others.doxy} mg/L`}><input type="range" min="6" max="15" step="0.1" value={others.doxy} onChange={(e) => setO("doxy", +e.target.value)} className="w-full" /></Field>
          </div>
          <Field label="Season"><select className="select w-full" value={others.season} onChange={(e) => setO("season", e.target.value)}>{SEASONS.map((s) => <option key={s}>{s}</option>)}</select></Field>
        </Card>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Chlorophyll-a versus phosphorus" subtitle={lf ? `Log-log fit: ln(Chl) = ${lf.intercept.toFixed(2)} + ${lf.slope.toFixed(2)} ln(TP), R² = ${lf.r2.toFixed(2)}` : "Not enough data"}>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart margin={{ left: 0, right: 10, top: 5, bottom: 15 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" />
              <XAxis dataKey="x" type="number" scale="log" domain={[1, 100]} allowDataOverflow tick={AXIS} tickFormatter={(v) => Math.round(v)} label={{ value: "Total phosphorus (µg/L)", position: "insideBottom", offset: -8, fontSize: 11 }} />
              <YAxis dataKey="y" type="number" scale="log" domain={[0.3, 100]} allowDataOverflow tick={AXIS} tickFormatter={(v) => Number(v).toFixed(v < 1 ? 1 : 0)} label={{ value: "Chlorophyll-a (µg/L)", angle: -90, position: "insideLeft", fontSize: 11 }} />
              <ZAxis range={[12, 12]} />
              <Tooltip formatter={(v) => Number(v).toFixed(2)} />
              <Scatter name="Observations" data={sample.map((o) => ({ x: o.tp, y: o.chl }))} fill="#5aa9e6" fillOpacity={0.35} />
              <Line data={lineTP} dataKey="y" name="Fitted" stroke="#eef0fb" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Seasonal comparison" subtitle="Model curves by season (other inputs fixed) and marginal fits from the data">
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={curve}><CartesianGrid stroke="rgba(255,255,255,0.08)" /><XAxis dataKey="tp" type="number" scale="log" domain={[1.5, 90]} ticks={[2, 5, 10, 20, 50, 90]} tickFormatter={(v) => Math.round(v)} tick={AXIS} /><YAxis domain={[0, 100]} tick={AXIS} unit="%" /><Tooltip formatter={(v) => `${Number(v).toFixed(1)}%`} labelFormatter={(v) => `TP ${Number(v).toFixed(1)}`} /><RLegend wrapperStyle={{ fontSize: 12 }} />
              {SEASONS.map((s, i) => <Line key={s} dataKey={s} stroke={["#5aa9e6", "#4f8a3c", "#d89a00", "#d4a95a"][i]} dot={false} strokeWidth={2} />)}
            </ComposedChart>
          </ResponsiveContainer>
          <table className="mt-2 w-full"><thead><tr><th className="th">Season</th><th className="th">n</th><th className="th">Bloom freq.</th><th className="th">Odds ratio per doubling of TP</th></tr></thead>
            <tbody>{seasonFits.map((s) => <tr key={s.season}><td className="td">{s.season}</td><td className="td">{s.n}</td><td className="td">{s.rate === undefined ? "n/a" : (s.rate * 100).toFixed(1) + "%"}</td><td className="td">{s.slope === null ? "too few blooms" : s.or2.toFixed(2)}</td></tr>)}</tbody></table>
        </Card>
      </div>
    </div>
  );
}
