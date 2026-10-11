import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, Legend as RLegend } from "recharts";
import { useApp } from "../state.jsx";
import { Card, Empty, Field, Kpi, Note, PageHeader, SimBadge, Tabs, ObservedTag, EstimatedTag, AXIS } from "../components/ui.jsx";
import RiskMap from "../components/RiskMap.jsx";
import { LAKE_NAMES, LAKE_POLYGONS, stations } from "../lib/data.js";
import { variogramModel } from "../lib/spatialCore.js";
import { INDICATORS, MAIN_INDICATORS, SPATIAL } from "../lib/spatialData.js";
import { KRIGING, MODELS, defaultParams, krigeLake, predictPoint, lakeCells, lakeOfPoint, SPARSE_KM, backTransform } from "../lib/kriging.js";

const RAMP_VALUE = ["#2a1b5e", "#3c6fd8", "#35d0c4", "#f2e86b"];
const RAMP_SE = ["#171a33", "#5b3fc4", "#d45fb0", "#ffd9a0"];
function ramp(stops, t) {
  const x = Math.min(Math.max(t, 0), 1) * (stops.length - 1);
  const i = Math.min(Math.floor(x), stops.length - 2);
  const f = x - i;
  const a = stops[i], b = stops[i + 1];
  const c = (s, k) => parseInt(s.slice(1 + 2 * k, 3 + 2 * k), 16);
  return "#" + [0, 1, 2].map((k) => Math.round(c(a, k) + (c(b, k) - c(a, k)) * f).toString(16).padStart(2, "0")).join("");
}
const fmtN = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "n/a");

// small fetch helper: returns { data, error, loading }
function useFetched(url, parse) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  useEffect(() => {
    let live = true;
    fetch(url).then((r) => { if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return parse(r); })
      .then((data) => live && setState({ data, error: null, loading: false }))
      .catch((error) => live && setState({ data: null, error: error.message, loading: false }));
    return () => { live = false; };
  }, [url]);
  return state;
}
const parseCsv = async (r) => {
  const [head, ...lines] = (await r.text()).trim().split("\n");
  const cols = head.split(",");
  return lines.map((l) => Object.fromEntries(l.split(",").map((v, i) => [cols[i], v])));
};

