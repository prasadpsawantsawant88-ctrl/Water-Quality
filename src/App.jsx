import { Component, Suspense, lazy, useMemo, useState } from "react";
import { AppContext } from "./state.jsx";
import { DATES, DEFAULT_DATE, addDays } from "./lib/data.js";
import { DEFAULT_SETTINGS, runAnalysis, compareRuns, buildAlerts, historicalProbabilities } from "./lib/analysis.js";
import { SimBadge } from "./components/ui.jsx";
const Overview = lazy(() => import("./pages/Overview.jsx"));
const GeoExplorer = lazy(() => import("./pages/GeoExplorer.jsx"));
const Analytics = lazy(() => import("./pages/Analytics.jsx"));
const PredictionLab = lazy(() => import("./pages/PredictionLab.jsx"));
const Unmonitored = lazy(() => import("./pages/Unmonitored.jsx"));
const EarlyWarning = lazy(() => import("./pages/EarlyWarning.jsx"));
const ModelPerformance = lazy(() => import("./pages/ModelPerformance.jsx"));
const DataExplorer = lazy(() => import("./pages/DataExplorer.jsx"));
const Methodology = lazy(() => import("./pages/Methodology.jsx"));
const SpatialStats = lazy(() => import("./pages/SpatialStats.jsx"));
import { assessUnmonitored, DEFAULT_INT_CFG } from "./lib/integration.js";
const AhpRisk = lazy(() => import("./pages/AhpRisk.jsx"));
import { DEFAULT_AHP, solveAhp } from "./lib/ahp.js";
const SpatialInterpolation = lazy(() => import("./pages/SpatialInterpolation.jsx"));

// group = sidebar section heading
const PAGES = [
  { id: "overview", label: "Executive Overview", group: "Core surveillance", view: Overview },
  { id: "geo", label: "Geographic Risk Explorer", group: "Core surveillance", view: GeoExplorer },
  { id: "analytics", label: "Water Quality Analytics", group: "Core surveillance", view: Analytics },
  { id: "spatial", label: "Spatial Statistics", group: "Spatial analysis", view: SpatialStats },
  { id: "interp", label: "Spatial Interpolation", group: "Spatial analysis", view: SpatialInterpolation },
  { id: "ahp", label: "AHP Risk Assessment", group: "Risk & modelling", view: AhpRisk },
  { id: "lab", label: "Bloom Prediction Lab", group: "Risk & modelling", view: PredictionLab },
  { id: "unmonitored", label: "Unmonitored Area Intelligence", group: "Risk & modelling", view: Unmonitored },
  { id: "warning", label: "Early-Warning Center", group: "Operations", view: EarlyWarning },
  { id: "models", label: "Model Performance", group: "Operations", view: ModelPerformance },
  { id: "data", label: "Data Explorer", group: "Data & governance", view: DataExplorer },
  { id: "method", label: "Methodology & Assumptions", group: "Data & governance", view: Methodology },
];

// A page that throws shows a message instead of a blank screen; the rest of the app keeps working.
class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidUpdate(prev) { if (prev.pageId !== this.props.pageId && this.state.error) this.setState({ error: null }); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card mx-auto mt-10 max-w-xl p-6 text-sm">
        <h2 className="mb-2 text-base font-semibold text-red-700">This page could not be displayed</h2>
        <p className="text-slate-600">Something went wrong while calculating or drawing it. Other pages are unaffected; try another page or change the analysis run.</p>
        <pre className="mono mt-3 overflow-auto rounded bg-white/5 p-2 text-xs text-slate-500">{String(this.state.error.message || this.state.error)}</pre>
        <button className="btn mt-4" onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    );
  }
}
const Loading = () => <div className="p-10 text-center text-sm text-slate-500" role="status">Loading page…</div>;

const RUN_DATES = DATES.slice(3).reverse(); // newest first; the first dates have no earlier run to compare with
const MODEL_LABELS = { lr: "Logistic regression", rf: "Random forest", avg: "Average of both" };

