import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend as RLegend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApp } from "../state.jsx";
import { Card, Kpi, Legend, Note, PageHeader, RiskBadge, SimBadge, AXIS, LAKE_COLORS } from "../components/ui.jsx";
import RiskMap from "../components/RiskMap.jsx";
import { LAKE_NAMES, DATES, observations, addDays, stationById } from "../lib/data.js";
import { LEVELS, RISK_COLORS } from "../lib/risk.js";
import { runAnalysis } from "../lib/analysis.js";
import { mean, pct } from "../lib/stats.js";

export default function Overview() {
  const { run, alerts, settings, dateStr, goto, setSelectedId, selectedId } = useApp();
  const all = run.results;
  const valid = all.filter((r) => r.p !== null);
  const monitored = all.filter((r) => r.monitored);
  const unmonitored = all.filter((r) => !r.monitored);
  const elevated = (r) => r.level === "High" || r.level === "Critical";

  const highCritical = all.filter(elevated);
  const unmonElevated = unmonitored.filter(elevated);
  const avgP = mean(valid.map((r) => r.p));
  const needVerify = new Set(alerts.filter((a) => a.type === "VERIFY" || a.type === "FIELD_SAMPLING").map((a) => a.locationId));

  // chart data
  const byLake = LAKE_NAMES.map((lake) => {
    const m = monitored.filter((r) => r.lake === lake);
    const u = unmonitored.filter((r) => r.lake === lake && r.p !== null);
    return { lake, Monitored: mean(m.map((r) => r.p)) * 100, Unmonitored: u.length ? mean(u.map((r) => r.p)) * 100 : null };
  });
  const dist = LEVELS.map((l) => ({
    level: l,
    Monitored: monitored.filter((r) => r.level === l).length,
    Unmonitored: unmonitored.filter((r) => r.level === l).length,
  }));
  const monthly = useMemo(() => {
    const rows = [];
    for (let m = 1; m <= 12; m++) {
      const row = { month: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1] };
      LAKE_NAMES.forEach((lake) => {
        const obs = observations.filter((o) => o.month === m && stationById[o.station].lake === lake);
        row[lake] = obs.length ? (obs.filter((o) => o.bloom).length / obs.length) * 100 : 0;
      });
      rows.push(row);
    }
    return rows;
  }, []);
  const trend = useMemo(() => {
    const idx = DATES.indexOf(dateStr);
    const dates = DATES.slice(Math.max(3, idx - 9), idx + 1);
    return dates.map((d) => {
      const r = runAnalysis(d, settings).results.filter((x) => x.p !== null);
      const row = { date: d.slice(5) };
      LAKE_NAMES.forEach((lake) => (row[lake] = mean(r.filter((x) => x.lake === lake).map((x) => x.p)) * 100));
      row.All = mean(r.map((x) => x.p)) * 100;
      return row;
    });
  }, [dateStr, settings]);
  const movers = [...all].filter((r) => r.delta !== null).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 5);

  // operational summary generated from the numbers above
  const lakeCounts = LAKE_NAMES.map((lake) => ({ lake, n: highCritical.filter((r) => r.lake === lake).length, total: all.filter((r) => r.lake === lake).length })).sort((a, b) => b.n - a.n);
  const weakUnmon = alerts.filter((a) => a.type === "FIELD_SAMPLING" && a.status === "Unmonitored");
  const staleStations = all.filter((r) => r.monitored && r.stale);
  const escalated = all.filter((r) => r.escalating).sort((a, b) => b.delta - a.delta);
  const top = [...valid].sort((a, b) => b.p - a.p)[0];
  const summary = [];
  if (lakeCounts[0].n > 0) summary.push(`Lake ${lakeCounts[0].lake} has the largest number of simulated High or Critical locations (${lakeCounts[0].n} of ${lakeCounts[0].total}).`);
  else summary.push("No location is classified High or Critical in this run.");
  if (top) summary.push(`The highest estimated bloom probability is ${pct(top.p)} at ${top.id} (${top.name}), classified ${top.level}.`);
  summary.push(`${unmonElevated.length} of ${unmonitored.length} unmonitored locations have elevated estimated probability${weakUnmon.length ? `; ${weakUnmon.length} of them rest on weak supporting data (${weakUnmon.map((a) => a.locationId).join(", ")}), so targeted field sampling is recommended rather than treating them as confirmed` : ""}.`);
  if (staleStations.length) summary.push(`${staleStations.length} monitored station(s) have observations older than ${settings.staleDays} days (${staleStations.map((r) => r.id).join(", ")}) and need verification.`);
  summary.push(escalated.length ? `${escalated.length} location(s) escalated since the previous run, led by ${escalated[0].id} (+${(escalated[0].delta * 100).toFixed(0)} percentage points).` : "No location escalated substantially since the previous run.");

  return (
    <div>
      <PageHeader
        title="Executive Overview"
        subtitle={`Simulated conditions across the Great Lakes for the analysis run of ${dateStr}. Probabilities are model estimates for the next sampling period (about 14 days ahead).`}
        right={<SimBadge>SIMULATED ANALYSIS · {dateStr}</SimBadge>}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Monitoring stations" value={monitored.length} sub={`${unmonitored.length} unmonitored prediction locations`} accent="#5aa9e6" />
        <Kpi label="High or Critical locations" value={highCritical.length} sub={`${highCritical.filter((r) => r.monitored).length} monitored · ${highCritical.filter((r) => !r.monitored).length} unmonitored`} accent={RISK_COLORS.High} />
        <Kpi label="Unmonitored, elevated risk" value={unmonElevated.length} sub={`of ${unmonitored.length} unmonitored locations`} accent={RISK_COLORS.Critical} />
        <Kpi label="Average bloom probability" value={pct(avgP)} sub={`monitored ${pct(mean(monitored.map((r) => r.p)))}`} accent="#35d0c4" />
        <Kpi label="Needing verification" value={pct(needVerify.size / all.length)} sub={`${needVerify.size} of ${all.length} locations (stale data or weak support)`} accent={RISK_COLORS.Moderate} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Risk distribution map" subtitle="Circles are monitored stations, diamonds are unmonitored locations (estimated). Dashed red ring: high estimated risk with limited support." right={<Legend />}>
          <RiskMap locations={all} selectedId={selectedId} onSelect={(id) => { setSelectedId(id); goto("geo", id); }} height={400} compact />
        </Card>
        <Card title="Operational summary" subtitle="Generated from this run's calculations">
          <ul className="space-y-2 text-sm leading-relaxed text-slate-700">
            {summary.map((s, i) => <li key={i} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-600" />{s}</li>)}
          </ul>
          <div className="mt-3"><Note tone="warn">Model-generated candidates only. Nothing here is an official environmental warning.</Note></div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card title="Mean predicted bloom probability by lake (%)" subtitle="Monitored stations and unmonitored estimates">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={byLake}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
              <XAxis dataKey="lake" tick={AXIS} />
              <YAxis tick={AXIS} unit="%" />
              <Tooltip formatter={(v) => (v === null ? "n/a" : `${v.toFixed(1)}%`)} />
              <RLegend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Monitored" fill="#5aa9e6" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Unmonitored" fill="#8fc1e3" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Locations by risk level" subtitle="Colours match every other view">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={dist}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
              <XAxis dataKey="level" tick={AXIS} />
              <YAxis tick={AXIS} allowDecimals={false} />
              <Tooltip />
              <RLegend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Monitored" stackId="a" fill="#cdd4ea">{dist.map((d) => <Cell key={d.level} fill={RISK_COLORS[d.level]} />)}</Bar>
              <Bar dataKey="Unmonitored" stackId="a" fill="#6b7494">{dist.map((d) => <Cell key={d.level} fill={RISK_COLORS[d.level]} fillOpacity={0.45} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="mt-1 text-[11px] text-slate-500">Solid = monitored, faded = unmonitored (estimated).</p>
        </Card>
        <Card title="Observed bloom frequency by month (%)" subtitle="Historical seasonal pattern, 2018-2025 (simulated observations)">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={monthly}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
              <XAxis dataKey="month" tick={AXIS} />
              <YAxis tick={AXIS} unit="%" />
              <Tooltip formatter={(v) => `${v.toFixed(1)}%`} />
              <RLegend wrapperStyle={{ fontSize: 12 }} />
              {LAKE_NAMES.map((l) => <Line key={l} type="monotone" dataKey={l} stroke={LAKE_COLORS[l]} dot={false} strokeWidth={2} />)}
            </LineChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Recent change in estimated risk" subtitle="Mean predicted probability (%) over the last 10 runs">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={trend}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
              <XAxis dataKey="date" tick={AXIS} />
              <YAxis tick={AXIS} unit="%" />
              <Tooltip formatter={(v) => `${v.toFixed(1)}%`} />
              <RLegend wrapperStyle={{ fontSize: 12 }} />
              {LAKE_NAMES.map((l) => <Line key={l} type="monotone" dataKey={l} stroke={LAKE_COLORS[l]} dot={false} strokeWidth={1.5} />)}
              <Line type="monotone" dataKey="All" stroke="#eef0fb" strokeWidth={3} dot={false} strokeDasharray="5 3" />
            </LineChart>
          </ResponsiveContainer>
          <div className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-600">
            <div className="label mb-1">Largest movers vs previous run ({addDays(dateStr, -14)})</div>
            {movers.map((r) => (
              <div key={r.id} className="flex items-center justify-between py-0.5">
                <span>{r.id} · {r.name}</span>
                <span className="flex items-center gap-2"><RiskBadge level={r.level} /><span className={r.delta >= 0 ? "text-red-700" : "text-emerald-700"}>{r.delta >= 0 ? "+" : ""}{(r.delta * 100).toFixed(0)} pts</span></span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