export default function SpatialInterpolation() {
  const { dateStr } = useApp();
  const [key, setKey] = useState("tp");
  const [model, setModel] = useState(KRIGING.best_by_cv.tp);
  const [lake, setLake] = useState("Erie");
  const [view, setView] = useState("prediction");
  const [override, setOverride] = useState(null); // user-edited variogram parameters, null = published fit
  const [locId, setLocId] = useState("ERI-U1");
  const [custom, setCustom] = useState({ lat: "41.8", lon: "-82.9" });
  const [allowPrev, setAllowPrev] = useState(true);
  const [tab, setTab] = useState("check");

  const meta = INDICATORS[key];
  const params = override || defaultParams(key, model);
  const lakesShown = lake === "All lakes" ? LAKE_NAMES : [lake];
  const changeKey = (k) => { setKey(k); setModel(KRIGING.best_by_cv[k]); setOverride(null); };
  const changeModel = (m) => { setModel(m); setOverride(null); };

  // one kriging fit per lake shown; the surface is kriged lake by lake so nothing is interpolated across lakes or land
  const fits = useMemo(() => Object.fromEntries(lakesShown.map((l) => [l, krigeLake({ key, model, params, lake: l, dateStr, allowPrev })])), [key, model, params, lake, dateStr, allowPrev]);

  const cells = useMemo(() => {
    const out = [];
    lakeCells().filter((c) => fits[c.lake]?.ok).forEach((c) => {
      const p = predictPoint(fits[c.lake], key, c.lat, c.lon);
      if (p.nearestKm <= SPARSE_KM * 1.5) out.push({ ...c, mu: p.estimate, se: p.se, value: p.value, nearestKm: p.nearestKm });
    });
    return out;
  }, [fits, key]);

  const ranges = useMemo(() => {
    const mus = cells.map((c) => c.mu), ses = cells.map((c) => c.se);
    return { mu: [Math.min(...mus), Math.max(...mus)], se: [Math.min(...ses), Math.max(...ses)] };
  }, [cells]);
  const colored = useMemo(() => cells.map((c) => {
    const [lo, hi] = view === "prediction" ? ranges.mu : ranges.se;
    const t = hi > lo ? ((view === "prediction" ? c.mu : c.se) - lo) / (hi - lo) : 0.5;
    return { ...c, color: ramp(view === "prediction" ? RAMP_VALUE : RAMP_SE, t) };
  }), [cells, ranges, view]);

  // locations on the map: observed stations are circles, unmonitored sites are diamonds with kriged estimates
  const sites = useMemo(() => {
    const list = [];
    stations.filter((s) => lakesShown.includes(s.lake)).forEach((s) => {
      const f = fits[s.lake];
      if (!f?.ok) return list.push({ ...s, p: null, kind: "none" });
      const obs = f.used.find((u) => u.id === s.id);
      if (s.monitored && obs) return list.push({ ...s, p: 1, kind: "observed", raw: obs.raw, stale: obs.ageDays });
      const e = predictPoint(f, key, s.lat, s.lon);
      list.push({ ...s, p: 1, kind: "interpolated", pred: e });
    });
    return list;
  }, [fits, key, lake]);
  const siteColored = useMemo(() => sites.map((r) => {
    const [lo, hi] = ranges.mu;
    const z = r.kind === "observed" ? (meta.transform === "none" ? r.raw : meta.transform === "log1p" ? Math.log1p(r.raw) : Math.log(r.raw)) : r.kind === "interpolated" ? r.pred.estimate : NaN;
    return { ...r, color: Number.isFinite(z) && hi > lo ? ramp(RAMP_VALUE, (z - lo) / (hi - lo)) : "#8c95b3" };
  }), [sites, ranges, meta]);
  const tooltip = (r) => {
    if (r.kind === "observed") return `<strong>${r.id}</strong> ${r.name}<br/>OBSERVED ${fmtN(r.raw, meta.digits + 1)} ${meta.unit}${r.stale ? ` (sample ${r.stale} d earlier)` : ""}`;
    if (r.kind === "interpolated") return `<strong>${r.id}</strong> ${r.name}<br/>INTERPOLATED ${fmtN(r.pred.value, meta.digits + 1)} ${meta.unit}<br/>95% ${fmtN(r.pred.lower, meta.digits + 1)}–${fmtN(r.pred.upper, meta.digits + 1)}`;
    return `<strong>${r.id}</strong> ${r.name}<br/>no estimate for this date`;
  };

  // selected location (a station, an unmonitored site or a custom point)
  const selected = useMemo(() => {
    let loc = stations.find((s) => s.id === locId);
    if (locId === "custom") {
      const lat = parseFloat(custom.lat), lon = parseFloat(custom.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { error: "Enter a numeric latitude and longitude." };
      const l = lakeOfPoint(lat, lon);
      if (!l) return { error: "That point is outside every lake outline. Kriging here would cross land, so no estimate is made." };
      loc = { id: "Custom point", name: `${lat.toFixed(3)}, ${lon.toFixed(3)}`, lat, lon, lake: l, monitored: false };
    }
    if (!loc) return null;
    const f = fits[loc.lake] || krigeLake({ key, model, params, lake: loc.lake, dateStr, allowPrev });
    if (!f.ok) return { loc, error: f.reason };
    const obs = f.used.find((u) => u.id === loc.id);
    const est = obs ? predictLoo(f, key, loc) : predictPoint(f, key, loc.lat, loc.lon);
    return { loc, obs, est };
  }, [locId, custom, fits, key, model, params, dateStr, allowPrev]);

  const cv = KRIGING.cv[key];
  const best = KRIGING.best_by_cv[key];
  const fit = SPATIAL.variograms[key].fits[model];
  const curveData = useMemo(() => {
    const bins = SPATIAL.variograms[key].bins;
    const xs = new Set(bins.map((b) => b.h));
    for (let h = 0; h <= 320; h += 8) xs.add(h);
    return [...xs].sort((a, b) => a - b).map((h) => ({ h, fitted: h === 0 ? 0 : variogramModel(model, h, params.psill, params.range, params.nugget), bin: bins.find((b) => b.h === h)?.gamma ?? null }));
  }, [key, model, params]);

  const bounds = useMemo(() => {
    if (lake === "All lakes") return null;
    const pts = LAKE_POLYGONS[lake];
    return [[Math.min(...pts.map((p) => p[0])) - 0.1, Math.min(...pts.map((p) => p[1])) - 0.15], [Math.max(...pts.map((p) => p[0])) + 0.1, Math.max(...pts.map((p) => p[1])) + 0.15]];
  }, [lake]);
  const lakeList = [...LAKE_NAMES, "All lakes"];
  const firstFit = Object.values(fits).find((f) => f.ok);
  const failures = Object.values(fits).filter((f) => !f.ok);
  const [lo, hi] = view === "prediction" ? ranges.mu : ranges.se;
  const legendFmt = (v) => (view === "prediction" ? fmtN(backTransform(key, v, 0).value, meta.digits + 1) : fmtN(v, 2));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Spatial Interpolation (Ordinary Kriging)"
        subtitle={`Estimates ${meta.label.toLowerCase()} where nobody sampled, lake by lake, from the stations that have data for ${dateStr}. Observed values and interpolated values are always drawn differently.`}
        right={<SimBadge>SIMULATED DATA · {dateStr}</SimBadge>}
      />
      <Card>
        <div className="grid gap-3 md:grid-cols-5">
          <Field label="Indicator">
            <select className="select w-full" value={key} onChange={(e) => changeKey(e.target.value)}>
              {MAIN_INDICATORS.map((k) => <option key={k} value={k}>{INDICATORS[k].label} ({INDICATORS[k].unit})</option>)}
            </select>
          </Field>
          <Field label="Variogram model" hint={`Lowest cross-validation RMSE: ${best}`}>
            <select className="select w-full" value={model} onChange={(e) => changeModel(e.target.value)}>
              {MODELS.map((m) => <option key={m} value={m}>{m}{m === best ? " (best by CV)" : ""}</option>)}
            </select>
          </Field>
          <Field label="Lake">
            <select className="select w-full" value={lake} onChange={(e) => { setLake(e.target.value); }}>
              {lakeList.map((l) => <option key={l}>{l}</option>)}
            </select>
          </Field>
          <Field label="Location to inspect">
            <select className="select w-full" value={locId} onChange={(e) => { setLocId(e.target.value); const s = stations.find((x) => x.id === e.target.value); if (s && lake !== "All lakes") setLake(s.lake); }}>
              {stations.filter((s) => lake === "All lakes" || s.lake === lake).map((s) => <option key={s.id} value={s.id}>{s.id} · {s.monitored ? "monitored" : "unmonitored"}</option>)}
              <option value="custom">Custom point…</option>
            </select>
          </Field>
          <Field label="Map layer">
            <div className="flex gap-1">
              {[["prediction", "Prediction"], ["se", "Standard error"]].map(([v, t]) => (
                <button key={v} onClick={() => setView(v)} className={`btn-ghost flex-1 ${view === v ? "btn-active" : ""}`}>{t}</button>
              ))}
            </div>
          </Field>
        </div>
        {locId === "custom" && (
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <Field label="Latitude"><input className="input w-28" value={custom.lat} onChange={(e) => setCustom({ ...custom, lat: e.target.value })} /></Field>
            <Field label="Longitude"><input className="input w-28" value={custom.lon} onChange={(e) => setCustom({ ...custom, lon: e.target.value })} /></Field>
            <span className="pb-1 text-xs text-slate-500">The point must lie inside a lake outline.</span>
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-600">
          <label className="flex items-center gap-2"><input type="checkbox" checked={allowPrev} onChange={(e) => setAllowPrev(e.target.checked)} /> Use the previous 14-day sample for stations missing today</label>
          {["nugget", "psill", "range"].map((p) => (
            <label key={p} className="flex items-center gap-2">
              {p === "psill" ? "partial sill" : p}{p === "range" ? " (km)" : ""}
              <input type="range" min={0} max={p === "range" ? 600 : Math.max(2 * (fit.psill || 1), 1)} step={p === "range" ? 10 : 0.01} value={params[p]} onChange={(e) => setOverride({ ...params, [p]: +e.target.value })} />
              <span className="mono w-12 text-slate-700">{fmtN(params[p], p === "range" ? 0 : 2)}</span>
            </label>
          ))}
          <button className="btn-ghost" disabled={!override} onClick={() => setOverride(null)}>Reset to fitted</button>
        </div>
        {override && <div className="mt-2"><Note tone="warn" title="Manual variogram.">These parameters replace the fitted ones, so the validation table below (which uses the fitted parameters) no longer describes this map. The live leave-one-out check does.</Note></div>}
      </Card>

      {failures.map((f) => <Note key={f.lake} tone="danger" title={`${f.lake}:`}>{f.reason}</Note>)}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" title={view === "prediction" ? `Kriged ${meta.short} surface` : `Kriging standard error (${meta.transform === "none" ? meta.unit : "log scale"})`}
          subtitle="Colour is interpolated. Circles are observed stations, diamonds are unmonitored locations. Cells farther than 150 km from any used station are left blank.">
          {cells.length === 0 ? <Empty>No interpolation is possible for this selection. See the messages above.</Empty> : (
            <>
              <RiskMap locations={siteColored} selectedId={selected?.loc?.id} onSelect={(id) => setLocId(id)} height={460} gridCells={colored} gridOpacity={0.85} showTiles={false} bounds={bounds}
                colorFn={(r) => r.color} tooltipFn={tooltip} ringFn={(r) => r.kind === "interpolated" && r.pred.flags.length > 0} />
              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-600">
                <span className="mono">{legendFmt(lo)}</span>
                <span className="h-2.5 w-48 rounded" style={{ background: `linear-gradient(90deg, ${(view === "prediction" ? RAMP_VALUE : RAMP_SE).join(",")})` }} />
                <span className="mono">{legendFmt(hi)}</span>
                <span>{view === "prediction" ? meta.unit : "analysis-scale SE"}</span>
                <span className="ml-auto">Dashed red ring: interpolated site with a support warning</span>
              </div>
            </>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="Selected location" right={selected?.obs ? <ObservedTag /> : selected?.est ? <EstimatedTag /> : null}>
            {!selected ? <Empty>Pick a location.</Empty> : selected.error ? <Note tone="warn">{selected.error}</Note> : (
              <LocationPanel sel={selected} keyName={key} meta={meta} />
            )}
          </Card>
          {firstFit && (
            <div className="grid grid-cols-2 gap-3">
              <Kpi label="Live LOO RMSE" value={fmtN(firstFit.metrics.rmse, 3)} sub={`${lake === "All lakes" ? firstFit.lake : lake}, this date, analysis scale`} accent="#a98bff" />
              <Kpi label="Live LOO RMSSE" value={fmtN(firstFit.metrics.rmsse, 2)} sub="about 1 = honest variance" accent="#35d0c4" />
            </div>
          )}
        </div>
      </div>

      <Card><Tabs value={tab} onChange={setTab} tabs={[{ id: "check", label: "Validation" }, { id: "variogram", label: "Variogram" }, { id: "gaps", label: "Filled data gaps" }]} />
        <div className="pt-4">
          {tab === "check" && <ValidationTab keyName={key} model={model} cv={cv} meta={meta} best={best} />}
          {tab === "variogram" && (
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="h-72 lg:col-span-2">
                <ResponsiveContainer>
                  <ComposedChart data={curveData} margin={{ top: 20, right: 16, bottom: 28, left: 8 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.08)" />
                    <XAxis type="number" dataKey="h" tick={AXIS} domain={[0, 320]} label={{ value: "Separation distance (km)", position: "insideBottom", offset: -16, fill: "#9aa4c4", fontSize: 11 }} />
                    <YAxis tick={AXIS} label={{ value: "Semivariance", angle: -90, position: "insideLeft", fill: "#9aa4c4", fontSize: 11 }} />
                    <Tooltip formatter={(v) => (v == null ? "-" : v.toFixed(3))} labelFormatter={(h) => `${h.toFixed ? h.toFixed(0) : h} km`} />
                    <RLegend verticalAlign="top" wrapperStyle={{ fontSize: 12 }} />
                    <Line dataKey="fitted" name={`${model} model`} stroke="#a98bff" strokeWidth={2.5} dot={false} isAnimationActive={false} />
                    <Line dataKey="bin" name="experimental (pooled within lakes)" stroke="#35d0c4" strokeWidth={0} legendType="circle" dot={{ r: 5, fill: "#35d0c4", stroke: "#0a0d1a" }} connectNulls isAnimationActive={false} />
                    <ReferenceLine y={params.nugget + params.psill} stroke="#f2c14e" strokeDasharray="4 3" label={{ value: "sill", fill: "#f2c14e", fontSize: 11, position: "insideTopRight" }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-2 text-sm text-slate-600">
                <p><strong className="text-ink">Parameters used:</strong> nugget {fmtN(params.nugget, 3)}, partial sill {fmtN(params.psill, 3)}, range {fmtN(params.range, 0)} km (analysis scale).</p>
                {fit.range_at_limit && !override && <Note tone="warn" title="Range at the search limit.">The semivariance is still rising at the longest distances in the data, so the fitted range is a search-limit artefact, not a physical correlation length. The data show a gradient across each lake.</Note>}
                <p className="text-xs">Fitted on 2018–2023 only. Model choice is judged on 2024–2025 cross-validation, never on the fitting period.</p>
              </div>
            </div>
          )}
          {tab === "gaps" && <GapsTab keyName={key} meta={meta} />}
        </div>
      </Card>

      <Note title="Reading Kriging uncertainty.">
        The kriging standard error is the spatial prediction error implied by the fitted variogram. It does not include error in the variogram itself, change between sampling dates, non-stationarity, or measurement error in the stations. Intervals for log-scale indicators are back-transformed, so they are asymmetric and the estimate shown is the median. Interpolated values are never stored or displayed as observations.
      </Note>
    </div>
  );
}

// Leave-one-out prediction for a monitored station (what Kriging would have said without its own sample).
function predictLoo(f, key, loc) {
  const r = f.loo.find((x) => x.id === loc.id);
  const b = backTransform(key, r.predicted, r.se);
  return { estimate: r.predicted, se: r.se, ...b, flags: [], contributions: [], loo: true, observedZ: r.observed, std: r.std };
}

function LocationPanel({ sel, keyName, meta }) {
  const { loc, obs, est } = sel;
  const d = meta.digits + 1;
  return (
    <div className="space-y-3 text-sm">
      <div><div className="font-semibold text-ink">{loc.id} · {loc.name}</div><div className="text-xs text-slate-500">{loc.lake} · {loc.lat.toFixed(3)}, {loc.lon.toFixed(3)} · {loc.monitored ? "monitored" : "not monitored"}</div></div>
      {obs && <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2"><div className="label">Observed{obs.ageDays ? ` (sample ${obs.ageDays} days earlier)` : ""}</div><div className="mono text-lg text-ink">{fmtN(obs.raw, d)} {meta.unit}</div></div>}
      <div className={`rounded-lg px-3 py-2 ${obs ? "border border-white/10 bg-white/[0.03]" : "estimated"}`}>
        <div className="label">{obs ? "Kriged without this station (hidden-station check)" : "Interpolated estimate (median)"}</div>
        <div className="mono text-lg text-ink">{fmtN(est.value, d)} {meta.unit}</div>
        <div className="text-xs text-slate-500">95% interval {fmtN(est.lower, d)}–{fmtN(est.upper, d)} · SE {fmtN(est.se, 3)}{meta.transform === "none" ? "" : " (log scale)"}</div>
        {obs && <div className="mt-1 text-xs text-slate-600">Standardised error {fmtN(est.std, 2)}; values within ±1.96 are consistent with the stated uncertainty.</div>}
      </div>
      {est.flags?.length > 0 && <div className="space-y-1">{est.flags.map((f) => <Note key={f} tone="warn">{f}</Note>)}</div>}
      {!obs && est.contributions?.length > 0 && (
        <div>
          <div className="label mb-1">Contributing stations (kriging weights)</div>
          <table className="w-full text-xs"><tbody>
            {est.contributions.map((c) => (
              <tr key={c.id}><td className="td">{c.id}</td><td className="td mono text-right">{fmtN(c.raw, d)}</td><td className="td"><div className="h-1.5 rounded bg-white/10"><div className="h-full rounded" style={{ width: `${Math.min(Math.abs(c.weight) * 100, 100)}%`, background: c.weight < 0 ? "#ff5c6c" : "#a98bff" }} /></div></td><td className="td mono text-right">{c.weight.toFixed(2)}</td></tr>
            ))}
          </tbody></table>
          <div className="mt-1 text-[11px] text-slate-500">Nearest used station {est.nearestKm.toFixed(0)} km away. Negative weights (red) are normal in Kriging.</div>
        </div>
      )}
    </div>
  );
}

function ValidationTab({ keyName, model, cv, meta, best }) {
  const cases = useFetched("/data/kriging_cv_cases.json", (r) => r.json());
  const rows = MODELS.map((m) => ({ m, ...cv[m] }));
  const points = useMemo(() => {
    if (!cases.data) return [];
    const c = cases.data.cases;
    const truth = c[`${keyName}|truth`], pred = c[`${keyName}|${model}`].p;
    return truth.map((t, i) => ({ observed: t, predicted: pred[i] })).filter((_, i) => i % 2 === 0);
  }, [cases.data, keyName, model]);
  const lo = points.length ? Math.min(...points.map((p) => Math.min(p.observed, p.predicted))) : 0;
  const hi = points.length ? Math.max(...points.map((p) => Math.max(p.observed, p.predicted))) : 1;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        <p className="mb-2 text-xs text-slate-500">Leave-one-station-out on {cv.baselines ? KRIGING.meta.n_cases : ""} station-dates in 2024–2025 (variograms fitted on 2018–2023). Errors are on the analysis scale ({meta.transform === "none" ? meta.unit : `log ${meta.unit}`}); RMSSE near 1 and coverage near 0.95 mean the stated uncertainty is realistic.</p>
        <div className="overflow-x-auto"><table className="w-full text-xs">
          <thead><tr>{["Model", "ME", "MAE", "RMSE", "Mean std. error", "RMSSE", "95% coverage"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.m} className={r.m === model ? "bg-white/[0.05]" : ""}>
                <td className="td font-medium">{r.m}{r.m === best ? " ★" : ""}</td>
                {[r.me, r.mae, r.rmse, r.mean_std_error, r.rmsse].map((v, i) => <td key={i} className="td mono">{fmtN(v, 3)}</td>)}
                <td className="td mono">{(r.coverage95 * 100).toFixed(0)}%</td>
              </tr>
            ))}
            <tr><td className="td text-slate-500">IDW (power 2)</td><td className="td" /><td className="td mono">{fmtN(cv.baselines.idw_mae, 3)}</td><td className="td mono">{fmtN(cv.baselines.idw_rmse, 3)}</td><td className="td" colSpan={3} /></tr>
            <tr><td className="td text-slate-500">Lake mean</td><td className="td" /><td className="td mono">{fmtN(cv.baselines.lake_mean_mae, 3)}</td><td className="td mono">{fmtN(cv.baselines.lake_mean_rmse, 3)}</td><td className="td" colSpan={3} /></tr>
          </tbody>
        </table></div>
        {rows.some((r) => r.rmsse > 1.5 || r.coverage95 < 0.85) && <p className="mt-2 text-xs text-amber-800">Models with RMSSE above 1.5 or coverage below 85% understate their uncertainty; do not rely on their standard errors.</p>}
        <p className="mt-2 text-xs text-slate-600">
          Kriging RMSE is {(100 * (1 - cv[best].rmse / cv.baselines.idw_rmse)).toFixed(0)}% {cv[best].rmse <= cv.baselines.idw_rmse ? "lower" : "higher"} than IDW and {(100 * (1 - cv[best].rmse / cv.baselines.lake_mean_rmse)).toFixed(0)}% {cv[best].rmse <= cv.baselines.lake_mean_rmse ? "lower" : "higher"} than the lake mean. With 6–7 stations per lake the gain over IDW is small; Kriging's main advantage here is the calibrated uncertainty.
        </p>
      </div>
      <div className="h-72">
        {cases.loading ? <Empty>Loading cross-validation cases…</Empty> : cases.error ? <Note tone="danger" title="Could not load cross-validation cases.">{cases.error}</Note> : (
          <ResponsiveContainer>
            <ScatterChart margin={{ top: 10, right: 16, bottom: 28, left: 8 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" />
              <XAxis type="number" dataKey="observed" domain={[lo, hi]} tick={AXIS} tickFormatter={(v) => v.toFixed(1)} label={{ value: "Observed (hidden station)", position: "insideBottom", offset: -16, fill: "#9aa4c4", fontSize: 11 }} />
              <YAxis type="number" dataKey="predicted" domain={[lo, hi]} tick={AXIS} tickFormatter={(v) => v.toFixed(1)} label={{ value: "Kriged", angle: -90, position: "insideLeft", fill: "#9aa4c4", fontSize: 11 }} />
              <Tooltip formatter={(v) => v.toFixed(2)} />
              <ReferenceLine segment={[{ x: lo, y: lo }, { x: hi, y: hi }]} stroke="#eef0fb" strokeDasharray="5 3" />
              <Scatter data={points} fill="#a98bff" fillOpacity={0.45} isAnimationActive={false} />
            </ScatterChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function GapsTab({ keyName, meta }) {
  const csv = useFetched("/data/estimated_missing_values.csv", parseCsv);
  if (csv.loading) return <Empty>Loading estimates…</Empty>;
  if (csv.error) return <Note tone="danger" title="Could not load the filled-gap table.">{csv.error}</Note>;
  const colName = { tp: "Total_Phosphorus", chl: "Chlorophyll_a", doxy: "Dissolved_Oxygen", turb: "Turbidity", nitrate: "Nitrate", temp: "Water_Temperature" }[keyName];
  const rows = csv.data.filter((r) => r.Indicator === colName);
  if (!rows.length) return <Empty>No filled gaps for this indicator.</Empty>;
  return (
    <div>
      <p className="mb-2 text-xs text-slate-500">{rows.length} missing station-dates were estimated by Kriging from same-lake stations that day and are flagged ESTIMATED_KRIGING in the data files. They are never merged into the observed series. Outage gaps (several consecutive samples) are labelled.</p>
      <div className="max-h-80 overflow-auto"><table className="w-full text-xs">
        <thead><tr>{["Station", "Date", "Gap", `Estimate (${meta.unit})`, "95% interval", "Variogram", "Stations used"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
        <tbody>{rows.slice(0, 200).map((r, i) => (
          <tr key={i}><td className="td">{r.Station_ID}</td><td className="td">{r.Observation_Date}</td><td className="td">{r.Gap_Type}</td><td className="td mono">{(+r.Estimate).toFixed(meta.digits + 1)}</td><td className="td mono">{(+r.Lower95).toFixed(meta.digits + 1)}–{(+r.Upper95).toFixed(meta.digits + 1)}</td><td className="td">{r.Variogram}</td><td className="td">{r.Stations_Used}</td></tr>
        ))}</tbody>
      </table></div>
    </div>
  );
}
