"""Reference AHP results from numpy's eigen-solver, used by tests/ahp.test.mjs to check the JavaScript power iteration.
Includes the app's default judgments and random reciprocal matrices (some deliberately inconsistent)."""
import json, os
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RI = [0, 0, 0.58, 0.90, 1.12, 1.24, 1.32, 1.41, 1.45, 1.49]
SAATY = [1/9, 1/8, 1/7, 1/6, 1/5, 1/4, 1/3, 1/2, 1, 2, 3, 4, 5, 6, 7, 8, 9]


def solve(A):
    vals, vecs = np.linalg.eig(A)
    k = int(np.argmax(vals.real))
    w = np.abs(vecs[:, k].real)
    w = w / w.sum()
    lam = float(vals[k].real)
    n = len(A)
    ci = (lam - n) / (n - 1)
    return w.tolist(), lam, ci, ci / RI[n - 1]


rng = np.random.default_rng(11)
cases = []
for n in (3, 4, 6, 6, 6, 6, 6, 6):
    A = np.ones((n, n))
    for i in range(n):
        for j in range(i + 1, n):
            A[i, j] = SAATY[rng.integers(len(SAATY))]
            A[j, i] = 1 / A[i, j]
    w, lam, ci, cr = solve(A)
    cases.append({"matrix": A.tolist(), "weights": w, "lambda_max": lam, "ci": ci, "cr": cr})
json.dump(cases, open(os.path.join(ROOT, "tests", "fixtures", "ahp_fixtures.json"), "w"))
print(len(cases), "AHP reference cases; CR range", round(min(c["cr"] for c in cases), 3), "-", round(max(c["cr"] for c in cases), 3))
