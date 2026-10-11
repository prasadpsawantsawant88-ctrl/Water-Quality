import { useMemo, useState } from "react";
import { useApp } from "../state.jsx";
import { Card, Field, Legend, PageHeader, RiskBadge, Note } from "../components/ui.jsx";
import RiskMap from "../components/RiskMap.jsx";
import LocationDetail from "../components/LocationDetail.jsx";
import { LAKE_NAMES, monitoredStations } from "../lib/data.js";
import { LEVELS } from "../lib/risk.js";
import { haversineKm } from "../lib/spatial.js";
import { computeGrid } from "../lib/grid.js";
import { fmt, pct } from "../lib/stats.js";

export default function GeoExplorer() {
  const { run, settings, dateStr, selectedId, setSelectedId } = useApp();
  const [lake, setLake] = useState("All");
  const [level, setLevel] = useState("All");
  const [kind, setKind] = useState("All");
  const [tiles, setTiles] = useState(true);
  const [showGrid, setShowGrid] = useState(false);

  const shown = run.results.filter((r) =>
    (lake === "All" || r.lake === lake) && (level === "All" || r.level === level) &&
    (kind === "All" || (kind === "Monitored" ? r.monitored : !r.monitored)));
  const selected = run.byId[selectedId];

  // interpolated layer is only computed when switched on
  const cells = useMemo(() => (showGrid ? computeGrid(dateStr, settings) : null), [showGrid, dateStr, settings]);
  const gridShown = cells ? cells.filter((c) => lake === "All" || c.lake === lake) : null;

  // nearby stations for comparison
  const nearby = selected
    ? monitoredStations
        .filter((s) => s.id !== selected.id)
        .map((s) => ({ s, d: haversineKm(selected.lat, selected.lon, s.lat, s.lon) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 5)
    : [];

  // high risk with poor coverage: unmonitored with limited confidence, or monitored stations with stale data
  const gaps = run.results
    .filter((r) => r.p !== null && (r.level === "High" || r.level === "Critical") && ((!r.monitored && r.confidence.label !== "High") || r.stale))
    .sort((a, b) => b.p - a.p);

  return (
    <div>
      <PageHeader title="Geographic Risk Explorer" subtitle="Select a station or an unmonitored location to see its estimated risk, its inputs (observed versus interpolated) and nearby stations. Lake outlines are schematic." />
      <div className="mb-3 flex flex-wrap items-end gap-4">
        <Field label="Lake"><select className="select" value={lake} onChange={(e) => setLake(e.target.value)}><option>All</option>{LAKE_NAMES.map((l) => <option key={l}>{l}</option>)}</select></Field>
        <Field label="Risk level"><select className="select" value={level} onChange={(e) => setLevel(e.target.value)}><option>All</option>{LEVELS.map((l) => <option key={l}>{l}</option>)}</select></Field>
        <Field label="Locations"><select className="select" value={kind} onChange={(e) => setKind(e.target.value)}><option>All</option><option>Monitored</option><option>Unmonitored</option></select></Field>
        <label className="flex items-center gap-2 pb-1 text-xs"><input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} /> Interpolated risk layer</label>
        <label className="flex items-center gap-2 pb-1 text-xs"><input type="checkbox" checked={tiles} onChange={(e) => setTiles(e.target.checked)} /> Basemap tiles</label>
        <div className="ml-auto pb-1"><Legend /></div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card className="p-2">
            <RiskMap locations={shown} selectedId={selectedId} onSelect={setSelectedId} height={560} gridCells={gridShown} showTiles={tiles} />
            <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 px-2 pb-1 text-[11px] text-slate-600">
              <span>● Monitored station (observed inputs)</span>
              <span>◆ Unmonitored location (estimated inputs)</span>
              <span className="text-red-700">◌ Dashed red ring: high estimated risk, limited support</span>
              {showGrid && <span>▒ Shaded cells: interpolated estimate, not observed. Only water within {settings.spatial.radiusKm} km of a same-lake station is shaded.</span>}
            </div>
          </Card>
        </div>
        <Card title={selected ? "Location detail" : "Location detail"} subtitle={selected ? null : "Click a marker on the map"}>
          {selected ? <LocationDetail r={selected} /> : <p className="text-sm text-slate-500">No location selected.</p>}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Compare nearby monitoring stations" subtitle={selected ? `Five closest stations to ${selected.id}` : "Select a location first"}>
          {selected && (
            <table className="w-full">
              <thead><tr><th className="th">Station</th><th className="th">Lake</th><th className="th">Dist.</th><th className="th">P(bloom)</th><th className="th">Risk</th><th className="th">TP</th><th className="th">Chl-a</th></tr></thead>
              <tbody>
                {nearby.map(({ s, d }) => {
                  const r = run.byId[s.id];
                  return (
                    <tr key={s.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setSelectedId(s.id)}>
                      <td className="td font-semibold">{s.id}</td><td className="td">{s.lake}{s.lake !== selected.lake && <span className="text-[10px] text-slate-400"> (other lake)</span>}</td>
                      <td className="td">{d.toFixed(0)} km</td><td className="td">{pct(r.p)}</td><td className="td"><RiskBadge level={r.level} /></td>
                      <td className="td">{fmt(r.inputs.tp)}</td><td className="td">{fmt(r.inputs.chl)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="High risk with poor monitoring coverage" subtitle="Unmonitored locations with less than high confidence, and monitored stations whose data are stale">
          {gaps.length === 0 ? <p className="text-sm text-slate-500">None in this run.</p> : (
            <table className="w-full">
              <thead><tr><th className="th">Location</th><th className="th">P(bloom)</th><th className="th">Risk</th><th className="th">Why coverage is poor</th></tr></thead>
              <tbody>
                {gaps.map((r) => (
                  <tr key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setSelectedId(r.id)}>
                    <td className="td font-semibold">{r.id}<div className="text-[11px] font-normal text-slate-500">{r.name}</div></td>
                    <td className="td">{pct(r.p)}</td><td className="td"><RiskBadge level={r.level} /></td>
                    <td className="td text-xs">{r.monitored ? `Last observation ${r.ageDays} days old` : `Estimated; confidence ${r.confidence.label.toLowerCase()}, nearest station ${r.spatial?.nearestUsedKm?.toFixed(0)} km`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
      <div className="mt-4"><Note>The interpolated layer is an estimate built from inverse-distance weighting of same-lake stations and the early-warning model. It is clipped to each lake outline and left blank where no station is close enough, so it never spans land or separate lakes.</Note></div>
    </div>
  );
}
