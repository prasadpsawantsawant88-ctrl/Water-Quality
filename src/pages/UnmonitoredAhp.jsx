import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApp } from "../state.jsx";
import { Card, EstimatedTag, Field, Kpi, Note, PageHeader, RiskBadge, SimBadge, AXIS } from "../components/ui.jsx";
import RiskMap from "../components/RiskMap.jsx";
import { monitoredStations } from "../lib/data.js";
import { RISK_COLORS } from "../lib/risk.js";
import { AHP_KEYS, normalise, categoryOf } from "../lib/ahp.js";
import { INDICATORS } from "../lib/spatialData.js";
import { backTransform, MODELS } from "../lib/kriging.js";
import { DEFAULT_INT_CFG } from "../lib/integration.js";
import VALID from "../data/integration_validation.json";

const LEVEL_COLOR = { Priority: "#ff5c6c", Soon: "#ff9f4a", "Reduce uncertainty": "#a98bff", Routine: "#3ecf8e" };
const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "n/a");

export default function UnmonitoredAhp() {
  const { integration, intCfg, setIntCfg, ahpCfg, ahp, run, dateStr, goto } = useApp();
  const rows = integration.rows.filter((r) => r.ok);
  const [sel, setSel] = useState(null);
  const r = integration.byId[sel] && integration.byId[sel].ok ? integration.byId[sel] : rows.sort((a, b) => a.priority - b.priority)[0];
  const set = (patch) => setIntCfg({ ...intCfg, ...patch });

  // map: unmonitored locations coloured by AHP band, monitored stations in grey for context
  const mapLocs = useMemo(() => [
    ...rows.map((x) => ({ ...x, p: 1, monitored: false })),
    ...monitoredStations.map((s) => ({ ...s, p: 1, monitored: true, kind: "station" })),
  ], [integration]);
  const colorFn = (x) => (x.kind === "station" ? "#6b7494" : RISK_COLORS[x.category] || "#8c95b3");
  const tooltipFn = (x) => x.kind === "station" ? `<strong>${x.id}</strong> monitored station` : `<strong>${x.id}</strong> ${x.name}<br/>INTERPOLATED AHP score ${f(x.score, 0)} (${x.category})<br/>90% interval ${f(x.mc.p05, 0)}–${f(x.mc.p95, 0)} · P(≥${x.mc.threshold}) ${(x.mc.pExceed * 100).toFixed(0)}%`;

  const kpiPriority = rows.filter((x) => x.action.level === "Priority").length;
  const kpiMean = rows.reduce((a, x) => a + x.score, 0) / (rows.length || 1);

  return (
    <div className="space-y-4">
      <PageHeader title="Unmonitored Area Intelligence" subtitle={`Where nobody samples: Kriging estimates each AHP indicator, AHP turns them into a risk score, and a Monte Carlo run carries the Kriging uncertainty through to a risk interval. Analysis run ${dateStr}.`} right={<SimBadge>SIMULATED DATA · INTERPOLATED</SimBadge>} />
      <Note tone="warn" title="Three different quantities.">
        Kriged concentrations (µg/L, mg/L, °C…) are estimated values. The AHP score (0–100) is a relative multi-criteria ranking and is not a probability; 75/100 does not mean a 75% bloom chance. Bloom probability comes only from the separate logistic model and is shown in its own column. None of these are observations.
      </Note>

      <Card>
        <div className="grid gap-3 md:grid-cols-5">
          <Field label="Kriging model">
            <select className="select w-full" value={intCfg.model} onChange={(e) => set({ model: e.target.value })}>
              <option value="best">Best by cross-validation (per indicator)</option>
              {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="Monte Carlo draws">
            <select className="select w-full" value={intCfg.nSim} onChange={(e) => set({ nSim: +e.target.value })}>{[200, 500, 1000, 2000, 5000].map((n) => <option key={n}>{n}</option>)}</select>
          </Field>
          <Field label={`Error correlation between indicators: ${intCfg.rho.toFixed(2)}`} hint="0 = independent errors; higher values make TP, Chl-a etc. err together">
            <input type="range" className="w-full" min={0} max={0.9} step={0.05} value={intCfg.rho} onChange={(e) => set({ rho: +e.target.value })} />
          </Field>
          <Field label="Exceedance threshold (AHP score)" hint={`Default ${ahpCfg.bands[1]} = start of the High band`}>
            <input type="number" className="input w-full" min={1} max={100} value={intCfg.threshold} onChange={(e) => set({ threshold: Math.min(100, Math.max(1, +e.target.value || 50)) })} />
          </Field>
          <Field label="Random seed" hint="Same seed, same result">
            <input type="number" className="input w-full" value={intCfg.seed} onChange={(e) => set({ seed: Math.round(+e.target.value) || 1 })} />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-600">
          <label className="flex items-center gap-2"><input type="checkbox" checked={intCfg.allowPrev} onChange={(e) => set({ allowPrev: e.target.checked })} /> Use the previous 14-day sample for stations missing today</label>
          <button className="btn-ghost" onClick={() => setIntCfg(DEFAULT_INT_CFG)}>Reset</button>
          <button className="btn-ghost" onClick={() => goto("ahp")}>Edit AHP weights</button>
          {!ahp.consistent && <span className="font-semibold text-red-700">AHP weights are inconsistent (CR {ahp.cr.toFixed(2)}): results are provisional.</span>}
        </div>
      </Card>
      {integration.problems.length > 0 && <Note tone="danger" title="Some lakes cannot be kriged for this date:">{integration.problems.slice(0, 3).join(" · ")}</Note>}

      {rows.length === 0 ? <Note tone="danger">No unmonitored location could be assessed for this date.</Note> : (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            <Kpi label="Unmonitored locations" value={rows.length} sub="assessed from same-lake stations" accent="#5aa9e6" />
            <Kpi label="Priority sampling" value={kpiPriority} sub={`P(score ≥ ${intCfg.threshold}) at least 50%`} accent="#ff5c6c" />
            <Kpi label="Mean AHP score" value={f(kpiMean, 0)} sub="interpolated, not observed" accent="#a98bff" />
            <Kpi label="Mean 90% interval width" value={`${f(rows.reduce((a, x) => a + (x.mc.p95 - x.mc.p05), 0) / rows.length, 0)} pts`} sub="Kriging uncertainty only" accent="#35d0c4" />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2" title="Sampling priorities" subtitle="Ranked by action level, then by the probability of reaching the threshold, then by interval width. Click a row.">
              <div className="overflow-x-auto"><table className="w-full">
                <thead><tr>{["#", "Location", "AHP score", "90% interval", `P(≥ ${intCfg.threshold})`, "Main drivers", "Nearest stn", "Bloom prob.*", "Action"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
                <tbody>{[...rows].sort((a, b) => a.priority - b.priority).map((x) => {
                  const top = [...x.parts].sort((a, b) => b.share - a.share).slice(0, 2).map((p) => INDICATORS[p.key].short).join(", ");
                  return (
                    <tr key={x.id} onClick={() => setSel(x.id)} className={`cursor-pointer hover:bg-white/[0.04] ${x.id === r.id ? "bg-white/[0.06]" : ""}`}>
                      <td className="td">{x.priority}</td>
                      <td className="td font-semibold">{x.id}<div className="text-[11px] font-normal text-slate-500">{x.name} · {x.lake}</div></td>
                      <td className="td estimated"><span className="mono">{f(x.score, 0)}</span> <RiskBadge level={x.category} /></td>
                      <td className="td"><IntervalBar mc={x.mc} score={x.score} /></td>
                      <td className="td mono">{(x.mc.pExceed * 100).toFixed(0)}%</td>
                      <td className="td text-xs">{top}</td>
                      <td className="td text-xs">{x.nearestKm.toFixed(0)} km</td>
                      <td className="td mono text-xs">{run.byId[x.id]?.p != null ? `${(run.byId[x.id].p * 100).toFixed(0)}%` : "n/a"}</td>
                      <td className="td"><span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: LEVEL_COLOR[x.action.level] + "26", color: LEVEL_COLOR[x.action.level] }}>{x.action.level}</span></td>
                    </tr>
                  );
                })}</tbody>
              </table></div>
              <p className="mt-2 text-[11px] text-slate-500">*Bloom probability is the separate logistic/early-warning estimate for the next sample, using the estimator set on the Bloom Prediction page. It is a different quantity from the AHP score.</p>
            </Card>
            <Card title="Map" subtitle="Diamonds: interpolated AHP band. Grey circles: monitored stations.">
              <RiskMap locations={mapLocs} selectedId={r.id} onSelect={(id) => integration.byId[id] && setSel(id)} height={400} showTiles={false} colorFn={colorFn} tooltipFn={tooltipFn} ringFn={(x) => x.kind !== "station" && x.action?.level === "Priority"} />
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-600">{["Low", "Moderate", "High", "Critical"].map((c) => <span key={c} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: RISK_COLORS[c] }} />{c} (AHP band)</span>)}</div>
            </Card>
          </div>

          <Detail r={r} ahpCfg={ahpCfg} ahp={ahp} />
        </>
      )}

      <Card title="How well does this work? Validation against hidden truth" subtitle={`${VALID.meta.cases} location-dates in 2024-2025 (${VALID.meta.locations} unmonitored sites). The true values at those sites are simulated and were never used for Kriging.`}>
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <table className="w-full text-sm"><thead><tr><th className="th">Estimator of the AHP score</th><th className="th">MAE (points)</th><th className="th">RMSE (points)</th></tr></thead>
              <tbody>{[["Kriging", VALID.score_error.kriging], ["Inverse-distance weighting", VALID.score_error.idw], ["Lake mean", VALID.score_error.lake_mean]].map(([n, v]) => <tr key={n}><td className="td">{n}</td><td className="td mono">{f(v.mae, 2)}</td><td className="td mono">{f(v.rmse, 2)}</td></tr>)}</tbody></table>
            <p className="mt-2 text-xs text-slate-600">90% Monte Carlo interval contained the true score {(VALID.interval90_coverage * 100).toFixed(0)}% of the time (mean width {f(VALID.mean_interval_width, 0)} points). It is a little narrow: errors of the six indicators are not independent, and variogram and temporal error are not propagated. Mean bias {f(VALID.score_error.bias_kriging, 1)} points (Kriging smooths extremes).</p>
          </div>
          <div>
            <div className="label mb-1">Reliability of P(score ≥ {VALID.meta.threshold}); Brier {f(VALID.exceedance.brier, 3)} vs {f(VALID.exceedance.brier_climatology, 3)} for always forecasting the base rate</div>
            <table className="w-full text-sm"><thead><tr><th className="th">Forecast probability</th><th className="th">Cases</th><th className="th">Mean forecast</th><th className="th">Observed frequency</th></tr></thead>
              <tbody>{VALID.exceedance.reliability.map((b) => <tr key={b.range}><td className="td">{b.range}</td><td className="td">{b.n}</td><td className="td mono">{b.predicted == null ? "-" : `${(b.predicted * 100).toFixed(0)}%`}</td><td className="td mono">{b.observed == null ? "-" : `${(b.observed * 100).toFixed(0)}%`}</td></tr>)}</tbody></table>
            <p className="mt-2 text-xs text-slate-500">Bins with few cases (20-80%) are noisy. Validation uses the default AHP weights and the 50-point threshold.</p>
          </div>
        </div>
      </Card>
    </div>
  );
}

function IntervalBar({ mc, score }) {
  return (
    <div className="w-32">
      <div className="relative h-2 rounded bg-white/10">
        <div className="absolute h-2 rounded bg-[#a98bff]/60" style={{ left: `${mc.p05}%`, width: `${Math.max(mc.p95 - mc.p05, 1)}%` }} />
        <div className="absolute -top-0.5 h-3 w-0.5 bg-ink" style={{ left: `${score}%` }} />
        <div className="absolute -top-1 h-4 w-px bg-[#f2c14e]" style={{ left: `${mc.threshold}%` }} />
      </div>
      <div className="mono mt-0.5 text-[10px] text-slate-500">{mc.p05.toFixed(0)}–{mc.p95.toFixed(0)}</div>
    </div>
  );
}

function Detail({ r, ahpCfg, ahp }) {
  const colour = RISK_COLORS[r.category];
  const rowsI = AHP_KEYS.map((k, i) => {
    const p = r.points[k];
    const m = INDICATORS[k];
    return { k, m, p, w: ahp.weights[i], rr: normalise(p.value, ahpCfg.norm.ranges[k], ahpCfg.norm.method), part: r.parts[i], drv: r.drivers.find((d) => d.key === k).pointsPerSE };
  });
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card className="xl:col-span-2" title={`${r.id} · ${r.name}`} subtitle={`Lake ${r.lake} · ${r.lat.toFixed(3)}, ${r.lon.toFixed(3)} · ${r.stationsUsed} stations used (at least) · nearest ${r.nearestKm.toFixed(0)} km`} right={<EstimatedTag />}>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr>{["Indicator", "Kriged estimate", "95% interval", "r (0–1)", "AHP weight", "Score points", "± points per 1 SE"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody>{rowsI.map((x) => (
            <tr key={x.k}>
              <td className="td">{x.m.label}</td>
              <td className="td estimated mono">{f(x.p.value, x.m.digits + 1)} {x.m.unit}</td>
              <td className="td mono text-xs">{f(x.p.lower, x.m.digits + 1)}–{f(x.p.upper, x.m.digits + 1)}</td>
              <td className="td mono">{f(x.rr, 2)}</td>
              <td className="td mono">{(x.w * 100).toFixed(1)}%</td>
              <td className="td mono">{f(x.part.share, 1)}</td>
              <td className="td mono">{f(x.drv, 1)}</td>
            </tr>))}</tbody>
        </table></div>
        {r.flags.length > 0 && <div className="mt-3 space-y-1">{r.flags.map((x) => <Note key={x} tone="warn">{x}</Note>)}</div>}
        <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm">
          <div className="label mb-0.5">Recommended monitoring action · {r.action.level}</div>{r.action.text}
          <div className="mt-1 text-xs text-slate-500">Largest source of uncertainty: {INDICATORS[r.drivers[0].key].label} (±{r.drivers[0].pointsPerSE.toFixed(1)} score points per standard error), so a sample of that indicator would narrow the interval most.</div>
        </div>
      </Card>
      <Card title="Risk interval" subtitle={`${r.mc.n} Monte Carlo draws of the Kriging error${r.mc.rho ? `, error correlation ${r.mc.rho}` : ""}`}>
        <div className="rounded-xl border px-4 py-3 text-center" style={{ borderColor: colour + "88", background: colour + "14" }}>
          <div className="label">Interpolated AHP score (point estimate)</div>
          <div className="mono text-3xl font-semibold text-ink">{f(r.score, 0)}<span className="text-base text-slate-500"> / 100</span></div>
          <div className="text-sm font-semibold" style={{ color: colour }}>{r.category} AHP band</div>
          <div className="mt-1 text-xs text-slate-600">90% interval {f(r.mc.p05, 0)}–{f(r.mc.p95, 0)} · median {f(r.mc.p50, 0)} · P(≥ {r.mc.threshold}) = {(r.mc.pExceed * 100).toFixed(0)}%</div>
        </div>
        <div className="mt-2 h-44">
          <ResponsiveContainer>
            <BarChart data={r.mc.hist} margin={{ top: 8, right: 8, bottom: 16, left: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
              <XAxis dataKey="from" tick={AXIS} type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} label={{ value: "AHP score", position: "insideBottom", offset: -8, fill: "#9aa4c4", fontSize: 11 }} />
              <YAxis tick={AXIS} width={30} />
              <Tooltip formatter={(v) => [`${v} draws`, ""]} labelFormatter={(v) => `${v}–${v + 5}`} />
              <Bar dataKey="count" isAnimationActive={false}>{r.mc.hist.map((b) => <Cell key={b.from} fill={categoryOf(b.from + 2.5, ahpCfg.bands) === r.category ? colour : RISK_COLORS[categoryOf(b.from + 2.5, ahpCfg.bands)]} fillOpacity={0.8} />)}</Bar>
              <ReferenceLine x={r.mc.threshold} stroke="#f2c14e" strokeDasharray="4 3" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[11px] text-slate-500">Yellow line: exceedance threshold. Bars are coloured by AHP band.</p>
      </Card>
    </div>
  );
}
