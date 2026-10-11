import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend as RLegend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApp } from "../state.jsx";
import { Card, Field, Note, PageHeader, RiskBadge, AXIS } from "../components/ui.jsx";
import Gauge from "../components/Gauge.jsx";
import { RESULTS, SEASONS } from "../lib/data.js";
import { contributions, predict, VARIABLE_LABELS } from "../lib/model.js";
import { ACTIONS, RISK_COLORS, classify } from "../lib/risk.js";
import { pct } from "../lib/stats.js";

const MANUAL_DEFAULT = { tp: 15, chl: 6, temp: 22, rain: 20, doxy: 9, season: "Summer" };
const SLIDERS = [
  { key: "tp", label: "Total phosphorus", unit: "µg/L", min: 1, max: 80, step: 0.5 },
  { key: "chl", label: "Chlorophyll-a", unit: "µg/L", min: 0.2, max: 60, step: 0.2 },
  { key: "temp", label: "Water temperature", unit: "°C", min: 0, max: 28, step: 0.5 },
  { key: "rain", label: "Rainfall (7-day)", unit: "mm", min: 0, max: 150, step: 1 },
  { key: "doxy", label: "Dissolved oxygen", unit: "mg/L", min: 5, max: 16, step: 0.1 },
];

function round(v) {
  return Math.round(v * 10) / 10;
}

