// Risk classification and recommended actions. Thresholds are illustrative prototype settings.
export const LEVELS = ["Low", "Moderate", "High", "Critical"];
export const RISK_COLORS = { Low: "#3ecf8e", Moderate: "#f2c14e", High: "#ee7a1c", Critical: "#ff5c6c" };
export const DEFAULT_THRESHOLDS = { moderate: 0.2, high: 0.4, critical: 0.7 };

export function classify(p, th) {
  if (p === null || p === undefined || Number.isNaN(p)) return "Unknown";
  if (p >= th.critical) return "Critical";
  if (p >= th.high) return "High";
  if (p >= th.moderate) return "Moderate";
  return "Low";
}
export const levelIndex = (l) => LEVELS.indexOf(l);

export const ACTIONS = {
  Low: "Routine monitoring",
  Moderate: "Review local conditions",
  High: "Increase monitoring frequency",
  Critical: "Prioritise field verification and consider an official alert",
};

export const CANDIDATE_NOTICE = "Model-generated early-warning candidate. Not an officially issued environmental warning.";
