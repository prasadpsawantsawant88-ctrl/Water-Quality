import { RISK_COLORS, classify } from "../lib/risk.js";

// Semi-circle probability gauge. Band colours follow the current thresholds.
export default function Gauge({ p, thresholds, size = 240 }) {
  const cx = size / 2;
  const cy = size / 2 + 6;
  const r = size / 2 - 18;
  const pt = (frac, radius = r) => {
    const a = Math.PI * (1 - frac);
    return [cx + radius * Math.cos(a), cy - radius * Math.sin(a)];
  };
  const arc = (f0, f1) => {
    const [x0, y0] = pt(f0);
    const [x1, y1] = pt(f1);
    return `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`;
  };
  const bands = [
    [0, thresholds.moderate, RISK_COLORS.Low],
    [thresholds.moderate, thresholds.high, RISK_COLORS.Moderate],
    [thresholds.high, thresholds.critical, RISK_COLORS.High],
    [thresholds.critical, 1, RISK_COLORS.Critical],
  ];
  const [nx, ny] = pt(Math.min(Math.max(p, 0), 1), r - 8);
  const level = classify(p, thresholds);
  return (
    <svg viewBox={`0 0 ${size} ${size / 2 + 40}`} width="100%" style={{ maxWidth: size }} role="img" aria-label={`Bloom probability ${(p * 100).toFixed(0)} percent, ${level}`}>
      {bands.map(([a, b, c], i) => (
        <path key={i} d={arc(a, b)} stroke={c} strokeWidth="14" fill="none" />
      ))}
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="#eef0fb" strokeWidth="3" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="6" fill="#eef0fb" />
      <text x={cx} y={cy + 28} textAnchor="middle" fontSize="22" fontWeight="700" fill="#eef0fb">{(p * 100).toFixed(0)}%</text>
      <text x={cx - r} y={cy + 14} textAnchor="middle" fontSize="9" fill="#9aa4c4">0</text>
      <text x={cx + r} y={cy + 14} textAnchor="middle" fontSize="9" fill="#9aa4c4">100</text>
    </svg>
  );
}
