'use client';

import { AlertTriangle, Zap, TrendingDown } from 'lucide-react';

/* ── Glass insight strip — appears below the terminal ── */

const LABELS = [
  { label: 'Brilliant', color: '#22d3ee', bg: 'rgba(34,211,238,0.08)', symbol: '!!' },
  { label: 'Good', color: '#4ade80', bg: 'rgba(74,222,128,0.08)', symbol: '✓' },
  { label: 'Inaccuracy', color: '#facc15', bg: 'rgba(250,204,21,0.08)', symbol: '?' },
  { label: 'Mistake', color: '#fb923c', bg: 'rgba(251,146,60,0.08)', symbol: '??' },
  { label: 'Blunder', color: '#ef4444', bg: 'rgba(239,68,68,0.08)', symbol: '??' },
];

export function AnalysisLabelsStrip() {
  return (
    <div className="analysis-labels pointer-events-none flex flex-wrap items-center justify-center gap-2.5 py-3">
      {LABELS.map(({ label, color, bg, symbol }) => (
        <div
          key={label}
          className="flex items-center gap-1.5 rounded-full border px-3 py-1"
          style={{ borderColor: `${color}30`, background: bg }}
        >
          <span className="text-[11px] font-bold" style={{ color }}>{symbol}</span>
          <span className="text-[11px] font-medium" style={{ color }}>{label}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Compact bias badges that appear in the glass insight panel ── */
export function InsightPanel() {
  return (
    <div className="insight-panel flex flex-col gap-3 sm:flex-row sm:gap-4">
      <div className="flex flex-1 items-start gap-3 rounded-xl border border-red-500/15 bg-red-500/[0.04] px-4 py-3 backdrop-blur-md">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-400/80" />
        <div>
          <p className="text-[11px] font-semibold text-red-400">Revenge Sequence</p>
          <p className="mt-0.5 text-[10px] leading-snug text-red-300/50">3 rapid entries after a loss</p>
        </div>
      </div>
      <div className="flex flex-1 items-start gap-3 rounded-xl border border-orange-500/15 bg-orange-500/[0.04] px-4 py-3 backdrop-blur-md">
        <Zap className="mt-0.5 h-4 w-4 flex-shrink-0 text-orange-400/80" />
        <div>
          <p className="text-[11px] font-semibold text-orange-400">Overtrading</p>
          <p className="mt-0.5 text-[10px] leading-snug text-orange-300/50">47 trades — 82% above baseline</p>
        </div>
      </div>
      <div className="flex flex-1 items-start gap-3 rounded-xl border border-purple-500/15 bg-purple-500/[0.04] px-4 py-3 backdrop-blur-md">
        <TrendingDown className="mt-0.5 h-4 w-4 flex-shrink-0 text-purple-400/80" />
        <div>
          <p className="text-[11px] font-semibold text-purple-400">Drawdown Alert</p>
          <p className="mt-0.5 text-[10px] leading-snug text-purple-300/50">−$1,245 from peak equity</p>
        </div>
      </div>
    </div>
  );
}

/* ── Temper gauge score — inspired by the logo (arc + pawn) ── */
export function TemperGauge({ score = 38 }: { score?: number }) {
  // The gauge is a 180° arc from -90° (left) to +90° (right)
  const radius = 54;
  const cx = 64;
  const cy = 64;
  const circumference = Math.PI * radius; // half-circle
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const filled = circumference * pct;

  // Needle angle: -90° (score 0) to +90° (score 100)
  const needleAngle = -90 + pct * 180;

  // Color based on score
  const gaugeColor =
    score >= 70 ? '#06D6A0' : score >= 45 ? '#F59E0B' : '#EF476F';

  return (
    <div className="temper-gauge pointer-events-none flex flex-col items-center">
      <svg width="128" height="80" viewBox="0 0 128 80" className="overflow-visible">
        {/* Background arc */}
        <path
          d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth="8"
          strokeLinecap="round"
        />
        {/* Filled arc */}
        <path
          d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
          fill="none"
          stroke={gaugeColor}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
          style={{ filter: `drop-shadow(0 0 6px ${gaugeColor}40)` }}
        />
        {/* Needle */}
        <g transform={`rotate(${needleAngle} ${cx} ${cy})`}>
          <line
            x1={cx}
            y1={cy}
            x2={cx}
            y2={cy - radius + 12}
            stroke="white"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <circle cx={cx} cy={cy} r="4" fill="white" />
        </g>
        {/* Pawn silhouette at center */}
        <g transform={`translate(${cx - 6}, ${cy - 16})`} opacity="0.15">
          <path d="M6 0a3 3 0 110 6 3 3 0 010-6zm-2 7h4l1 5H3l1-5zm-2 6h8v2H2v-2z" fill="white" />
        </g>
      </svg>
      <p className="mt-1 text-4xl font-bold text-white">{score}</p>
      <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: gaugeColor }}>
        {score >= 70 ? 'Disciplined' : score >= 45 ? 'Caution' : 'Tilt Detected'}
      </p>
    </div>
  );
}

