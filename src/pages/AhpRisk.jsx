import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApp } from "../state.jsx";
import { Card, Field, Kpi, Note, PageHeader, SimBadge, AXIS } from "../components/ui.jsx";
import { RISK_COLORS } from "../lib/risk.js";
import { monitoredStations } from "../lib/data.js";
import { INDICATORS, snapshotRaw } from "../lib/spatialData.js";
import { AHP_KEYS, SAATY, DEFAULT_AHP, DEFAULT_JUDGMENTS, BAND_NAMES, RANDOM_INDEX, composite, normalise } from "../lib/ahp.js";

const frac = (v) => (v >= 1 ? String(Math.round(v)) : `1/${Math.round(1 / v)}`);
const f2 = (v, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : "n/a");
const SAATY_HELP = "1 equal · 3 moderate · 5 strong · 7 very strong · 9 extreme (2, 4, 6, 8 in between). A value below 1 means the column indicator matters more.";

export default function AhpRisk() {
  const { ahpCfg, setAhpCfg, ahp, dateStr } = useApp();
  const [source, setSource] = useState("manual");
  const START = { tp: 0.8, chl: 0.7, nitrate: 0.3, temp: 0.55, doxy: 0.4, turb: 0.2 }; // starting slider positions as a fraction of each reference range
  const [manual, setManual] = useState(() => Object.fromEntries(AHP_KEYS.map((k) => { const r = DEFAULT_AHP.norm.ranges[k]; return [k, r.low + START[k] * (r.high - r.low)]; })));
  const { judgments, norm, bands } = ahpCfg;

  const setJudgment = (k, v) => setAhpCfg({ ...ahpCfg, judgments: { ...judgments, [k]: v } });
  const setRange = (k, field, v) => setAhpCfg({ ...ahpCfg, norm: { ...norm, ranges: { ...norm.ranges, [k]: { ...norm.ranges[k], [field]: v } } } });

  // values for the simulator: manual sliders or the latest observed values at a monitored station
  const station = monitoredStations.find((s) => s.id === source);
  const values = useMemo(() => {
    if (!station) return manual;
    const i = monitoredStations.indexOf(station);
    return Object.fromEntries(AHP_KEYS.map((k) => [k, snapshotRaw(k, dateStr)[i]]));
  }, [source, manual, dateStr]);
  const result = useMemo(() => composite(values, ahp.weights, ahpCfg), [values, ahp.weights, ahpCfg]);
  const equal = useMemo(() => composite(values, AHP_KEYS.map(() => 1 / AHP_KEYS.length), ahpCfg), [values, ahpCfg]);

  const weightData = AHP_KEYS.map((k, i) => ({ key: k, name: INDICATORS[k].short, weight: ahp.weights[i] * 100 }));
  const color = result.category ? RISK_COLORS[result.category] : "#8c95b3";
  const rangeOf = (k) => {
    const r = norm.ranges[k];
    const span = Math.abs(r.high - r.low);
    return [Math.min(r.low, r.high) - 0.25 * span, Math.max(r.low, r.high) + 0.25 * span];
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="AHP Risk Assessment"
        subtitle="Analytic Hierarchy Process: judge how much more important each indicator is than another, derive weights from the principal eigenvector, check the judgments for consistency, then combine normalised indicators into a 0–100 risk score."
        right={<SimBadge>ILLUSTRATIVE WEIGHTS · SIMULATED DATA</SimBadge>}
      />
      <Note tone="warn" title="An AHP score is not a bloom probability.">
        The score ranks relative multi-criteria risk from expert-style judgments. A score of 75/100 does not mean a 75% chance of a bloom; bloom probability comes only from the separate, validated logistic model. The judgments and reference ranges below are illustrative defaults, not regulatory criteria, and are meant to be edited.
      </Note>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Pairwise comparison matrix (Saaty 1–9)" subtitle={`Read across: how much more important is the ROW indicator than the COLUMN indicator? ${SAATY_HELP}`}
          right={<div className="flex gap-2"><button className="btn-ghost" onClick={() => setAhpCfg({ ...ahpCfg, judgments: DEFAULT_JUDGMENTS })}>Reset</button><button className="btn-ghost" onClick={() => setAhpCfg({ ...ahpCfg, judgments: {} })}>All equal</button></div>}>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr><th className="th" />{AHP_KEYS.map((k) => <th key={k} className="th">{INDICATORS[k].short}</th>)}<th className="th">Weight</th></tr></thead>
            <tbody>{AHP_KEYS.map((ki, i) => (
              <tr key={ki}>
                <td className="td font-medium">{INDICATORS[ki].label}</td>
                {AHP_KEYS.map((kj, j) => {
                  if (i === j) return <td key={kj} className="td mono text-slate-400">1</td>;
                  if (j < i) return <td key={kj} className="td mono text-slate-400">{frac(ahp.matrix[i][j])}</td>;
                  const key = `${ki}|${kj}`;
                  const isWorst = !ahp.consistent && ahp.worst?.key === key;
                  return (
                    <td key={kj} className="td">
                      <select className="select !px-1.5 !py-0.5 mono" style={isWorst ? { borderColor: "#ff9f4a" } : {}} value={judgments[key] ?? 1} onChange={(e) => setJudgment(key, parseFloat(e.target.value))} aria-label={`${INDICATORS[ki].short} versus ${INDICATORS[kj].short}`}>
                        {SAATY.map((v) => <option key={v} value={v}>{frac(v)}</option>)}
                      </select>
                    </td>
                  );
                })}
                <td className="td mono font-semibold text-ink">{(ahp.weights[i] * 100).toFixed(1)}%</td>
              </tr>
            ))}</tbody>
          </table></div>
          <p className="mt-2 text-xs text-slate-500">Cells below the diagonal are reciprocals and update automatically. {!ahp.consistent && `The orange cell is the judgment that disagrees most with the derived weights (you gave ${frac(ahp.worst.given)}, the weights imply about ${ahp.worst.implied.toFixed(2)}); revising it is the quickest way to lower CR.`}</p>
        </Card>

        <div className="space-y-4">
          <Card title="Consistency" right={<span className="rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ background: (ahp.consistent ? "#3ecf8e" : "#ff5c6c") + "26", color: ahp.consistent ? "#3ecf8e" : "#ff5c6c" }}>{ahp.consistent ? "CONSISTENT" : "INCONSISTENT"}</span>}>
            <div className="grid grid-cols-2 gap-2">
              <Kpi label="λmax" value={f2(ahp.lambdaMax, 3)} sub={`ideal ${AHP_KEYS.length}`} />
              <Kpi label="CI" value={f2(ahp.ci, 4)} sub="(λmax − n)/(n − 1)" />
              <Kpi label="RI (n = 6)" value={RANDOM_INDEX[5].toFixed(2)} sub="Saaty random index" />
              <Kpi label="CR" value={f2(ahp.cr, 4)} sub={`threshold ${ahpCfg.crThreshold}`} accent={ahp.consistent ? "#3ecf8e" : "#ff5c6c"} />
            </div>
            <div className="mt-3 flex items-center gap-2 text-xs text-slate-600">
              <label htmlFor="crt">CR threshold</label>
              <input id="crt" type="number" step="0.01" min="0.01" max="0.5" className="input w-20" value={ahpCfg.crThreshold} onChange={(e) => setAhpCfg({ ...ahpCfg, crThreshold: Math.max(0.01, +e.target.value || 0.1) })} />
              <span>0.10 is Saaty's usual limit</span>
            </div>
            {!ahp.consistent && <div className="mt-3"><Note tone="danger" title="CR is above the threshold.">The judgments contradict each other, so these weights should not be used for decisions until they are revised. Scores are still calculated and carry this warning.</Note></div>}
          </Card>
          <Card title="Derived priority weights" subtitle="Principal eigenvector, sums to 100%">
            <div className="h-56">
              <ResponsiveContainer>
                <BarChart data={weightData} layout="vertical" margin={{ left: 10, right: 24 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.08)" horizontal={false} />
                  <XAxis type="number" tick={AXIS} tickFormatter={(v) => `${Math.round(v)}%`} domain={[0, "dataMax"]} />
                  <YAxis type="category" dataKey="name" tick={AXIS} width={48} />
                  <Tooltip formatter={(v) => `${v.toFixed(1)}%`} />
                  <ReferenceLine x={100 / 6} stroke="#8c95b3" strokeDasharray="4 3" />
                  <Bar dataKey="weight" fill="#a98bff" radius={[0, 4, 4, 0]}>{weightData.map((d) => <Cell key={d.key} fill="#a98bff" />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[11px] text-slate-500">Dashed line = equal weight (16.7%).</p>
          </Card>
        </div>
      </div>

      <Card title="Risk-oriented normalisation" subtitle="Each indicator becomes a risk contribution r from 0 (no concern) to 1 (maximum concern). The ranges are illustrative planning values, not standards."
        right={<div className="flex gap-1">{[["linear", "Piecewise linear"], ["logistic", "Logistic"]].map(([m, t]) => <button key={m} className={`btn-ghost ${norm.method === m ? "btn-active" : ""}`} onClick={() => setAhpCfg({ ...ahpCfg, norm: { ...norm, method: m } })}>{t}</button>)}</div>}>
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {AHP_KEYS.map((k) => {
            const r = norm.ranges[k];
            const [a, b] = rangeOf(k);
            const pts = Array.from({ length: 41 }, (_, i) => { const x = a + ((b - a) * i) / 40; return `${(i / 40) * 100},${40 - 36 * normalise(x, r, norm.method) - 2}`; }).join(" ");
            const v = values[k];
            return (
              <div key={k} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="text-xs font-semibold text-ink">{INDICATORS[k].short} <span className="font-normal text-slate-500">({INDICATORS[k].unit})</span></div>
                <svg viewBox="0 0 100 40" className="mt-1 h-14 w-full" preserveAspectRatio="none"><polyline points={pts} fill="none" stroke="#35d0c4" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                  {Number.isFinite(v) && v >= a && v <= b && <circle cx={((v - a) / (b - a)) * 100} cy={40 - 36 * normalise(v, r, norm.method) - 2} r="2.2" fill="#f2c14e" />}</svg>
                <div className="mt-1 grid grid-cols-2 gap-2 text-[11px] text-slate-500">
                  <label>r = 0 at<input type="number" className="input mt-0.5 w-full" value={r.low} step="any" onChange={(e) => setRange(k, "low", +e.target.value)} /></label>
                  <label>r = 1 at<input type="number" className="input mt-0.5 w-full" value={r.high} step="any" onChange={(e) => setRange(k, "high", +e.target.value)} /></label>
                </div>
                {k === "doxy" && <div className="mt-1 text-[10px] text-slate-500">Reversed: low oxygen is the risky direction.</div>}
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-600">
          <span>AHP score bands (lower edges):</span>
          {bands.map((b, i) => (
            <label key={i} className="flex items-center gap-1">{BAND_NAMES[i]} → {BAND_NAMES[i + 1]}
              <input type="number" className="input w-16" value={b} min={1} max={99} onChange={(e) => { const nb = [...bands]; nb[i] = +e.target.value; setAhpCfg({ ...ahpCfg, bands: nb.every((x, j) => j === 0 || x > nb[j - 1]) ? nb : bands }); }} />
            </label>
          ))}
          <button className="btn-ghost" onClick={() => setAhpCfg({ ...ahpCfg, norm: DEFAULT_AHP.norm, bands: DEFAULT_AHP.bands })}>Reset ranges and bands</button>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Composite score simulator" subtitle="R = Σ wᵢ · rᵢ, scaled to 0–100. Try your own values or load the latest observed values at a station."
          right={<select className="select" value={source} onChange={(e) => setSource(e.target.value)}><option value="manual">Manual values</option>{monitoredStations.map((s) => <option key={s.id} value={s.id}>{s.id} · observed {dateStr}</option>)}</select>}>
          <div className="grid gap-3 md:grid-cols-2">
            {AHP_KEYS.map((k) => {
              const [a, b] = rangeOf(k);
              const v = values[k];
              return (
                <div key={k} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                  <div className="flex items-baseline justify-between text-xs"><span className="font-semibold text-ink">{INDICATORS[k].label}</span><span className="mono text-slate-700">{Number.isFinite(v) ? v.toFixed(INDICATORS[k].digits + 1) : "no sample"} {INDICATORS[k].unit}</span></div>
                  <input type="range" className="mt-1 w-full" min={a} max={b} step={(b - a) / 200} value={Number.isFinite(v) ? Math.min(Math.max(v, a), b) : a} disabled={!!station} onChange={(e) => setManual({ ...manual, [k]: +e.target.value })} aria-label={INDICATORS[k].label} />
                  <div className="text-[11px] text-slate-500">r = {f2(normalise(v, norm.ranges[k], norm.method), 2)} · weight {(ahp.weights[AHP_KEYS.indexOf(k)] * 100).toFixed(1)}%</div>
                </div>
              );
            })}
          </div>
          {station && <p className="mt-2 text-xs text-slate-500">Values are the most recent sample within 45 days of {dateStr}. An indicator with no sample is dropped and the remaining weights are rescaled, so a gap is never counted as zero risk.</p>}
        </Card>

        <Card title="AHP composite result">
          {!Number.isFinite(result.score) ? <p className="text-sm text-slate-500">No indicators available.</p> : (
            <div className="space-y-3">
              <div className="rounded-xl border px-4 py-3 text-center" style={{ borderColor: color + "88", background: color + "14" }}>
                <div className="label">AHP risk score (not a probability)</div>
                <div className="mono text-4xl font-semibold text-ink">{result.score.toFixed(1)}<span className="text-lg text-slate-500"> / 100</span></div>
                <div className="mt-1 text-sm font-semibold" style={{ color }}>{result.category} AHP band</div>
              </div>
              {!ahp.consistent && <Note tone="danger">Weights are inconsistent (CR {f2(ahp.cr, 3)}); treat this score as provisional.</Note>}
              <div>
                <div className="label mb-1">Contribution to the score (points of 100)</div>
                {[...result.parts].sort((x, y) => (y.share || 0) - (x.share || 0)).map((p) => (
                  <div key={p.key} className="mb-1.5 text-xs">
                    <div className="flex justify-between"><span>{INDICATORS[p.key].short}</span><span className="mono">{Number.isFinite(p.share) ? `+${p.share.toFixed(1)}` : "n/a"}</span></div>
                    <div className="h-1.5 rounded bg-white/10"><div className="h-full rounded" style={{ width: `${Number.isFinite(p.share) ? p.share : 0}%`, background: "#a98bff" }} /></div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-600">With equal weights the same inputs score {equal.score.toFixed(1)}, so the judgments {Math.abs(equal.score - result.score) > 5 ? "matter here" : "change little here"}.</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