export default function PredictionLab() {
  const { run, settings, selectedId } = useApp();
  const th = settings.thresholds;
  const start = selectedId && run.byId[selectedId]?.inputs ? selectedId : "ERI-04";
  const [locId, setLocId] = useState(start);
  const startInputs = run.byId[start].inputs;
  const [inputs, setInputs] = useState({ ...startInputs, tp: round(startInputs.tp), chl: round(startInputs.chl), temp: round(startInputs.temp), rain: round(startInputs.rain), doxy: round(startInputs.doxy) });
  const [baseline, setBaseline] = useState(inputs);
  const [cfg, setCfg] = useState("early");
  const [dTp, setDTp] = useState(50);
  const [dTemp, setDTemp] = useState(2);
  const [dRain, setDRain] = useState(25);
  const [result, setResult] = useState(() => ({ inputs, baseline: inputs, cfg: "early", dTp: 50, dTemp: 2, dRain: 25 }));

  function loadLocation(id) {
    setLocId(id);
    if (id === "manual") {
      setInputs(MANUAL_DEFAULT);
      setBaseline(MANUAL_DEFAULT);
      return;
    }
    const r = run.byId[id];
    if (!r.inputs) return;
    const v = { ...r.inputs, tp: round(r.inputs.tp), chl: round(r.inputs.chl), temp: round(r.inputs.temp), rain: round(r.inputs.rain), doxy: round(r.inputs.doxy) };
    setInputs(v);
    setBaseline(v);
  }
  const set = (k, v) => setInputs({ ...inputs, [k]: v });
  const dirty = JSON.stringify(inputs) !== JSON.stringify(result.inputs) || cfg !== result.cfg || dTp !== result.dTp || dTemp !== result.dTemp || dRain !== result.dRain;

  // computed from the committed snapshot (set when the button is pressed)
  const r = result;
  const main = predict(settings.model, r.cfg, r.inputs);
  const base = predict(settings.model, r.cfg, r.baseline);
  const level = classify(main.p, th);
  const factors = contributions(settings.model, r.cfg, r.inputs);
  const scenarios = [
    { name: "Current inputs", short: "Current", x: r.inputs },
    { name: `Phosphorus +${r.dTp}%`, short: "TP up", x: { ...r.inputs, tp: r.inputs.tp * (1 + r.dTp / 100) } },
    { name: `Warmer water +${r.dTemp} °C`, short: "Warmer", x: { ...r.inputs, temp: r.inputs.temp + r.dTemp } },
    { name: `Rainfall +${r.dRain} mm`, short: "Rain up", x: { ...r.inputs, rain: r.inputs.rain + r.dRain } },
    { name: "Phosphorus + warmer", short: "TP + warm", x: { ...r.inputs, tp: r.inputs.tp * (1 + r.dTp / 100), temp: r.inputs.temp + r.dTemp } },
  ].map((s) => {
    const p = predict(settings.model, r.cfg, s.x);
    return { name: s.name, short: s.short, Logistic: p.pLR * 100, "Random forest": p.pRF * 100, primary: p.p, level: classify(p.p, th) };
  });
  const rg = RESULTS.ranges;
  const outside = [
    ["total phosphorus", r.inputs.tp, rg.TP], ["chlorophyll-a", r.inputs.chl, rg.Chl], ["water temperature", r.inputs.temp, rg.Temp],
    ["rainfall", r.inputs.rain, rg.Rain], ["dissolved oxygen", r.inputs.doxy, rg.DO],
  ].filter(([, v, rr]) => v < rr.p01 || v > rr.p99).map(([n, v, rr]) => `${n} ${v} is outside the central range of the training data (${rr.p01.toFixed(1)} to ${rr.p99.toFixed(1)})`);
  const modelNames = { lr: "logistic regression", rf: "random forest", avg: "the average of both models" };

  return (
    <div>
      <PageHeader title="Bloom Prediction Lab" subtitle="Load a location or set conditions by hand, then press Calculate Bloom Risk. Results come from the fitted models running in your browser; nothing is hard-coded or randomised." />
      <div className="my-3"><Note title="Bloom probability is its own quantity.">This page is the validated logistic/random-forest model: the chance of a bloom at the next sample (about 14 days ahead), from the previous sample only. It does not use the AHP score or Kriging variance, and an AHP score of 75/100 is not a 75% bloom probability. Inputs for unmonitored locations come from the estimator chosen on the Unmonitored Area page.</Note></div>
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2" title="Inputs">
          <div className="space-y-3">
            <Field label="Starting point">
              <select className="select w-full" value={locId} onChange={(e) => loadLocation(e.target.value)}>
                <option value="manual">Manual scenario</option>
                {run.results.filter((x) => x.inputs).map((x) => <option key={x.id} value={x.id}>{x.id} · {x.name} ({x.monitored ? "monitored" : "unmonitored, estimated"})</option>)}
              </select>
            </Field>
            <Field label="Model configuration">
              <select className="select w-full" value={cfg} onChange={(e) => setCfg(e.target.value)}>
                <option value="early">Early warning: inputs from the last sample (recommended)</option>
                <option value="nowcast">Nowcast: same-time inputs incl. chlorophyll-a (leakage-prone)</option>
              </select>
            </Field>
            {cfg === "nowcast" && <Note tone="warn" title="Leakage:">Chlorophyll-a measured during a bloom is partly a consequence of the bloom, so this configuration looks far more accurate than it can be as a forecast. Use it to explore the data, not to warn in advance.</Note>}
            {SLIDERS.map((s) => (
              <div key={s.key}>
                <div className="flex items-center justify-between">
                  <span className="label">{s.label} <span style={{ textTransform: "none" }}>({s.unit})</span>{s.key === "chl" && cfg === "early" ? " · last sample" : ""}</span>
                  <input type="number" className="input w-20 text-right" value={inputs[s.key]} step={s.step} min={s.min} max={s.max} onChange={(e) => set(s.key, +e.target.value)} />
                </div>
                <input type="range" min={s.min} max={s.max} step={s.step} value={Math.min(Math.max(inputs[s.key], s.min), s.max)} onChange={(e) => set(s.key, +e.target.value)} className="w-full" />
              </div>
            ))}
            <Field label={cfg === "early" ? "Season of the predicted sample" : "Season"}>
              <select className="select w-full" value={inputs.season} onChange={(e) => set("season", e.target.value)}>{SEASONS.map((s) => <option key={s}>{s}</option>)}</select>
            </Field>
            <div className="grid grid-cols-3 gap-2 border-t border-slate-100 pt-3">
              <Field label="Scenario: TP +%"><input type="number" className="input w-full" value={dTp} onChange={(e) => setDTp(+e.target.value)} /></Field>
              <Field label="Warmer +°C"><input type="number" className="input w-full" value={dTemp} onChange={(e) => setDTemp(+e.target.value)} /></Field>
              <Field label="Rain +mm"><input type="number" className="input w-full" value={dRain} onChange={(e) => setDRain(+e.target.value)} /></Field>
            </div>
            <button className="btn btn-teal w-full py-3 text-base" onClick={() => setResult({ inputs: { ...inputs }, baseline: { ...baseline }, cfg, dTp, dTemp, dRain })}>Calculate Bloom Risk</button>
            {dirty && <p className="text-center text-xs font-medium text-amber-700">Inputs changed. Press Calculate Bloom Risk to update the results.</p>}
          </div>
        </Card>

        <div className="space-y-4 lg:col-span-3">
          <Card title="Predicted bloom probability" subtitle={`Using ${modelNames[settings.model]} (${r.cfg === "early" ? "early-warning" : "nowcast"} configuration). Change the primary model in the header.`} className={dirty ? "opacity-60" : ""}>
            <div className="grid items-center gap-4 md:grid-cols-2">
              <div className="flex flex-col items-center">
                <Gauge p={main.p} thresholds={th} />
                <RiskBadge level={level} />
              </div>
              <div className="space-y-2 text-sm">
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="label">Recommended next action</div>
                  <div className="mt-0.5 font-medium">{ACTIONS[level]}</div>
                  <div className="mt-1 text-[11px] text-slate-500">Model-generated candidate, not an official warning. Thresholds are editable demonstration settings.</div>
                </div>
                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="label">Versus baseline ({locId === "manual" ? "manual defaults" : locId})</div>
                  <div className="mt-0.5 text-lg font-semibold">{pct(base.p)} → {pct(main.p)} <span className={main.p - base.p >= 0 ? "text-red-700" : "text-emerald-700"}>({main.p - base.p >= 0 ? "+" : ""}{((main.p - base.p) * 100).toFixed(0)} pts)</span></div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-lg border border-slate-200 p-2"><div className="label">Logistic</div><div className="text-lg font-semibold">{pct(main.pLR)}</div></div>
                  <div className="rounded-lg border border-slate-200 p-2"><div className="label">Random forest</div><div className="text-lg font-semibold">{pct(main.pRF)}</div></div>
                </div>
                {Math.abs(main.pLR - main.pRF) > 0.15 && <p className="text-xs text-amber-700">The two models differ by more than 15 points here, so treat this prediction as uncertain.</p>}
              </div>
            </div>
            {outside.length > 0 && <div className="mt-3"><Note tone="warn" title="Outside supported range:">{outside.join("; ")}. Predictions here are extrapolations.</Note></div>}
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card title="What is driving this prediction" subtitle="Change in probability if each variable were set to its typical value (points). Red raises risk.">
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={factors.map((f) => ({ name: f.label, v: f.delta * 100 }))} layout="vertical" margin={{ left: 30 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.08)" horizontal={false} />
                  <XAxis type="number" tick={AXIS} unit=" pts" />
                  <YAxis type="category" dataKey="name" tick={AXIS} width={110} />
                  <Tooltip formatter={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)} pts`} />
                  <ReferenceLine x={0} stroke="#9aa4c4" />
                  <Bar dataKey="v">{factors.map((f) => <Cell key={f.key} fill={f.delta >= 0 ? RISK_COLORS.High : "#35d0c4"} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
            <Card title="Scenario comparison (%)" subtitle="Both models, starting from the calculated inputs">
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={scenarios}>
                  <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                  <XAxis dataKey="short" tick={{ ...AXIS, fontSize: 10 }} interval={0} />
                  <YAxis tick={AXIS} domain={[0, 100]} unit="%" />
                  <Tooltip formatter={(v) => `${v.toFixed(1)}%`} />
                  <RLegend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Logistic" fill="#5aa9e6" />
                  <Bar dataKey="Random forest" fill="#35d0c4" />
                </BarChart>
              </ResponsiveContainer>
              <table className="mt-1 w-full"><tbody>{scenarios.map((s) => <tr key={s.name}><td className="td py-1 text-xs">{s.name}</td><td className="td py-1 text-right text-xs">{pct(s.primary)}</td><td className="td py-1 text-right"><RiskBadge level={s.level} /></td></tr>)}</tbody></table>
            </Card>
          </div>

          <Card title="Model limitations">
            <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-slate-600">
              <li>Both models were trained on simulated data. They describe the simulation, not the real lakes.</li>
              <li>Effects are conditional associations. Raising phosphorus in this tool does not prove that a real reduction would prevent blooms.</li>
              <li>Station-level differences the models cannot see (local geography, tributaries, wind) are not represented, so individual predictions can be wrong even when the overall AUC is good.</li>
              <li>Rainfall can raise or lower risk depending on amount; the logistic model captures this with a squared term, the random forest learns it from the data. Both are limited by what the simulation contained.</li>
              <li>Probabilities are for a bloom at the next sample (about 14 days ahead) in the early-warning configuration. They are not forecasts of bloom size or toxicity.</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
