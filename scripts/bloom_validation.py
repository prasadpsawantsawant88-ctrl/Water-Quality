"""Calibration and discrimination summary of the bloom model (early-warning configuration, 2024-2025 holdout, trained on 2018-2023).
Calibration intercept and slope come from regressing the outcome on logit(p): slope 1 and intercept 0 are ideal; slope < 1 means the
model is over-confident. ECE is the mean gap between forecast and observed frequency across 10 equal-width probability bins.
Writes src/data/bloom_validation.json. The bloom model is separate from Kriging and AHP and uses no AHP score."""
import json, os
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score, brier_score_loss, log_loss

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
res = json.load(open(os.path.join(ROOT, "src", "data", "model_results.json")))
preds = res["test_predictions"]
y = np.array([p["y"] for p in preds])
out = {"meta": {"simulated": True, "holdout": res["meta"]["test_period"], "n": int(len(y)), "bloom_rate": float(y.mean()),
                "validation": "temporal holdout (train 2018-2023, test 2024-2025) plus station-aware GroupKFold on the training period; features come only from the previous sample"},
       "models": {}}
for name in ("lr", "rf"):
    p = np.clip(np.array([q[f"early_{name}"] for q in preds]), 1e-6, 1 - 1e-6)
    logit = np.log(p / (1 - p)).reshape(-1, 1)
    cal = LogisticRegression(C=1e6, max_iter=1000).fit(logit, y)
    bins = np.minimum((p * 10).astype(int), 9)
    ece = sum(abs(p[bins == b].mean() - y[bins == b].mean()) * (bins == b).sum() for b in range(10) if (bins == b).any()) / len(y)
    base = float(y.mean())
    brier = float(brier_score_loss(y, p))
    out["models"][name] = {"auc": float(roc_auc_score(y, p)), "brier": brier, "brier_skill_vs_base_rate": 1 - brier / (base * (1 - base)),
                           "log_loss": float(log_loss(y, p)), "calibration_intercept": float(cal.intercept_[0]), "calibration_slope": float(cal.coef_[0][0]), "ece": float(ece)}
out["station_aware_cv_auc"] = {k: res["metrics"]["early"]["cv"]["station_aware"][k]["mean"] for k in ("lr", "rf")}
out["random_cv_auc"] = {k: res["metrics"]["early"]["cv"]["random"][k]["mean"] for k in ("lr", "rf")}
json.dump(out, open(os.path.join(ROOT, "src", "data", "bloom_validation.json"), "w"), indent=1)
print(json.dumps(out["models"], indent=1))
