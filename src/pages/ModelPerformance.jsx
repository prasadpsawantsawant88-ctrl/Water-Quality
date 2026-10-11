import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend as RLegend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine, ComposedChart, Scatter } from "recharts";
import { useApp } from "../state.jsx";
import { Card, Field, Note, PageHeader, AXIS } from "../components/ui.jsx";
import { RESULTS, MODELS } from "../lib/data.js";
import { confusionAt, fmt, rocCurve } from "../lib/stats.js";
import { lrLogit } from "../lib/model.js";
import { KRIGING } from "../lib/kriging.js";
import BLOOM_VALID from "../data/bloom_validation.json";
import { INDICATORS } from "../lib/spatialData.js";

export default function ModelPerformance() {
  const [cfg, setCfg] = useState("early");
  const [thr, setThr] = useState(0.4);
  const M = RESULTS.metrics[cfg];
  const meta = RESULTS.meta;
  const preds = RESULTS.test_predictions;
  const y = preds.map((p) => p.y);
  const pLR = preds.map((p) => p[`${cfg}_lr`]);
  const pRF = preds.map((p) => p[`${cfg}_rf`]);
  const rocL = useMemo(() => rocCurve(y, pLR), [cfg]);
  const rocR = useMemo(() => rocCurve(y, pRF), [cfg]);
  const cl = confusionAt(y, pLR, thr);
  const cr = confusionAt(y, pRF, thr);

  const roc = useMemo(() => {
    const grid = Array.from({ length: 101 }, (_, i) => i / 100);
    const at = (pts, f) => { let t = 0; pts.forEach((p) => { if (p.fpr <= f) t = p.tpr; }); return t; };
    return grid.map((f) => ({ fpr: f, Logistic: at(rocL.points, f), "Random forest": at(rocR.points, f), Chance: f }));
  }, [rocL, rocR]);

  // calibration: observed frequency per predicted-probability bin
  const calib = (p) => Array.from({ length: 10 }, (_, b) => {
    const idx = p.map((v, i) => (v >= b / 10 && (v < (b + 1) / 10 || (b === 9 && v <= 1)) ? i : -1)).filter((i) => i >= 0);
    return { mid: b / 10 + 0.05, obs: idx.length >= 8 ? (idx.reduce((s, i) => s + y[i], 0) / idx.length) * 100 : null, n: idx.length };
  });
  const cLR = calib(pLR);
  const cRF = calib(pRF);
  const calData = cLR.map((c, i) => ({ mid: c.mid * 100, Logistic: c.obs, "Random forest": cRF[i].obs, Ideal: c.mid * 100 }));

  // predicted probability distribution split by observed outcome
  const dist = Array.from({ length: 10 }, (_, b) => {
    const sel = (cls) => pLR.filter((v, i) => y[i] === cls && v >= b / 10 && (v < (b + 1) / 10 || b === 9)).length;
    return { bin: `${b * 10}-${(b + 1) * 10}%`, "No bloom": sel(0), "Bloom observed": sel(1) };
  });

  const impEarly = MODELS[cfg].rf_permutation_importance_test;
  const impData = Object.entries(impEarly).map(([k, v]) => ({ name: k, perm: v, gini: MODELS[cfg].rf_impurity_importance[k] })).sort((a, b) => b.perm - a.perm);
  const lr = MODELS[cfg].lr;
  const coefRows = lr.features.map((f, i) => ({ f, std: lr.coef_std[i], or: lr.odds_ratio_per_sd[i], raw: lr.coef_raw[i] }));
  const names = { lnTP: "ln(Total phosphorus)", lnChl: "ln(Chlorophyll-a)", Temp: "Water temperature", Rain: "Rainfall", Rain2: "Rainfall²", DO: "Dissolved oxygen", Spring: "Season: Spring", Summer: "Season: Summer", Autumn: "Season: Autumn" };

  const a = (m) => M.holdout[m];
  const better = Math.abs(a("lr").auc - a("rf").auc) < 0.01 ? "The two models are within 0.01 AUC of each other on this holdout; the results do not support calling either one better." : a("lr").auc > a("rf").auc ? `Logistic regression scores higher AUC by ${(a("lr").auc - a("rf").auc).toFixed(3)} on this holdout.` : `Random forest scores higher AUC by ${(a("rf").auc - a("lr").auc).toFixed(3)} on this holdout.`;

  const ConfMat = ({ c, title }) => (
    <div>
      <div className="label mb-1">{title}</div>
      <table className="w-full text-center text-xs"><thead><tr><th /><th className="th text-center">Pred. no bloom</th><th className="th text-center">Pred. bloom</th></tr></thead>
        <tbody>
          <tr><td className="td text-left font-medium">Actual no bloom</td><td className="td" style={{ background: "rgba(62,207,142,0.18)" }}>{c.tn}</td><td className="td" style={{ background: "rgba(255,92,108,0.16)" }}>{c.fp}</td></tr>
          <tr><td className="td text-left font-medium">Actual bloom</td><td className="td" style={{ background: "rgba(255,92,108,0.16)" }}>{c.fn}</td><td className="td" style={{ background: "rgba(62,207,142,0.18)" }}>{c.tp}</td></tr>
        </tbody></table>
      <div className="mt-1 text-xs text-slate-600">Precision {fmt(c.precision, 2)} · Recall {fmt(c.recall, 2)} · F1 {fmt(c.f1, 2)}</div>
    </div>
  );

  return (
    <div>
      <PageHeader title="Model Performance" subtitle={`Trained on ${meta.train_period[0]} to ${meta.train_period[1]} (${meta.n_train.toLocaleString()} rows), tested on ${meta.test_period[0]} to ${meta.test_period[1]} (${meta.n_test.toLocaleString()} rows, ${(meta.test_bloom_rate * 100).toFixed(1)}% blooms). Simulated data.`}
        right={<Field label="Configuration"><select className="select" value={cfg} onChange={(e) => setCfg(e.target.value)}><option value="early">Early warning (previous-sample inputs)</option><option value="nowcast">Nowcast (same-time inputs, leakage-prone)</option></select></Field>} />

      {cfg === "nowcast" ? (
        <Note tone="danger" title="Target leakage.">In this configuration chlorophyll-a is measured at the same time as the bloom label, and chlorophyll-a rises during a bloom. The near-perfect scores below say that blooms are visible in same-time chlorophyll-a, not that blooms can be forecast. Use the early-warning configuration for operational claims.</Note>
      ) : (
        <Note tone="info" title="Early-warning configuration.">Each prediction uses only the previous sample (14 to 42 days earlier) and the season of the predicted date. It is the honest forecasting setup, so its scores are lower than the nowcast.</Note>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card title="Holdout test (chronological split)" subtitle={better}>
          <table className="w-full"><thead><tr><th className="th">Metric</th><th className="th">Logistic</th><th className="th">Random forest</th></tr></thead>
            <tbody>
              {[["ROC-AUC", "auc"], ["Brier score (lower is better)", "brier"]].map(([l, k]) => <tr key={k}><td className="td">{l}</td><td className="td font-semibold">{fmt(a("lr")[k], 3)}</td><td className="td font-semibold">{fmt(a("rf")[k], 3)}</td></tr>)}
              {[["Precision", "precision"], ["Recall", "recall"], ["F1-score", "f1"]].map(([l, k]) => <tr key={k}><td className="td">{l} at {(thr * 100).toFixed(0)}% cut-off</td><td className="td">{fmt(cl[k], 3)}</td><td className="td">{fmt(cr[k], 3)}</td></tr>)}
            </tbody></table>
          <div className="mt-3"><Field label={`Classification cut-off: ${(thr * 100).toFixed(0)}% (precision, recall, F1 and confusion matrices update)`}><input type="range" min="0.1" max="0.9" step="0.05" value={thr} onChange={(e) => setThr(+e.target.value)} className="w-full" /></Field></div>
          <div className="mt-3 grid grid-cols-2 gap-4"><ConfMat c={cl} title="Logistic" /><ConfMat c={cr} title="Random forest" /></div>
        </Card>
        <Card title="Station-aware vs random cross-validation (ROC-AUC)" subtitle="5 folds over all years. Station-aware folds keep every station's rows together, so the model is tested on stations it has never seen.">
          <table className="w-full"><thead><tr><th className="th">Validation</th><th className="th">Logistic</th><th className="th">Random forest</th></tr></thead>
            <tbody>
              {[["Station-aware (GroupKFold)", "station_aware"], ["Random rows (optimistic)", "random"]].map(([l, k]) => <tr key={k}><td className="td">{l}</td><td className="td">{fmt(M.cv[k].lr.mean, 3)} <span className="text-slate-400">± {fmt(M.cv[k].lr.sd, 3)}</span></td><td className="td">{fmt(M.cv[k].rf.mean, 3)} <span className="text-slate-400">± {fmt(M.cv[k].rf.sd, 3)}</span></td></tr>)}
            </tbody></table>
          <p className="mt-3 text-xs leading-relaxed text-slate-600">Random folds put the same station in both training and test data, which lets a model lean on station identity. The station-aware score is the more cautious estimate of performance at a new location, and is the one that matters for unmonitored areas. The chronological holdout above tests forecasting into later years.</p>
          <div className="mt-3"><Note>Simulation caveat: the lakes were generated from one set of equations, so a model that recovers them will transfer well between stations. Real stations differ in ways this simulation does not capture, so expect larger gaps on real data.</Note></div>
        </Card>
        <Card title="ROC curves (holdout)" subtitle={`AUC: logistic ${fmt(rocL.auc, 3)} · random forest ${fmt(rocR.auc, 3)}`}>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={roc}><CartesianGrid stroke="rgba(255,255,255,0.08)" /><XAxis dataKey="fpr" type="number" domain={[0, 1]} tick={AXIS} label={{ value: "False positive rate", position: "insideBottom", offset: -3, fontSize: 11 }} /><YAxis domain={[0, 1]} tick={AXIS} label={{ value: "True positive rate", angle: -90, position: "insideLeft", fontSize: 11 }} /><Tooltip formatter={(v) => v.toFixed(2)} /><RLegend wrapperStyle={{ fontSize: 12 }} />
              <Line dataKey="Logistic" stroke="#5aa9e6" dot={false} strokeWidth={2.5} /><Line dataKey="Random forest" stroke="#35d0c4" dot={false} strokeWidth={2.5} /><Line dataKey="Chance" stroke="#8c95b3" dot={false} strokeDasharray="4 4" /></LineChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Calibration (holdout)" subtitle="When a model says 40%, do about 40% of cases bloom? Bins with fewer than 8 cases are omitted.">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={calData}><CartesianGrid stroke="rgba(255,255,255,0.08)" /><XAxis dataKey="mid" type="number" domain={[0, 100]} unit="%" tick={AXIS} label={{ value: "Predicted probability", position: "insideBottom", offset: -3, fontSize: 11 }} /><YAxis domain={[0, 100]} unit="%" tick={AXIS} label={{ value: "Observed frequency", angle: -90, position: "insideLeft", fontSize: 11 }} /><Tooltip formatter={(v) => (v === null ? "n/a" : `${v.toFixed(1)}%`)} /><RLegend wrapperStyle={{ fontSize: 12 }} />
              <Line dataKey="Ideal" stroke="#8c95b3" strokeDasharray="4 4" dot={false} /><Line dataKey="Logistic" stroke="#5aa9e6" strokeWidth={2.5} connectNulls /><Line dataKey="Random forest" stroke="#35d0c4" strokeWidth={2.5} connectNulls /></LineChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Predicted probability: observed vs predicted outcomes" subtitle="Logistic regression, holdout. Good separation puts blooms on the right.">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={dist}><CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} /><XAxis dataKey="bin" tick={{ ...AXIS, fontSize: 9 }} /><YAxis tick={AXIS} /><Tooltip /><RLegend wrapperStyle={{ fontSize: 12 }} /><Bar dataKey="No bloom" stackId="a" fill="#7d89ad" /><Bar dataKey="Bloom observed" stackId="a" fill="#a98bff" /></BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Random forest feature importance" subtitle="Permutation importance on the holdout: drop in AUC when a variable group is shuffled. Impurity importance (training) shown for comparison.">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={impData} layout="vertical" margin={{ left: 30 }}><CartesianGrid stroke="rgba(255,255,255,0.08)" horizontal={false} /><XAxis type="number" tick={AXIS} /><YAxis type="category" dataKey="name" tick={AXIS} width={120} /><Tooltip formatter={(v) => v.toFixed(3)} /><RLegend wrapperStyle={{ fontSize: 12 }} /><Bar dataKey="perm" name="Permutation (ΔAUC)" fill="#35d0c4" /><Bar dataKey="gini" name="Impurity (share)" fill="#6b7494" /></BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card className="mt-4" title="Logistic regression coefficients" subtitle="Fitted by regularised maximum likelihood (L2, C = 1) on the training period. Standardised inputs; odds ratio is per one standard deviation of the input (seasonal dummies: versus Winter).">
        <div className="overflow-x-auto"><table className="w-full"><thead><tr><th className="th">Term</th><th className="th">Std. coefficient (β)</th><th className="th">Odds ratio</th><th className="th">Raw-unit coefficient</th><th className="th">Direction</th></tr></thead>
          <tbody>{coefRows.map((c) => <tr key={c.f}><td className="td">{names[c.f]}</td><td className="td">{fmt(c.std, 3)}</td><td className="td">{fmt(c.or, 2)}</td><td className="td">{fmt(c.raw, 4)}</td><td className="td text-xs">{c.std > 0 ? "Raises probability" : "Lowers probability"}</td></tr>)}
            <tr><td className="td">Intercept (standardised)</td><td className="td">{fmt(lr.intercept_std, 3)}</td><td className="td" colSpan={3} /></tr></tbody></table></div>
        <p className="mt-2 text-xs text-slate-600">Rainfall enters with a linear and a squared term, so its effect can rise and then flatten or fall; read the two coefficients together rather than separately. Correlated inputs (phosphorus and chlorophyll-a) share credit, so individual coefficients should not be read as isolated causal effects.</p>
      </Card>

      <Card className="mt-4" title="Ordinary Kriging validation (separate from the bloom model)" subtitle={`Leave-one-station-out, ${KRIGING.meta.n_cases} station-dates in 2024-2025, variograms fitted on 2018-2023 only. Errors are on the analysis scale (log for TP, Chl-a, nitrate, turbidity).`}>
        <div className="overflow-x-auto"><table className="w-full"><thead><tr>{["Indicator", "Best model (CV)", "ME", "MAE", "RMSE", "IDW RMSE", "Lake-mean RMSE", "RMSSE", "95% coverage"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody>{Object.keys(KRIGING.cv).map((k) => { const b = KRIGING.cv[k][KRIGING.best_by_cv[k]]; return (
            <tr key={k}><td className="td">{INDICATORS[k].label}</td><td className="td">{KRIGING.best_by_cv[k]}</td><td className="td">{fmt(b.me, 3)}</td><td className="td">{fmt(b.mae, 3)}</td><td className="td">{fmt(b.rmse, 3)}</td><td className="td">{fmt(KRIGING.cv[k].baselines.idw_rmse, 3)}</td><td className="td">{fmt(KRIGING.cv[k].baselines.lake_mean_rmse, 3)}</td><td className="td">{fmt(b.rmsse, 2)}</td><td className="td">{(b.coverage95 * 100).toFixed(0)}%</td></tr>); })}</tbody></table></div>
        <p className="mt-2 text-xs text-slate-600">
          Bloom model fed with hidden-station inputs ({KRIGING.bloom_with_kriged_inputs.n_cases} next-sample cases), AUC: own measurements {fmt(KRIGING.bloom_with_kriged_inputs.own.auc, 3)}, Kriged {fmt(KRIGING.bloom_with_kriged_inputs.krige.auc, 3)}, IDW {fmt(KRIGING.bloom_with_kriged_inputs.idw.auc, 3)}, lake mean {fmt(KRIGING.bloom_with_kriged_inputs.lake_mean.auc, 3)}. Interpolated inputs cost about {fmt(KRIGING.bloom_with_kriged_inputs.own.auc - KRIGING.bloom_with_kriged_inputs.krige.auc, 2)} AUC relative to measuring at the location, and Kriging is only marginally better than IDW with 6-7 stations per lake.
        </p>
      </Card>

      <Card className="mt-4" title="Bloom model calibration and validation (separate from Kriging and AHP)" subtitle={`Early-warning configuration, trained 2018-2023, holdout 2024-2025 (${BLOOM_VALID.meta.n} samples, ${(BLOOM_VALID.meta.bloom_rate * 100).toFixed(1)}% blooms). Inputs are the previous sample only, so nothing from the target date leaks in.`}>
        <div className="overflow-x-auto"><table className="w-full"><thead><tr>{["Model", "AUC", "Brier", "Brier skill vs base rate", "Log loss", "Calibration intercept", "Calibration slope", "ECE (10 bins)"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody>{[["lr", "Logistic regression (used for the bloom probability)"], ["rf", "Random forest"]].map(([k, n]) => { const m = BLOOM_VALID.models[k]; return (
            <tr key={k}><td className="td">{n}</td><td className="td">{fmt(m.auc, 3)}</td><td className="td">{fmt(m.brier, 3)}</td><td className="td">{fmt(m.brier_skill_vs_base_rate, 2)}</td><td className="td">{fmt(m.log_loss, 3)}</td><td className="td">{fmt(m.calibration_intercept, 2)}</td><td className="td">{fmt(m.calibration_slope, 2)}</td><td className="td">{fmt(m.ece, 3)}</td></tr>); })}</tbody></table></div>
        <p className="mt-2 text-xs text-slate-600">
          Calibration slope near 1 and intercept near 0 mean the stated probabilities are about right (a slope above 1 means slightly under-confident). Station-aware cross-validation AUC (whole stations held out) is {fmt(BLOOM_VALID.station_aware_cv_auc.lr, 3)} for logistic regression against {fmt(BLOOM_VALID.random_cv_auc.lr, 3)} with random folds; random folds are optimistic because neighbouring samples of one station resemble each other, so the station-aware figure is the one to quote. Kriging concentrations, AHP scores and bloom probabilities are three different quantities and are validated separately.
        </p>
      </Card>
    </div>
  );
}
