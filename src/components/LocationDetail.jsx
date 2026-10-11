import { useApp } from "../state.jsx";
import { RISK_COLORS, CANDIDATE_NOTICE } from "../lib/risk.js";
import { fmt, pct } from "../lib/stats.js";
import { EstimatedTag, ObservedTag, Note, RiskBadge, ProbBar } from "./ui.jsx";
import { VARIABLE_LABELS } from "../lib/model.js";

const ROWS = [
  ["tp", "Total phosphorus", "µg/L", 1],
  ["chl", "Chlorophyll-a", "µg/L", 1],
  ["temp", "Water temperature", "°C", 1],
  ["rain", "Rainfall (7-day)", "mm", 0],
  ["doxy", "Dissolved oxygen", "mg/L", 1],
];

// Detail panel for one location result (monitored or unmonitored)
export default function LocationDetail({ r, showLabButton = true }) {
  const { goto, settings, alerts } = useApp();
  if (!r) return null;
  const myAlerts = alerts.filter((a) => a.locationId === r.id);
  const nearest = r.spatial?.nearest;
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-base font-semibold text-ink">{r.id}</div>
          <div className="text-xs text-slate-600">{r.name} · Lake {r.lake}</div>
          <div className="text-[11px] text-slate-500">{r.lat.toFixed(3)}°, {r.lon.toFixed(3)}° · {r.status}</div>
        </div>
        <RiskBadge level={r.level} />
      </div>

      <div>
        <div className="flex items-end justify-between">
          <span className="label">Bloom probability (next sample)</span>
          <span className="text-xl font-semibold">{r.p === null ? "n/a" : pct(r.p)}</span>
        </div>
        <ProbBar p={r.p} color={RISK_COLORS[r.level]} />
        {r.p !== null && (
          <div className="mt-1 text-[11px] text-slate-500">
            Logistic {pct(r.pLR)} · Random forest {pct(r.pRF)}
            {r.delta !== null && <> · vs previous run {r.delta >= 0 ? "+" : ""}{(r.delta * 100).toFixed(0)} pts</>}
          </div>
        )}
      </div>

      <div className="rounded-lg bg-slate-50 p-2.5">
        <div className="label mb-1">Recommended action</div>
        <div className="text-slate-800">{r.action}</div>
      </div>

      {r.inputs && (
        <div>
          <div className="label mb-1 flex items-center gap-2">Model inputs {r.inputSource === "observed" ? <ObservedTag /> : <EstimatedTag />}</div>
          <table className="w-full">
            <tbody>
              {ROWS.map(([k, label, unit, d]) => (
                <tr key={k} className={r.inputSource === "estimated" ? "estimated" : ""}>
                  <td className="py-1 pl-1 text-xs text-slate-600">{label}</td>
                  <td className="py-1 pr-1 text-right text-xs font-semibold">{fmt(r.inputs[k], d)} <span className="font-normal text-slate-500">{unit}</span></td>
                </tr>
              ))}
              <tr><td className="py-1 pl-1 text-xs text-slate-600">Season of prediction</td><td className="py-1 pr-1 text-right text-xs font-semibold">{r.inputs.season}</td></tr>
            </tbody>
          </table>
          <p className="mt-1 text-[11px] text-slate-500">
            {r.monitored
              ? `Latest observation ${r.lastObsDate} (${r.ageDays} days before the run).`
              : "Dashed rows are interpolated from nearby stations, not measured here."}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg border border-slate-200 p-2">
          <div className="label">Confidence</div>
          <div className="mt-0.5 text-sm font-semibold">{r.confidence.label} <span className="font-normal text-slate-500">({fmt(r.confidence.score, 2)})</span></div>
          <div className="text-[11px] text-slate-500">Heuristic index, not a statistical interval</div>
        </div>
        <div className="rounded-lg border border-slate-200 p-2">
          <div className="label">{r.monitored ? "Observation age" : "Nearest station"}</div>
          {r.monitored ? (
            <div className="mt-0.5 text-sm font-semibold">{r.ageDays} days {r.stale && <span className="text-xs font-medium text-amber-700">· stale</span>}</div>
          ) : nearest ? (
            <div className="mt-0.5 text-sm font-semibold">{nearest.id} <span className="font-normal text-slate-500">· {nearest.distKm.toFixed(0)} km</span></div>
          ) : "n/a"}
        </div>
      </div>

      {r.factors.length > 0 && (
        <div>
          <div className="label mb-1">Main contributing factors</div>
          {r.factors.map((f) => (
            <div key={f.key} className="flex justify-between py-0.5 text-xs"><span>{f.label}</span><span className="font-semibold text-red-700">+{(f.delta * 100).toFixed(0)} pts</span></div>
          ))}
          <p className="text-[11px] text-slate-500">Change in probability versus typical conditions for that variable (one at a time).</p>
        </div>
      )}

      {r.spatial?.warnings?.length > 0 && <Note tone="warn" title="Spatial caution:">{r.spatial.warnings.join(" ")}</Note>}
      {myAlerts.length > 0 && (
        <div>
          <div className="label mb-1">Alert candidates</div>
          {myAlerts.map((a) => <div key={a.id} className="py-0.5 text-xs"><strong>{a.title}.</strong> {a.detail}</div>)}
        </div>
      )}
      <p className="text-[11px] italic text-slate-500">{CANDIDATE_NOTICE}</p>
      {showLabButton && r.inputs && (
        <button className="btn btn-teal w-full" onClick={() => goto("lab", r.id)}>Explore in Bloom Prediction Lab</button>
      )}
    </div>
  );
}
