'use client';

import { AlertTriangle, TrendingDown, Zap, Brain } from 'lucide-react';

/* ── Individual annotation bubbles that overlay the terminal ── */

export function RevengeAnnotation() {
  return (
    <div className="annotation-revenge pointer-events-none absolute right-6 top-16 z-30 flex max-w-[220px] items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-950/80 px-4 py-3 shadow-lg shadow-red-500/10 backdrop-blur-md">
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-400" />
      <div>
        <p className="text-[11px] font-semibold text-red-400">Revenge Trade Detected</p>
        <p className="mt-0.5 text-[10px] leading-snug text-red-300/60">
          3 rapid entries after a loss. Emotional, not strategic.
        </p>
      </div>
    </div>
  );
}

export function OvertradingAnnotation() {
  return (
    <div className="annotation-overtrade pointer-events-none absolute bottom-28 left-6 z-30 flex max-w-[210px] items-start gap-2.5 rounded-xl border border-orange-500/30 bg-orange-950/80 px-4 py-3 shadow-lg shadow-orange-500/10 backdrop-blur-md">
      <Zap className="mt-0.5 h-4 w-4 flex-shrink-0 text-orange-400" />
      <div>
        <p className="text-[11px] font-semibold text-orange-400">Overtrading Pattern</p>
        <p className="mt-0.5 text-[10px] leading-snug text-orange-300/60">
          47 trades today. 82% above your healthy baseline.
        </p>
      </div>
    </div>
  );
}

export function DrawdownAnnotation() {
  return (
    <div className="annotation-drawdown pointer-events-none absolute bottom-28 right-6 z-30 flex max-w-[200px] items-start gap-2.5 rounded-xl border border-purple-500/30 bg-purple-950/80 px-4 py-3 shadow-lg shadow-purple-500/10 backdrop-blur-md">
      <TrendingDown className="mt-0.5 h-4 w-4 flex-shrink-0 text-purple-400" />
      <div>
        <p className="text-[11px] font-semibold text-purple-400">Max Drawdown Alert</p>
        <p className="mt-0.5 text-[10px] leading-snug text-purple-300/60">
          −$1,245 from peak. Daily limit breached.
        </p>
      </div>
    </div>
  );
}

export function ScoreAnnotation() {
  return (
    <div className="annotation-score pointer-events-none absolute left-1/2 top-1/2 z-30 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2 rounded-2xl border border-emerald-500/20 bg-black/70 px-8 py-6 shadow-2xl shadow-emerald-500/10 backdrop-blur-xl">
      <Brain className="h-6 w-6 text-emerald-400" />
      <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400/70">Discipline Score</p>
      <p className="text-5xl font-bold text-white">38</p>
      <p className="text-[10px] text-red-400">Tilt detected — step away</p>
    </div>
  );
}
