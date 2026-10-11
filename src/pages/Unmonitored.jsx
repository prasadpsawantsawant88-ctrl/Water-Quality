import { useMemo, useState } from "react";
import UnmonitoredAhp from "./UnmonitoredAhp.jsx";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from "recharts";
import { useApp } from "../state.jsx";
import { Card, Tabs, EstimatedTag, Field, Note, PageHeader, ProbBar, RiskBadge, AXIS } from "../components/ui.jsx";
import RiskMap from "../components/RiskMap.jsx";
import { RESULTS, unmonitoredStations, monitoredStations } from "../lib/data.js";
import { RISK_COLORS } from "../lib/risk.js";
import { DEFAULT_SPATIAL, haversineKm } from "../lib/spatial.js";
import { fmt, pct } from "../lib/stats.js";

function BloomEstimates() {
  const { run, settings, setSettings, selectedId, setSelectedId, goto } = useApp();
  const sp = settings.spatial;
  const list = run.results.filter((r) => !r.monitored).sort((a, b) => (b.p ?? -1) - (a.p ?? -1));
  const [sel, setSel] = useState(selectedId && run.byId[selectedId] && !run.byId[selectedId].monitored ? selectedId : list[0].id);
  const r = run.byId[sel];
  const val = RESULTS.spatial_validation;
  const setSp = (patch) => setSettings({ ...settings, spatial: { ...sp, ...patch } });

  // map shows the unmonitored location, its contributing stations, and the other stations for context
  const mapLocs = useMemo(() => {
    const ids = new Set([sel, ...(r.spatial?.neighbors || []).map((n) => n.id)]);
    return run.results.filter((x) => ids.has(x.id));
  }, [run, sel, r]);

  return (
    <div>
      <PageHeader title="Unmonitored Area Intelligence" subtitle="Locations with no direct measurements. Inputs are interpolated from same-lake stations (Ordinary Kriging by default, inverse-distance weighting optional), then passed through the early-warning models. Every number here is an estimate." />
      <Note tone="warn" title="Estimates, not observations.">Values on this page are estimated from nearby stations. They are tagged ESTIMATED and shown with dashed backgrounds wherever they appear.</Note>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Ranked unmonitored locations" subtitle="Sorted by estimated bloom probability. Click a row for the full estimate.">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr><th className="th">#</th><th className="th">Location</th><th className="th">P(bloom)</th><th className="th">Risk</th><th className="th">Nearest station</th><th className="th">Est. TP</th><th className="th">Est. Chl-a</th><th className="th">Stations</th><th className="th">Support</th><th className="th">Confidence</th></tr></thead>
              <tbody>
                {list.map((x, i) => (
                  <tr key={x.id} onClick={() => setSel(x.id)} className={`cursor-pointer hover:bg-slate-50 ${x.id === sel ? "bg-teal-50" : ""}`}>
                    <td className="td">{i + 1}</td>
                    <td className="td font-semibold">{x.id}<div className="text-[11px] font-normal text-slate-500">{x.name} · {x.lake}</div></td>
                    <td className="td"><div className="w-24">{pct(x.p)}<ProbBar p={x.p} color={RISK_COLORS[x.level]} /></div></td>
                    <td className="td"><RiskBadge level={x.level} /></td>
                    <td className="td">{x.spatial?.nearest ? `${x.spatial.nearest.id} · ${x.spatial.nearest.distKm.toFixed(0)} km` : "n/a"}</td>
                    <td className="td estimated">{x.inputs ? fmt(x.inputs.tp) : "n/a"}</td>
                    <td className="td estimated">{x.inputs ? fmt(x.inputs.chl) : "n/a"}</td>
                    <td className="td">{x.spatial?.neighbors?.length ?? 0}</td>
                    <td className="td text-xs">{x.spatial?.ok ? (x.spatial.interpolation ? "Interpolation" : <span className="font-semibold text-amber-700">Extrapolation</span>) : "None"}</td>
                    <td className="td">{x.confidence.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title={`${r.id} · ${r.name}`} subtitle={`Lake ${r.lake} · ${r.lat.toFixed(3)}°, ${r.lon.toFixed(3)}°`} right={<RiskBadge level={r.level} />}>
          <div className="space-y-3 text-sm">
            <div className="flex items-end justify-between"><span className="label">Estimated bloom probability</span><span className="text-2xl font-semibold">{pct(r.p)}</span></div>
            <div className="rounded-lg bg-slate-50 p-2.5 text-sm"><div className="label mb-0.5">Recommended action</div>{r.action}{r.level !== "Low" && r.level !== "Moderate" && r.confidence.label !== "High" && <div className="mt-1 text-xs text-amber-800">Treat as unconfirmed: targeted field sampling is preferable to acting on this estimate alone.</div>}</div>
            {r.spatial?.ok ? (
              <>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-lg border border-slate-200 p-2"><div className="label">Nearest</div><div className="text-sm font-semibold">{r.spatial.nearest.distKm.toFixed(0)} km</div></div>
                  <div className="rounded-lg border border-slate-200 p-2"><div className="label">Stations used</div><div className="text-sm font-semibold">{r.spatial.neighbors.length}</div></div>
                  <div className="rounded-lg border border-slate-200 p-2"><div className="label">Method</div><div className={`text-sm font-semibold ${r.spatial.interpolation ? "" : "text-amber-700"}`}>{r.spatial.interpolation ? "Interpolation" : "Extrapolation"}</div></div>
                </div>
                <div>
                  <div className="label mb-1 flex items-center gap-2">Estimated inputs <EstimatedTag /></div>
                  <table className="w-full estimated"><tbody>
                    {[["tp", "Total phosphorus", "µg/L"], ["chl", "Chlorophyll-a", "µg/L"], ["temp", "Water temperature", "°C"], ["rain", "Rainfall", "mm"], ["doxy", "Dissolved oxygen", "mg/L"]].map(([k, l, u]) => (
                      <tr key={k}><td className="py-0.5 pl-2 text-xs text-slate-600">{l}</td><td className="py-0.5 pr-2 text-right text-xs font-semibold">{fmt(r.inputs[k])} {u}</td></tr>
                    ))}
                  </tbody></table>
                </div>
                <div>
                  <div className="label mb-1">Contributing stations (IDW weights)</div>
                  {r.spatial.neighbors.map((n) => (
                    <div key={n.id} className="flex items-center gap-2 py-0.5 text-xs">
                      <span className="w-14 font-semibold">{n.id}</span><span className="w-14 text-slate-500">{n.distKm.toFixed(0)} km</span>
                      <div className="flex-1"><ProbBar p={n.weight} color="#5aa9e6" /></div><span className="w-10 text-right">{(n.weight * 100).toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
                <div className="rounded-lg border border-slate-200 p-2 text-xs">
                  Confidence: <strong>{r.confidence.label}</strong> ({fmt(r.confidence.score, 2)}). Built from distance to the nearest station, number of stations, agreement among them on phosphorus (CV {fmt(r.spatial.tpCV, 2)}), whether the point lies inside the area they span, and model agreement. It is a heuristic index.
                </div>
              </>
            ) : null}
            {r.spatial?.warnings?.map((w, i) => <Note key={i} tone="warn">{w}</Note>)}
            <div className="flex gap-2"><button className="btn btn-ghost flex-1" onClick={() => goto("lab", r.id)}>Open in Prediction Lab</button><button className="btn btn-ghost flex-1" onClick={() => goto("geo", r.id)}>Show on explorer</button></div>
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Selected location and contributing stations" subtitle="Diamond = estimated location, circles = stations used">
          <RiskMap locations={mapLocs} selectedId={sel} onSelect={(id) => { if (!run.byId[id].monitored) setSel(id); setSelectedId(id); }} height={340} showTiles={false} />
        </Card>
        <Card title="Spatial method settings" subtitle="Changes apply to every page (this is the same model the alerts use)">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Input estimator" hint="Kriging: variogram-based; IDW: the original method. The IDW settings below apply to neighbour selection and to IDW."><select className="select w-full" value={sp.estimator} onChange={(e) => setSp({ estimator: e.target.value })}><option value="kriging">Ordinary Kriging</option><option value="idw">Inverse-distance weighting</option></select></Field>
            <Field label={`Distance-decay power p = ${sp.power}`} hint="Higher p gives nearer stations more weight"><input type="range" min="0.5" max="4" step="0.5" value={sp.power} onChange={(e) => setSp({ power: +e.target.value })} className="w-full" /></Field>
            <Field label={`Search radius = ${sp.radiusKm} km`}><input type="range" min="40" max="300" step="10" value={sp.radiusKm} onChange={(e) => setSp({ radiusKm: +e.target.value })} className="w-full" /></Field>
            <Field label={`Max stations k = ${sp.k}`}><input type="range" min="1" max="8" step="1" value={sp.k} onChange={(e) => setSp({ k: +e.target.value })} className="w-full" /></Field>
            <Field label={`Recent observations averaged = ${sp.history}`} hint="Used for TP, chlorophyll-a, DO"><input type="range" min="1" max="3" step="1" value={sp.history} onChange={(e) => setSp({ history: +e.target.value })} className="w-full" /></Field>
            <Field label={`Weak-support distance = ${sp.farKm} km`}><input type="range" min="30" max="200" step="10" value={sp.farKm} onChange={(e) => setSp({ farKm: +e.target.value })} className="w-full" /></Field>
            <div className="flex items-end"><button className="btn btn-ghost" onClick={() => setSp(DEFAULT_SPATIAL)}>Reset to defaults</button></div>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-slate-600">Estimate = Σ wᵢZᵢ / Σ wᵢ with wᵢ = 1 / (dᵢ + 1 km)^p, using great-circle distance and only stations on the same lake with an observation in the last {sp.staleDays} days. Neighbouring lakes are never mixed.</p>
        </Card>
      </div>

      <Card className="mt-4" title="How well does the spatial method work?" subtitle={`Leave-one-station-out check on ${val.n_cases.toLocaleString()} cases (2024-2025). Each monitored station is hidden and re-estimated from its same-lake neighbours. Computed offline with the default settings.`}>
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <div className="label mb-1">Phosphorus estimate error</div>
            <table className="w-full"><tbody>
              <tr><td className="td">RMSE, IDW</td><td className="td text-right font-semibold">{fmt(val.tp.rmse_idw, 1)} µg/L</td></tr>
              <tr><td className="td">RMSE, equal weights</td><td className="td text-right">{fmt(val.tp.rmse_equal_weights, 1)} µg/L</td></tr>
              <tr><td className="td">R², IDW</td><td className="td text-right font-semibold">{fmt(val.tp.r2_idw, 2)}</td></tr>
              <tr><td className="td">R², equal weights</td><td className="td text-right">{fmt(val.tp.r2_equal_weights, 2)}</td></tr>
            </tbody></table>
          </div>
          <div>
            <div className="label mb-1">Bloom ranking (ROC-AUC, next sample)</div>
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={[{ n: "Own station inputs", v: val.bloom_auc.own_station_inputs }, { n: "IDW estimate", v: val.bloom_auc.spatial_idw }, { n: "Equal weights", v: val.bloom_auc.equal_weights }]} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.08)" horizontal={false} /><XAxis type="number" domain={[0.5, 1]} tick={AXIS} /><YAxis type="category" dataKey="n" tick={AXIS} width={100} /><Tooltip formatter={(v) => v.toFixed(3)} />
                <Bar dataKey="v">{["#8fc1e3", "#35d0c4", "#6b7494"].map((c, i) => <Cell key={i} fill={c} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="text-xs leading-relaxed text-slate-600">
            <p>Hiding a station and estimating it from neighbours recovers its phosphorus with R² of {fmt(val.tp.r2_idw, 2)}, and the resulting bloom ranking (AUC {fmt(val.bloom_auc.spatial_idw, 3)}) is only a little below using the station's own inputs ({fmt(val.bloom_auc.own_station_inputs, 3)}).</p>
            <p className="mt-2">Weighting by distance beat equal weights on phosphorus error ({fmt(val.tp.rmse_idw, 1)} vs {fmt(val.tp.rmse_equal_weights, 1)} µg/L), but made almost no difference to bloom ranking. These checks cover stations on the same lake with close neighbours; isolated bays and tributary-driven sites are the hard cases.</p>
          </div>
        </div>
      </Card>
    </div>
  );
}

// Two views of the same unmonitored locations: the Kriging + AHP risk assessment and the bloom-probability estimates.
export default function Unmonitored() {
  const [tab, setTab] = useState("ahp");
  return (
    <div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "ahp", label: "Kriging + AHP risk" }, { id: "bloom", label: "Bloom probability estimates" }]} />
      <div className="pt-4">{tab === "ahp" ? <UnmonitoredAhp /> : <BloomEstimates />}</div>
    </div>
  );
}
