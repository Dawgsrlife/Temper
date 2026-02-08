'use client';

import { useRef, useEffect, useState, useMemo } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  ArrowLeft,
  ArrowRight,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Brain,
  AlertTriangle,
  Zap,
  Target,
} from 'lucide-react';
import {
  analyzeSession,
  Trade,
  TradeWithAnalysis,
  SessionAnalysis,
  TRADER_PROFILES,
  TraderProfile,
} from '@/lib/biasDetector';

const EquityChart = dynamic(() => import('@/components/EquityChart'), {
  ssr: false,
});

/* Demo data */
const demoTrades: Trade[] = [
  { timestamp: '2025-03-01 09:30:00', asset: 'AAPL', side: 'BUY', quantity: 100, pnl: 45 },
  { timestamp: '2025-03-01 09:35:00', asset: 'AAPL', side: 'SELL', quantity: 100, pnl: -120 },
  { timestamp: '2025-03-01 09:36:30', asset: 'AAPL', side: 'BUY', quantity: 200, pnl: -85 },
  { timestamp: '2025-03-01 09:37:15', asset: 'AAPL', side: 'SELL', quantity: 200, pnl: -210 },
  { timestamp: '2025-03-01 09:38:00', asset: 'AAPL', side: 'BUY', quantity: 400, pnl: -320 },
  { timestamp: '2025-03-01 09:45:00', asset: 'AAPL', side: 'SELL', quantity: 400, pnl: 180 },
  { timestamp: '2025-03-01 10:15:00', asset: 'MSFT', side: 'BUY', quantity: 50, pnl: 95 },
  { timestamp: '2025-03-01 10:45:00', asset: 'MSFT', side: 'SELL', quantity: 50, pnl: 120 },
  { timestamp: '2025-03-01 11:00:00', asset: 'NVDA', side: 'BUY', quantity: 30, pnl: -55 },
  { timestamp: '2025-03-01 11:02:00', asset: 'NVDA', side: 'BUY', quantity: 50, pnl: -180 },
  { timestamp: '2025-03-01 11:03:30', asset: 'NVDA', side: 'SELL', quantity: 80, pnl: 220 },
  { timestamp: '2025-03-01 14:00:00', asset: 'AAPL', side: 'BUY', quantity: 100, pnl: 85 },
];

const labelStyles: Record<
  TradeWithAnalysis['label'],
  { bg: string; text: string; border: string }
> = {
  BRILLIANT: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', border: 'ring-emerald-500/30' },
  EXCELLENT: { bg: 'bg-emerald-400/15', text: 'text-emerald-400', border: 'ring-emerald-400/25' },
  GOOD: { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'ring-blue-500/30' },
  NEUTRAL: { bg: 'bg-gray-500/20', text: 'text-gray-400', border: 'ring-gray-500/30' },
  INACCURACY: { bg: 'bg-yellow-400/20', text: 'text-yellow-400', border: 'ring-yellow-400/30' },
  MISTAKE: { bg: 'bg-orange-400/20', text: 'text-orange-400', border: 'ring-orange-400/30' },
  BLUNDER: { bg: 'bg-red-400/20', text: 'text-red-400', border: 'ring-red-400/30' },
};

