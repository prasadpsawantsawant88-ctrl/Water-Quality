// Checks that the browser-side model code (src/lib/model.js) reproduces scikit-learn's probabilities.
import fs from "node:fs";
const results = JSON.parse(fs.readFileSync(new URL("../src/data/model_results.json", import.meta.url)));
const fixtures = JSON.parse(fs.readFileSync(new URL("./parity_fixtures.json", import.meta.url)));

function lr(cfg, x) {
  const m = results.models[cfg].lr;
  let z = m.intercept_std;
  x.forEach((v, i) => (z += m.coef_std[i] * ((v - m.mu[i]) / m.sd[i])));
  return 1 / (1 + Math.exp(-z));
}
function rf(cfg, x) {
  const trees = results.models[cfg].rf.trees;
  let s = 0;
  trees.forEach((t) => {
    let n = 0;
    while (t.l[n] !== -1) n = x[t.f[n]] <= t.t[n] ? t.l[n] : t.r[n];
    s += t.v[n];
  });
  return s / trees.length;
}
let maxLR = 0, maxRF = 0;
fixtures.forEach((f) => {
  maxLR = Math.max(maxLR, Math.abs(lr("early", f.early_lr_x) - f.early_lr), Math.abs(lr("nowcast", f.now_lr_x) - f.now_lr));
  maxRF = Math.max(maxRF, Math.abs(rf("early", f.early_rf_x) - f.early_rf), Math.abs(rf("nowcast", f.now_rf_x) - f.now_rf));
});
console.log(`max |JS - sklearn|  logistic: ${maxLR.toExponential(2)}   random forest: ${maxRF.toExponential(2)}`);
if (maxLR > 1e-6 || maxRF > 2e-3) { console.error("PARITY FAILED"); process.exit(1); }
console.log("PARITY OK");
