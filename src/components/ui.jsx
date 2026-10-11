// Small shared UI pieces. Plain components, no abstraction layers.
import { RISK_COLORS } from "../lib/risk.js";

export const LAKE_COLORS = { Superior: "#6f8fd9", Michigan: "#5aa9e6", Huron: "#35d0c4", Erie: "#a98bff", Ontario: "#d4a95a" };
export const AXIS = { fontSize: 11, fill: "#9aa4c4" };

export function Card({ title, subtitle, right, children, className = "" }) {
  return (
    <section className={`card p-4 ${className}`}>
      {(title || right) && (
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            {title && <h3 className="card-title">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Kpi({ label, value, sub, accent }) {
  return (
    <div className="card px-4 py-3" style={accent ? { borderLeft: `4px solid ${accent}` } : {}}>
      <div className="label">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-ink">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export function RiskBadge({ level }) {
  const color = RISK_COLORS[level] || "#8c95b3";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: color + "1f", color }}>
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {level}
    </span>
  );
}

export function SimBadge({ children = "SIMULATED DATA" }) {
  return <span className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-bold tracking-wider text-amber-800">{children}</span>;
}

export function EstimatedTag() {
  return <span className="rounded border border-sky-300 bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800">ESTIMATED</span>;
}
export function ObservedTag() {
  return <span className="rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">OBSERVED</span>;
}

export function Note({ tone = "info", title, children }) {
  const tones = {
    info: "border-sky-200 bg-sky-50 text-sky-900",
    warn: "border-amber-300 bg-amber-50 text-amber-900",
    danger: "border-red-200 bg-red-50 text-red-900",
  };
  return (
    <div className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${tones[tone]}`}>
      {title && <strong className="mr-1">{title}</strong>}
      {children}
    </div>
  );
}

export function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-0.5 block text-[11px] text-slate-500">{hint}</span>}
    </label>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-slate-200">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${value === t.id ? "border-teal-600 text-ink" : "border-transparent text-slate-500 hover:text-ink"}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function PageHeader({ title, subtitle, right }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-ink">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-slate-600">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function ProbBar({ p, color }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded bg-slate-100">
      <div className="h-full rounded" style={{ width: `${Math.round((p ?? 0) * 100)}%`, background: color }} />
    </div>
  );
}

export function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
      {Object.entries(RISK_COLORS).map(([k, c]) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />
          {k}
        </span>
      ))}
    </div>
  );
}

export function Empty({ children }) {
  return <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">{children}</div>;
}
