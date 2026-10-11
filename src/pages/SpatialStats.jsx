import { useMemo, useState } from "react";
import { CartesianGrid, ComposedChart, Legend as RLegend, Line, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { useApp } from "../state.jsx";
import { Card, Empty, Field, Kpi, Note, PageHeader, SimBadge, AXIS } from "../components/ui.jsx";
import RiskMap from "../components/RiskMap.jsx";
import { LAKE_NAMES, monitoredStations } from "../lib/data.js";
import {
  benjaminiHochberg, buildWeights, experimentalVariogram, fitAllModels, forwardTransform, globalMoran, lakePairs, localMoran, variogramModel, VARIOGRAM_MODELS,
} from "../lib/spatialCore.js";
import { INDICATORS, MAIN_INDICATORS, SPATIAL, TRAIN_END, analysisRowsBetween, snapshotRaw, stationMean } from "../lib/spatialData.js";
import { fmt } from "../lib/stats.js";
import { DATES } from "../lib/data.js";

const CLUSTER = {
  HH: { color: "#c62828", label: "High-high cluster" },
  LL: { color: "#1565c0", label: "Low-low cluster" },
  HL: { color: "#ef9a9a", label: "High-low outlier" },
  LH: { color: "#90caf9", label: "Low-high outlier" },
  NS: { color: "#b0bec5", label: "Not significant" },
};
const MODEL_COLORS = { spherical: "#5aa9e6", exponential: "#35d0c4", gaussian: "#a98bff" };

export default function SpatialStats() {
  const { dateStr } = useApp();
  const [ind, setInd] = useState("tp");
  const [basis, setBasis] = useState("snapshot");
  const [scale, setScale] = useState("analysis");
  const [wKind, setWKind] = useState("knn");
  const [k, setK] = useState(4);
  const [band, setBand] = useState(120);
  const [sameLake, setSameLake] = useState(true);
  const [rowStd, setRowStd] = useState(true);
  const [perms, setPerms] = useState(499);
  const [localScheme, setLocalScheme] = useState("all");
  const [alpha, setAlpha] = useState(0.05);
  const [fdr, setFdr] = useState(false);
  const [selected, setSelected] = useState(null);
  const meta = INDICATORS[ind];

  // ------------------------------------------------------------- Moran's I
  const calc = useMemo(() => {
    const asRaw = scale === "raw";
    const z =
      basis === "snapshot"
        ? snapshotRaw(ind, dateStr).map((v) => (Number.isNaN(v) || asRaw ? v : forwardTransform(v, meta.transform)))
        : stationMean(ind, DATES[0], basis === "mean_train" ? TRAIN_END : DATES[DATES.length - 1], asRaw);
    const idx = z.map((v, i) => (Number.isNaN(v) ? -1 : i)).filter((i) => i >= 0);
    const st = idx.map((i) => monitoredStations[i]);
    const zz = idx.map((i) => z[i]);
    const groups = st.map((s) => s.lake);
    const { neigh, wts } = buildWeights(st, { kind: wKind, k, bandKm: band, power: 1, sameLake, standardize: rowStd });
    const islands = neigh.filter((n) => !n.length).length;
    const links = neigh.reduce((a, n) => a + n.length, 0);
    if (links === 0) return { empty: true, st, islands };
    const gAll = globalMoran(zz, groups, neigh, wts, perms, "all", 11);
    const gWithin = globalMoran(zz, groups, neigh, wts, perms, "within_lake", 11);
    const loc = localMoran(zz, groups, neigh, wts, perms, localScheme, 21);
    const sigFdr = benjaminiHochberg(loc.map((l) => l.p), alpha);
    const rows = st.map((s, i) => {
      const sig = fdr ? sigFdr[i] : loc[i].p < alpha;
      return { ...s, name: s.name, monitored: true, value: zz[i], ...loc[i], sig, cluster: sig ? loc[i].quadrant : "NS" };
    });
    const dropped = monitoredStations.length - st.length;
    return { empty: false, st, zz, rows, gAll, gWithin, islands, links, dropped, nUsed: st.length };
  }, [ind, basis, scale, wKind, k, band, sameLake, rowStd, perms, localScheme, alpha, fdr, dateStr]);

  // ------------------------------------------------------------- variogram
  const [vLag, setVLag] = useState(30);
  const [vCut, setVCut] = useState(300);
  const [vBasis, setVBasis] = useState("train");
  const [vLake, setVLake] = useState("All");
  const vg = useMemo(() => {
    let rows;
    if (vBasis === "snapshot") rows = [snapshotRaw(ind, dateStr).map((v) => (Number.isNaN(v) ? NaN : forwardTransform(v, meta.transform)))];
    else rows = analysisRowsBetween(ind, DATES[0], vBasis === "train" ? TRAIN_END : DATES[DATES.length - 1]);
    const pairs = lakePairs(monitoredStations, vLake === "All" ? null : vLake);
    const bins = experimentalVariogram(rows, pairs, vLag, vCut);
    const fits = bins.length >= 3 ? fitAllModels(bins) : null;
    const best = fits ? Object.values(fits).reduce((a, b) => (b.wrss < a.wrss ? b : a)).model : null;
    const hMax = Math.max(vCut, ...bins.map((b) => b.h)) * 1.05;
    const grid = Array.from({ length: 61 }, (_, i) => (hMax * i) / 60);
    const data = grid.map((h) => {
      const row = { h };
      if (fits) VARIOGRAM_MODELS.forEach((m) => (row[m] = variogramModel(m, h, fits[m].psill, fits[m].range, fits[m].nugget)));
      return row;
    });
    bins.forEach((b) => data.push({ h: b.h, Experimental: b.gamma, n_pairs: b.n_pairs }));
    data.sort((a, b) => a.h - b.h);
    const all = rows.flat().filter((v) => !Number.isNaN(v));
    const mean = all.reduce((a, b) => a + b, 0) / (all.length || 1);
    const variance = all.reduce((a, v) => a + (v - mean) ** 2, 0) / Math.max(all.length - 1, 1);
    return { bins, fits, best, data, variance, nPairs: pairs.length };
  }, [ind, vLag, vCut, vBasis, vLake, dateStr]);
  const published = SPATIAL.variograms[ind];
  const isDefaultVario = vBasis === "train" && vLag === 30 && vCut === 300 && vLake === "All";
  const vstat = SPATIAL.meta;

  const sel = calc.rows?.find((r) => r.id === selected);
  const interpretation = !calc.empty
    ? (() => {
        const g = calc.gAll;
        const gw = calc.gWithin;
        const dir = g.I > g.expected ? "positive" : "negative";
        const sigAll = g.p_perm_two_sided < 0.05;
        const sigWithin = gw.p_perm_two_sided < 0.05;
        return `Moran's I = ${fmt(g.I, 3)} against an expected ${fmt(g.expected, 3)} under spatial randomness (z = ${fmt(g.z_norm, 2)}). ` +
          (sigAll ? `Stations that are close together have ${dir === "positive" ? "similar" : "dissimilar"} values across the region (permutation p ${g.p_perm_two_sided < 0.01 ? "< 0.01" : "= " + fmt(g.p_perm_two_sided, 3)}). ` : `The pattern is not distinguishable from random at the 5% level (p = ${fmt(g.p_perm_two_sided, 3)}). `) +
          (sigWithin ? `The clustering also holds inside lakes (within-lake permutation p = ${fmt(gw.p_perm_two_sided, 3)}), so it is more than a difference between lakes.` : `Inside individual lakes the pattern is not clearly different from random (within-lake permutation p = ${fmt(gw.p_perm_two_sided, 3)}), so much of the regional clustering reflects differences between lakes.`);
      })()
    : "";

  return (
    <div>
      <PageHeader
        title="Spatial Statistics"
        subtitle="Is water quality spatially clustered, and how far does that structure reach? Global and Local Moran's I with permutation tests, and the semivariogram that Kriging relies on."
        right={<SimBadge />}
      />
      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Indicator"><select className="select" value={ind} onChange={(e) => { setInd(e.target.value); setSelected(null); }}>{[...MAIN_INDICATORS, "rain"].map((k2) => <option key={k2} value={k2}>{INDICATORS[k2].label}</option>)}</select></Field>
          <Field label="Values used"><select className="select" value={basis} onChange={(e) => setBasis(e.target.value)}><option value="snapshot">Latest sample at the analysis run ({dateStr})</option><option value="mean_all">Station mean 2018-2025</option><option value="mean_train">Station mean 2018-2023</option></select></Field>
          <Field label="Scale"><select className="select" value={scale} onChange={(e) => setScale(e.target.value)}><option value="analysis">{meta.transform === "none" ? "Raw values" : "Log-transformed (analysis scale)"}</option><option value="raw">Raw values</option></select></Field>
          <Field label="Spatial weights"><select className="select" value={wKind} onChange={(e) => setWKind(e.target.value)}><option value="knn">k nearest neighbours</option><option value="band">Distance band (binary)</option><option value="idw">Distance band, inverse distance</option></select></Field>
          {wKind === "knn" ? <Field label={`k = ${k}`}><input type="range" min="1" max="8" value={k} onChange={(e) => setK(+e.target.value)} className="w-28" /></Field> : <Field label={`Band = ${band} km`}><input type="range" min="40" max="400" step="10" value={band} onChange={(e) => setBand(+e.target.value)} className="w-28" /></Field>}
          <label className="flex items-center gap-2 pb-1 text-xs"><input type="checkbox" checked={sameLake} onChange={(e) => setSameLake(e.target.checked)} /> Neighbours on the same lake only</label>
          <label className="flex items-center gap-2 pb-1 text-xs"><input type="checkbox" checked={rowStd} onChange={(e) => setRowStd(e.target.checked)} /> Row-standardised</label>
          <Field label="Permutations"><select className="select" value={perms} onChange={(e) => setPerms(+e.target.value)}><option value={99}>99</option><option value={499}>499</option><option value={999}>999</option></select></Field>
        </div>
        {!sameLake && <div className="mt-3"><Note tone="warn" title="Cross-lake neighbours allowed.">Stations on different lakes are not hydrologically connected, so these weights mix unrelated basins. Use only for comparison.</Note></div>}
      </Card>

      {calc.empty ? (
        <Empty>No station has a neighbour under these weights ({calc.islands} isolated stations). Increase k or the distance band.</Empty>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi label="Global Moran's I" value={fmt(calc.gAll.I, 3)} sub={`expected ${fmt(calc.gAll.expected, 3)} · n = ${calc.nUsed}`} accent="#5aa9e6" />
            <Kpi label="z-score (normal theory)" value={fmt(calc.gAll.z_norm, 2)} sub={`z from permutations ${fmt(calc.gAll.z_perm, 2)}`} accent="#35d0c4" />
            <Kpi label="p, permuting all stations" value={calc.gAll.p_perm_two_sided < 0.001 ? "< 0.001" : fmt(calc.gAll.p_perm_two_sided, 3)} sub={`${perms} permutations, two-sided`} accent={calc.gAll.p_perm_two_sided < 0.05 ? "#3ecf8e" : "#f2c14e"} />
            <Kpi label="p, permuting within lakes" value={calc.gWithin.p_perm_two_sided < 0.001 ? "< 0.001" : fmt(calc.gWithin.p_perm_two_sided, 3)} sub="keeps lake differences fixed" accent={calc.gWithin.p_perm_two_sided < 0.05 ? "#3ecf8e" : "#f2c14e"} />
            <Kpi label="Weights" value={`${calc.links} links`} sub={`${calc.islands} isolated stations${calc.dropped ? ` · ${calc.dropped} stations without a recent sample` : ""}`} accent="#a98bff" />
          </div>
          <div className="mt-3"><Note tone="info" title="Reading the result.">{interpretation}</Note></div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card title="Moran scatterplot" subtitle="Each station's value (centred) against the weighted mean of its neighbours. The line has slope I when weights are row-standardised.">
              <ResponsiveContainer width="100%" height={330}>
                <ScatterChart margin={{ left: 0, right: 10, top: 5, bottom: 15 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.08)" />
                  <XAxis dataKey="z" type="number" tick={AXIS} tickFormatter={(v) => v.toFixed(1)} label={{ value: `${meta.label} (centred${scale === "analysis" && meta.transform !== "none" ? ", log" : ""})`, position: "insideBottom", offset: -8, fontSize: 11 }} />
                  <YAxis dataKey="lag" type="number" tick={AXIS} tickFormatter={(v) => v.toFixed(1)} label={{ value: "Neighbour mean", angle: -90, position: "insideLeft", fontSize: 11 }} />
                  <ZAxis range={[50, 50]} />
                  <ReferenceLine x={0} stroke="#8c95b3" />
                  <ReferenceLine y={0} stroke="#8c95b3" />
                  {(() => {
                    const zs = calc.rows.map((r) => r.z);
                    const lo = Math.min(...zs), hi = Math.max(...zs);
                    return <ReferenceLine segment={[{ x: lo, y: calc.gAll.I * lo }, { x: hi, y: calc.gAll.I * hi }]} stroke="#eef0fb" strokeDasharray="5 3" />;
                  })()}
                  <Tooltip formatter={(v) => Number(v).toFixed(3)} labelFormatter={() => ""} />
                  <RLegend verticalAlign="top" wrapperStyle={{ fontSize: 12 }} />
                  {["HH", "LL", "HL", "LH"].map((q) => (
                    <Scatter key={q} name={q} data={calc.rows.filter((r) => r.quadrant === q).map((r) => ({ z: r.z, lag: r.lag, id: r.id }))} fill={CLUSTER[q].color} onClick={(d) => setSelected(d.id)} />
                  ))}
                </ScatterChart>
              </ResponsiveContainer>
            </Card>
            <Card title="Local clusters (Local Moran's I)" subtitle={`Markers show clusters that pass the significance test. Grey = not significant. Values for ${basis === "snapshot" ? `the ${dateStr} run` : "the station mean"}.`}
              right={<div className="flex flex-wrap items-center gap-2 text-xs">
                <select className="select" value={localScheme} onChange={(e) => setLocalScheme(e.target.value)}><option value="all">Regional clusters</option><option value="within_lake">Within-lake clusters</option></select>
                <select className="select" value={alpha} onChange={(e) => setAlpha(+e.target.value)}><option value={0.1}>α = 0.10</option><option value={0.05}>α = 0.05</option><option value={0.01}>α = 0.01</option></select>
                <label className="flex items-center gap-1"><input type="checkbox" checked={fdr} onChange={(e) => setFdr(e.target.checked)} /> FDR-adjusted</label>
              </div>}>
              <RiskMap locations={calc.rows} selectedId={selected} onSelect={setSelected} height={330} compact showTiles={false}
                colorFn={(r) => CLUSTER[r.cluster].color} ringFn={() => false}
                tooltipFn={(r) => `<strong>${r.id}</strong> ${r.name}<br/>${CLUSTER[r.cluster].label} · I = ${r.I.toFixed(2)} · p = ${r.p.toFixed(3)}`} />
              <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-600">{Object.entries(CLUSTER).map(([key, c]) => <span key={key} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />{c.label}</span>)}</div>
              <p className="mt-2 text-[11px] text-slate-500">
                {localScheme === "all" ? "Regional clusters compare each station and its neighbours with every other station, so differences between lakes show up as clusters." : "Within-lake clusters hold lake membership fixed and ask whether a station stands out from the others on its own lake. With 6 to 7 stations per lake this test has little power."}
                {" "}{calc.rows.filter((r) => r.sig).length} of {calc.rows.length} stations are significant{fdr ? " after false-discovery-rate adjustment" : " without multiple-testing adjustment (treat single hits with caution)"}.
              </p>
            </Card>
          </div>

          <Card className="mt-4" title="Local Moran's I by station" subtitle="Click a row to highlight it on the map. I is scaled as in PySAL.">
            <div className="max-h-[360px] overflow-auto">
              <table className="w-full">
                <thead><tr><th className="th">Station</th><th className="th">Lake</th><th className="th">Value</th><th className="th">Centred z</th><th className="th">Neighbour mean</th><th className="th">Local I</th><th className="th">p</th><th className="th">Quadrant</th><th className="th">Result</th></tr></thead>
                <tbody>
                  {[...calc.rows].sort((a, b) => a.p - b.p).map((r) => (
                    <tr key={r.id} onClick={() => setSelected(r.id)} className={`cursor-pointer hover:bg-slate-50 ${r.id === selected ? "bg-teal-50" : ""}`}>
                      <td className="td font-semibold">{r.id}</td><td className="td">{r.lake}</td>
                      <td className="td">{fmt(scale === "analysis" && meta.transform !== "none" ? Math.exp(r.value) : meta.transform === "log1p" && scale === "analysis" ? Math.expm1(r.value) : r.value, meta.digits)}</td>
                      <td className="td">{fmt(r.z, 2)}</td><td className="td">{fmt(r.lag, 2)}</td><td className="td">{fmt(r.I, 2)}</td><td className="td">{fmt(r.p, 3)}</td><td className="td">{r.quadrant}</td>
                      <td className="td text-xs"><span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: CLUSTER[r.cluster].color }} />{CLUSTER[r.cluster].label}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {sel && <p className="mt-2 text-xs text-slate-600">{sel.id} ({sel.name}): centred value {fmt(sel.z, 2)}, neighbour mean {fmt(sel.lag, 2)}, local I {fmt(sel.I, 2)}, p = {fmt(sel.p, 3)}.</p>}
          </Card>
        </>
      )}

      <Card className="mt-4" title="Experimental semivariogram and fitted models" subtitle={`${meta.label}${meta.transform !== "none" ? " (log scale)" : ""}. Pairs are formed only between stations on the same lake. Each point is the mean semivariance of the pairs in a distance bin.`}
        right={<div className="flex flex-wrap items-end gap-3">
          <Field label="Dates"><select className="select" value={vBasis} onChange={(e) => setVBasis(e.target.value)}><option value="train">2018-2023 (used by Kriging)</option><option value="all">All dates</option><option value="snapshot">Single run date</option></select></Field>
          <Field label="Lake"><select className="select" value={vLake} onChange={(e) => setVLake(e.target.value)}><option>All</option>{LAKE_NAMES.map((l) => <option key={l}>{l}</option>)}</select></Field>
          <Field label={`Lag width ${vLag} km`}><input type="range" min="15" max="80" step="5" value={vLag} onChange={(e) => setVLag(+e.target.value)} className="w-24" /></Field>
          <Field label={`Max distance ${vCut} km`}><input type="range" min="100" max="400" step="20" value={vCut} onChange={(e) => setVCut(+e.target.value)} className="w-24" /></Field>
        </div>}>
        {!vg.fits ? <Empty>Fewer than 3 distance bins contain station pairs. Widen the lag, raise the maximum distance, or choose all lakes.</Empty> : (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <ResponsiveContainer width="100%" height={340}>
                <ComposedChart data={vg.data} margin={{ left: 0, right: 10, top: 5, bottom: 15 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.08)" />
                  <XAxis dataKey="h" type="number" domain={[0, "dataMax"]} tick={AXIS} tickFormatter={(v) => Math.round(v)} label={{ value: "Separation distance (km)", position: "insideBottom", offset: -8, fontSize: 11 }} />
                  <YAxis tick={AXIS} tickFormatter={(v) => v.toFixed(2)} label={{ value: "Semivariance", angle: -90, position: "insideLeft", fontSize: 11 }} />
                  <Tooltip formatter={(v, n) => (v === null || v === undefined ? "" : Number(v).toFixed(3))} labelFormatter={(v) => `${Number(v).toFixed(0)} km`} />
                  <RLegend verticalAlign="top" wrapperStyle={{ fontSize: 12 }} />
                  <ReferenceLine y={vg.variance} stroke="#8c95b3" strokeDasharray="4 4" label={{ value: "overall variance", fontSize: 10, fill: "#9aa4c4", position: "insideTopLeft" }} />
                  {VARIOGRAM_MODELS.map((m) => <Line key={m} dataKey={m} stroke={MODEL_COLORS[m]} strokeWidth={vg.best === m ? 3 : 1.5} dot={false} connectNulls isAnimationActive={false} />)}
                  <Line dataKey="Experimental" stroke="#a98bff" strokeWidth={0} legendType="circle" dot={{ r: 5, fill: "#eef0fb", stroke: "#0a0d1a", strokeWidth: 1 }} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
              <p className="text-[11px] text-slate-500">Thick line = best weighted fit. {vg.bins.length} bins from {vg.nPairs} station pairs ({vg.bins.reduce((a, b) => a + b.n_obs, 0).toLocaleString()} pair-date comparisons). Fits are weighted by the number of distinct station pairs per bin, because repeating the same pairs on many dates does not add spatial information.</p>
            </div>
            <div>
              <table className="w-full"><thead><tr><th className="th">Model</th><th className="th">Nugget</th><th className="th">Partial sill</th><th className="th">Range km</th><th className="th">RMSE</th></tr></thead>
                <tbody>{VARIOGRAM_MODELS.map((m) => { const f = vg.fits[m]; return (
                  <tr key={m} className={vg.best === m ? "bg-teal-50" : ""}><td className="td font-semibold" style={{ color: MODEL_COLORS[m] }}>{m}</td><td className="td">{fmt(f.nugget, 3)}</td><td className="td">{fmt(f.psill, 3)}</td><td className="td">{f.range_at_limit ? `${f.range}*` : f.range}</td><td className="td">{fmt(f.rmse, 3)}</td></tr>); })}</tbody></table>
              {VARIOGRAM_MODELS.some((m) => vg.fits[m].range_at_limit) && <p className="mt-2 text-[11px] leading-relaxed text-amber-800">* The best range hit the 600 km search limit: semivariance is still rising at the longest separations in the data ({fmt(vstat.pair_distance_km[1], 0)} km), so no sill is reached. This indicates a gradient (trend) across lakes, and the range should not be read as a physical correlation length.</p>}
              {isDefaultVario ? <p className="mt-2 text-[11px] text-slate-500">These settings match the published fit used for Kriging. Best by weighted fit: <strong>{published.best_by_fit}</strong>. Kriging model choice is made on cross-validation in Model Performance.</p> : <p className="mt-2 text-[11px] text-slate-500">Custom settings: this exploratory fit does not change the Kriging parameters.</p>}
              <div className="mt-3 rounded-lg bg-slate-50 p-2.5 text-[11px] leading-relaxed text-slate-600">Nugget: variation at zero distance (measurement noise and variation below station spacing). Partial sill: structured variation. Sill = nugget + partial sill. Nugget share: {fmt(vg.fits[vg.best].nugget / vg.fits[vg.best].sill * 100, 0)}% of the sill.</div>
            </div>
          </div>
        )}
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Anisotropy and trend checks" subtitle="Computed offline for the 2018-2023 data. Exploratory: 29 to 31 stations support only a rough check.">
          <table className="w-full"><thead><tr><th className="th">Direction</th><th className="th">Pairs</th><th className="th">Mean semivariance</th></tr></thead>
            <tbody>{published.directional.map((d) => <tr key={d.direction}><td className="td">{d.direction === 0 ? "East-west (0°)" : d.direction === 90 ? "North-south (90°)" : `${d.direction}°`}</td><td className="td">{d.n_pairs}</td><td className="td">{d.mean_gamma === null ? "n/a" : fmt(d.mean_gamma, 3)}</td></tr>)}</tbody></table>
          <div className="mt-2 text-xs leading-relaxed text-slate-700">
            Largest to smallest directional semivariance: <strong>{published.anisotropy_ratio ? fmt(published.anisotropy_ratio, 1) : "n/a"}×</strong>. {published.anisotropy_ratio > 2 ? "That is large, but each direction rests on a handful of pairs from different lakes with different shapes, so it mostly reflects which lakes contribute to each direction rather than true directional continuity. Anisotropic Kriging is not justified by this data." : "No strong directional difference."}
          </div>
          <div className="mt-3 border-t border-slate-100 pt-2 text-xs leading-relaxed text-slate-700">
            <div className="label mb-1">Trend inside lakes (station means regressed on east and north position)</div>
            R² = {fmt(published.trend.r2, 2)}, F-test p {published.trend.f_p_value < 0.001 ? "< 0.001" : "= " + fmt(published.trend.f_p_value, 3)}; slopes {fmt(published.trend.slope_east_per_100km, 2)} per 100 km east and {fmt(published.trend.slope_north_per_100km, 2)} per 100 km north (analysis scale).
            {published.trend.r2 > 0.4 && published.trend.f_p_value < 0.05 ? " A real within-lake gradient is present. Ordinary Kriging copes with it locally through its neighbourhood mean, but universal Kriging or regression Kriging would model it explicitly. This is a listed limitation." : " The trend is weak."}
          </div>
        </Card>
        <Card title="Sensitivity of Moran's I to the weights" subtitle="Total phosphorus station means, within-lake permutation p (499 permutations). Computed offline.">
          <table className="w-full"><thead><tr><th className="th">Weights</th><th className="th">I</th><th className="th">z</th><th className="th">p (within lakes)</th><th className="th">Isolated</th></tr></thead>
            <tbody>{SPATIAL.weights_sensitivity_tp_station_mean.map((r, i) => (
              <tr key={i}><td className="td text-xs">{r.weights.kind === "knn" ? `${r.weights.k} nearest` : r.weights.kind === "band" ? `band ${r.weights.band_km} km` : `inverse distance, ${r.weights.band_km} km`}{r.weights.same_lake === false ? " · crosses lakes" : ""}</td><td className="td">{fmt(r.I, 3)}</td><td className="td">{fmt(r.z_norm, 2)}</td><td className="td">{fmt(r.p_within_lake, 3)}</td><td className="td">{r.islands}</td></tr>))}</tbody></table>
        </Card>
      </div>

      <Card className="mt-4" title="What spatial autocorrelation means for interpolation and for models">
        <div className="grid gap-4 text-sm leading-relaxed text-slate-700 md:grid-cols-3">
          <div><div className="label mb-1">Why Kriging is justified</div>Positive autocorrelation means a station tells us something about its neighbours, which is the condition that makes interpolation useful. Strong, significant Moran's I with a rising semivariogram supports estimating unmonitored points from nearby stations.</div>
          <div><div className="label mb-1">Where it limits accuracy</div>The semivariogram tells how quickly that information fades. Beyond the range, or where the nugget is large, a station adds little. Predictions far from any station revert to the lake mean and carry high Kriging variance.</div>
          <div><div className="label mb-1">For model interpretation</div>Spatially autocorrelated stations are not independent. Significance tests that ignore this overstate evidence, and random cross-validation is optimistic. The bloom model is therefore validated with station-aware folds, and Moran's I here is tested by permutation instead of assuming independence.</div>
        </div>
        <p className="mt-3 text-[11px] text-slate-500">Moran's I uses 29 to 31 stations. With so few points the permutation tests are coarse and the local tests have limited power. All results are for simulated data.</p>
      </Card>
    </div>
  );
}