export default function App() {
  const [page, setPage] = useState("overview");
  const [dateStr, setDateStr] = useState(DEFAULT_DATE);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [selectedId, setSelectedId] = useState(null);
  const [ahpCfg, setAhpCfg] = useState(DEFAULT_AHP); // AHP judgments, normalisation ranges, score bands: shared by every page that uses AHP
  const [intCfg, setIntCfg] = useState(DEFAULT_INT_CFG); // Kriging + AHP integration settings (model, Monte Carlo draws, correlation, threshold)
  const ahp = useMemo(() => solveAhp(ahpCfg.judgments, ahpCfg.crThreshold), [ahpCfg.judgments, ahpCfg.crThreshold]);

  // current and previous prediction runs, recomputed whenever the date or any setting changes
  const { run, prevRun } = useMemo(() => {
    const cur = runAnalysis(dateStr, settings);
    const prev = runAnalysis(addDays(dateStr, -14), settings);
    compareRuns(cur, prev, settings);
    return { run: cur, prevRun: prev };
  }, [dateStr, settings]);
  const integration = useMemo(() => assessUnmonitored(dateStr, ahp, ahpCfg, intCfg), [dateStr, ahp, ahpCfg, intCfg]);
  const alerts = useMemo(() => buildAlerts(run, settings, integration), [run, settings, integration]);
  const history = useMemo(() => historicalProbabilities(settings.model), [settings.model]);

  const goto = (pageId, locationId) => {
    if (locationId) setSelectedId(locationId);
    setPage(pageId);
    window.scrollTo({ top: 0 });
  };

  const ctx = { page, setPage, dateStr, setDateStr, settings, setSettings, run, prevRun, alerts, history, selectedId, setSelectedId, goto, ahpCfg, setAhpCfg, ahp, intCfg, setIntCfg, integration };
  const Current = PAGES.find((p) => p.id === page).view;

  return (
    <AppContext.Provider value={ctx}>
      <div className="flex min-h-screen">
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-y-auto border-r border-white/[0.07] bg-navy-950/70 px-3 py-5 backdrop-blur md:flex">
          <div className="flex items-center gap-3 px-2 pb-5">
            <img src="/logo.png" alt="" className="h-10 w-10 rounded-xl object-cover" />
            <div>
              <div className="text-sm font-bold leading-tight tracking-wide text-ink">GL-WQI</div>
              <div className="text-[10px] leading-tight text-slate-400">Great Lakes Water Quality Intelligence</div>
            </div>
          </div>
          <div className="mx-2 mb-4 flex items-center justify-between rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] text-slate-600">
            <span className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-teal-brand" />Simulated telemetry</span>
            <span className="mono text-[10px] text-teal-brand">DEMO</span>
          </div>
          <nav className="flex-1">
            {PAGES.map((p, i) => (
              <div key={p.id}>
                {(i === 0 || PAGES[i - 1].group !== p.group) && <div className="mb-1.5 mt-4 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{p.group}</div>}
                <button
                  onClick={() => goto(p.id)}
                  className={`mb-0.5 flex w-full items-center justify-between rounded-full px-3.5 py-2 text-left text-[13px] transition ${page === p.id ? "bg-[#f4f2ff] font-semibold text-[#1a1340]" : "text-slate-600 hover:bg-white/[0.06]"}`}
                >
                  {p.label}
                  {page === p.id && <span className="h-1.5 w-1.5 rounded-full bg-[#7c5cf0]" />}
                </button>
              </div>
            ))}
          </nav>
          <div className="mt-4 px-3 text-[10px] leading-relaxed text-slate-400">
            Prototype. All observations and model outputs are simulated. Risk levels are model-generated candidates, not official warnings.
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-[1000] border-b border-white/[0.07] bg-[#0a0d1a]/85 px-4 py-2.5 backdrop-blur">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <select className="select md:hidden" value={page} onChange={(e) => goto(e.target.value)}>
                {PAGES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              <SimBadge />
              <label className="flex items-center gap-2 text-xs text-slate-600">
                Analysis run
                <select className="select" value={dateStr} onChange={(e) => setDateStr(e.target.value)}>
                  {RUN_DATES.map((d) => <option key={d} value={d}>{d}{d === DEFAULT_DATE ? " (reference peak-season run)" : ""}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                Risk model
                <select className="select" value={settings.model} onChange={(e) => setSettings({ ...settings, model: e.target.value })}>
                  {Object.entries(MODEL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <span className="text-xs text-slate-500">Early-warning configuration: predicts the next sample (about 14 days ahead) from the latest available data</span>
            </div>
          </header>
          <main className="mx-auto max-w-[1400px] p-4 md:p-6">
            <ErrorBoundary pageId={page}><Suspense fallback={<Loading />}><Current /></Suspense></ErrorBoundary>
          </main>
        </div>
      </div>
    </AppContext.Provider>
  );
}