export default function AnalyzePage() {
  const container = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [trades, setTrades] = useState<Trade[]>(demoTrades);

  useEffect(() => {
    const savedSession = localStorage.getItem('temper_current_session');
    if (savedSession) {
      try {
        const parsed = JSON.parse(savedSession);
        if (Array.isArray(parsed) && parsed.length > 0) setTrades(parsed);
      } catch { /* ignore */ }
    }
  }, []);

  const analysis = useMemo(() => analyzeSession(trades), [trades]);
  const currentTrade = analysis.trades[currentIndex];

  useEffect(() => { setMounted(true); }, []);

  /* Entrance */
  useGSAP(
    () => {
      if (!mounted) return;
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      tl.from('.page-header', { y: 30, opacity: 0, duration: 0.6 })
        .from('.chart-panel', { y: 40, opacity: 0, duration: 0.7 }, '-=0.3')
        .from('.timeline-bar', { y: 20, opacity: 0, duration: 0.5 }, '-=0.3')
        .from('.analysis-panel', { x: 30, opacity: 0, duration: 0.6 }, '-=0.4')
        .from('.summary-cards', { y: 20, opacity: 0, stagger: 0.1, duration: 0.4 }, '-=0.3');
    },
    { scope: container, dependencies: [mounted] },
  );

  /* Trade nav anim */
  useGSAP(
    () => {
      if (!mounted) return;
      gsap.from('.trade-detail', { opacity: 0, y: 10, duration: 0.3, ease: 'power2.out' });
    },
    { dependencies: [currentIndex, mounted] },
  );

  /* Autoplay */
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setCurrentIndex((prev) => {
        if (prev >= analysis.trades.length - 1) { setIsPlaying(false); return prev; }
        return prev + 1;
      });
    }, 2500);
    return () => clearInterval(interval);
  }, [isPlaying, analysis.trades.length]);

  /* Keyboard */
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setCurrentIndex((p) => Math.min(p + 1, analysis.trades.length - 1));
      else if (e.key === 'ArrowLeft') setCurrentIndex((p) => Math.max(p - 1, 0));
      else if (e.key === ' ') { e.preventDefault(); setIsPlaying((p) => !p); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [analysis.trades.length]);

  return (
    <div ref={container} className="flex h-[calc(100vh-3.5rem)] flex-col bg-[#0a0a0a] text-white md:h-screen">
      {/* ── Header ── */}
      <header className="page-header flex items-center justify-between border-b border-white/[0.06] px-6 py-4">
        <div className="flex items-center gap-4">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-sm text-gray-500 transition-colors hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="h-4 w-px bg-white/10" />
          <div>
            <h1 className="font-coach text-lg font-bold text-white">Session Analysis</h1>
            <p className="text-xs text-gray-500">
              {analysis.trades.length} trades
            </p>
          </div>
        </div>

        {/* Playback */}
        <div className="flex items-center gap-3">
          <div className="mr-4 hidden text-xs text-gray-600 sm:block">
            <kbd className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-gray-400">←</kbd>{' '}
            <kbd className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-gray-400">→</kbd>{' '}
            navigate
          </div>
          <button onClick={() => setCurrentIndex(0)} className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-white/[0.06] hover:text-white">
            <SkipBack className="h-4 w-4" />
          </button>
          <button onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))} disabled={currentIndex === 0} className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-30">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <button onClick={() => setIsPlaying(!isPlaying)} className="rounded-xl bg-emerald-500 p-3 text-black transition-all hover:brightness-110">
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <button onClick={() => setCurrentIndex(Math.min(analysis.trades.length - 1, currentIndex + 1))} disabled={currentIndex >= analysis.trades.length - 1} className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-30">
            <ArrowRight className="h-4 w-4" />
          </button>
          <button onClick={() => setCurrentIndex(analysis.trades.length - 1)} className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-white/[0.06] hover:text-white">
            <SkipForward className="h-4 w-4" />
          </button>
          <span className="ml-2 min-w-[60px] text-center font-mono text-sm text-gray-500">
            {currentIndex + 1} / {analysis.trades.length}
          </span>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ─── Chart + Timeline ─── */}
        <div className="flex flex-1 flex-col">
          <div className="chart-panel flex-1 p-6">
            {mounted && (
              <EquityChart
                trades={analysis.trades.slice(0, currentIndex + 1)}
                currentIndex={currentIndex}
                height={400}
              />
            )}
          </div>

          {/* Timeline */}
          <div className="timeline-bar border-t border-white/[0.06] p-4">
            <div className="flex gap-2 overflow-x-auto pb-2" style={{ scrollbarColor: '#282828 transparent' }}>
              {analysis.trades.map((trade, i) => {
                const style = labelStyles[trade.label];
                const isActive = i === currentIndex;
                const isPast = i < currentIndex;
                return (
                  <button
                    key={i}
                    onClick={() => setCurrentIndex(i)}
                    className={`group relative flex-shrink-0 rounded-xl px-4 py-3 text-left transition-all ${
                      isActive
                        ? `${style.bg} ring-2 ${style.border}`
                        : isPast
                          ? 'bg-white/[0.06]'
                          : 'bg-white/[0.03] opacity-60 hover:opacity-100'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold ${isActive ? style.text : 'text-white'}`}>
                        {trade.label}
                      </span>
                      {trade.biases.length > 0 && (
                        <AlertTriangle className="h-3 w-3 text-orange-400" />
                      )}
                    </div>
                    <p className="mt-1 text-[10px] text-gray-500">
                      {trade.side} {trade.asset} · {trade.timestamp.split(' ')[1]?.slice(0, 5)}
                    </p>
                    <div className={`mt-1 text-xs font-semibold ${(trade.pnl || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {(trade.pnl || 0) >= 0 ? '+' : ''}{trade.pnl?.toFixed(0)}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ─── Analysis Side Panel ─── */}
        <div className="analysis-panel w-96 shrink-0 overflow-y-auto border-l border-white/[0.06] bg-[#0a0a0a]">
          <div className="p-6">
            <div className="trade-detail space-y-6">
              {/* Label Badge */}
              <div>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                  Trade Rating
                </p>
                <div
                  className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 ${labelStyles[currentTrade.label].bg} ${labelStyles[currentTrade.label].text} ring-1 ${labelStyles[currentTrade.label].border}`}
                >
                  <Target className="h-4 w-4" />
                  <span className="text-sm font-bold">{currentTrade.label}</span>
                </div>
              </div>

              {/* Info Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-white/[0.04] p-3">
                  <p className="text-[10px] text-gray-500">Asset</p>
                  <p className="text-lg font-bold text-white">{currentTrade.asset}</p>
                </div>
                <div className="rounded-xl bg-white/[0.04] p-3">
                  <p className="text-[10px] text-gray-500">Side</p>
                  <p className={`text-lg font-bold ${currentTrade.side === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {currentTrade.side}
                  </p>
                </div>
                <div className="rounded-xl bg-white/[0.04] p-3">
                  <p className="text-[10px] text-gray-500">P/L</p>
                  <p className={`text-lg font-bold ${(currentTrade.pnl || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {(currentTrade.pnl || 0) >= 0 ? '+' : ''}${Math.abs(currentTrade.pnl || 0)}
                  </p>
                </div>
                <div className="rounded-xl bg-white/[0.04] p-3">
                  <p className="text-[10px] text-gray-500">Time Since Last</p>
                  <p className="text-lg font-bold text-white">
                    {currentTrade.timeSinceLast > 60
                      ? `${Math.floor(currentTrade.timeSinceLast / 60)}m`
                      : `${Math.round(currentTrade.timeSinceLast)}s`}
                  </p>
                </div>
              </div>

              {/* Biases */}
              {currentTrade.biases.length > 0 && (
                <div className="rounded-xl bg-red-400/5 p-4 ring-1 ring-red-400/20">
                  <div className="mb-2 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-400" />
                    <p className="text-sm font-semibold text-red-400">Bias Detected</p>
                  </div>
                  {currentTrade.biases.map((bias, i) => (
                    <div key={i} className="mt-2">
                      <p className="text-xs font-medium text-white">{bias.type.replace('_', ' ')}</p>
                      <p className="mt-1 text-xs text-gray-500">{bias.description}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Coach */}
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <Brain className="h-4 w-4 text-emerald-400" />
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                    Coach Notes
                  </p>
                </div>
                <p className="text-sm leading-relaxed text-gray-300">
                  {currentTrade.annotation}
                </p>
              </div>

              {/* Running P/L */}
              <div className="rounded-xl bg-white/[0.04] p-4">
                <p className="text-[10px] text-gray-500">Session P/L at this point</p>
                <p className={`text-2xl font-bold ${currentTrade.sessionPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {currentTrade.sessionPnL >= 0 ? '+' : ''}${currentTrade.sessionPnL.toFixed(0)}
                </p>
              </div>
            </div>

            {/* Session Summary */}
            {currentIndex === analysis.trades.length - 1 && (
              <div className="summary-cards mt-8 space-y-4 border-t border-white/[0.06] pt-6">
                <h3 className="text-sm font-semibold text-white">Session Summary</h3>

                {/* Psychological P&L */}
                <div className="rounded-xl bg-white/[0.04] p-4 ring-1 ring-white/[0.06]">
                  <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                    Psychological P&L
                  </p>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-400">Strategy P&L</span>
                      <span className={`font-mono font-bold ${analysis.psychologicalPnL.strategyPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {analysis.psychologicalPnL.strategyPnL >= 0 ? '+' : '-'}${Math.abs(analysis.psychologicalPnL.strategyPnL).toFixed(0)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-400">Emotional Cost</span>
                      <span className="font-mono font-bold text-red-400">
                        -${analysis.psychologicalPnL.emotionalCost.toFixed(0)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between border-t border-white/[0.06] pt-2">
                      <span className="text-sm font-medium text-white">Potential P&L</span>
                      <span className="font-mono font-bold text-purple-400">
                        ${analysis.psychologicalPnL.potentialPnL.toFixed(0)}
                      </span>
                    </div>
                  </div>
                  {analysis.psychologicalPnL.emotionalCost > 0 && (
                    <p className="mt-3 text-xs italic text-gray-500">
                      You gave back{' '}
                      <span className="font-bold text-red-400">
                        ${analysis.psychologicalPnL.emotionalCost.toFixed(0)}
                      </span>{' '}
                      to the market due to bias.
                    </p>
                  )}
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between rounded-xl bg-emerald-400/10 p-3">
                    <span className="text-sm text-gray-400">Discipline Score</span>
                    <span className="text-lg font-bold text-emerald-400">{analysis.disciplineScore}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-white/[0.04] p-3">
                    <span className="text-sm text-gray-400">Win Rate</span>
                    <span className="text-lg font-bold text-white">{analysis.summary.winRate.toFixed(0)}%</span>
                  </div>
                </div>

                {analysis.recommendations.length > 0 && (
                  <div className="mt-4">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                      Recommendations
                    </p>
                    <ul className="space-y-2">
                      {analysis.recommendations.slice(0, 3).map((rec, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs text-gray-300">
                          <Zap className="mt-0.5 h-3 w-3 flex-shrink-0 text-yellow-400" />
                          {rec}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
