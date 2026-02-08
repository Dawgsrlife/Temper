'use client';

import { useRef, useEffect, useState, useMemo, use } from 'react';
import { useRouter } from 'next/navigation';
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
} from 'lucide-react';
import { analyzeSession, Trade, TradeWithAnalysis, TRADER_PROFILES, TraderProfile } from '@/lib/biasDetector';
import { getLabelIcon, BIAS_ICON_MAP } from '@/components/icons/CoachIcons';
import TemperMascot from '@/components/mascot/TemperMascot';

const EquityChart = dynamic(() => import('@/components/EquityChart'), { ssr: false });

// Different demo data for different session types
const sessionData: Record<string, { trades: Trade[]; profile: TraderProfile }> = {
  'demo': {
    profile: 'revenge_trader',
    trades: [
      { timestamp: '2025-03-01 09:30:00', asset: 'AAPL', side: 'BUY', quantity: 100, pnl: 45 },
      { timestamp: '2025-03-01 09:35:00', asset: 'AAPL', side: 'SELL', quantity: 100, pnl: -120 },
      { timestamp: '2025-03-01 09:36:30', asset: 'AAPL', side: 'BUY', quantity: 200, pnl: -85 },
      { timestamp: '2025-03-01 09:37:15', asset: 'AAPL', side: 'SELL', quantity: 200, pnl: -210 },
      { timestamp: '2025-03-01 09:38:00', asset: 'AAPL', side: 'BUY', quantity: 400, pnl: -320 },
      { timestamp: '2025-03-01 09:45:00', asset: 'AAPL', side: 'SELL', quantity: 400, pnl: 180 },
      { timestamp: '2025-03-01 10:15:00', asset: 'MSFT', side: 'BUY', quantity: 50, pnl: 95 },
      { timestamp: '2025-03-01 10:45:00', asset: 'MSFT', side: 'SELL', quantity: 50, pnl: 120 },
    ],
  },
  'calm-1': {
    profile: 'calm_trader',
    trades: [
      { timestamp: '2025-03-01 10:00:00', asset: 'NVDA', side: 'BUY', quantity: 50, pnl: 85 },
      { timestamp: '2025-03-01 10:45:00', asset: 'NVDA', side: 'SELL', quantity: 50, pnl: 120 },
      { timestamp: '2025-03-01 11:30:00', asset: 'AAPL', side: 'BUY', quantity: 100, pnl: 95 },
      { timestamp: '2025-03-01 12:15:00', asset: 'AAPL', side: 'SELL', quantity: 100, pnl: 75 },
      { timestamp: '2025-03-01 14:00:00', asset: 'MSFT', side: 'BUY', quantity: 80, pnl: 110 },
    ],
  },
  'revenge-1': {
    profile: 'revenge_trader',
    trades: [
      { timestamp: '2025-03-01 09:30:00', asset: 'TSLA', side: 'BUY', quantity: 100, pnl: -180 },
      { timestamp: '2025-03-01 09:31:00', asset: 'TSLA', side: 'BUY', quantity: 200, pnl: -320 },
      { timestamp: '2025-03-01 09:32:00', asset: 'TSLA', side: 'BUY', quantity: 400, pnl: -520 },
      { timestamp: '2025-03-01 09:33:00', asset: 'TSLA', side: 'SELL', quantity: 700, pnl: -225 },
      { timestamp: '2025-03-01 10:00:00', asset: 'AAPL', side: 'BUY', quantity: 100, pnl: 45 },
      { timestamp: '2025-03-01 10:01:30', asset: 'AAPL', side: 'SELL', quantity: 100, pnl: -45 },
    ],
  },
  'over-1': {
    profile: 'overtrader',
    trades: Array.from({ length: 20 }, (_, i) => ({
      timestamp: `2025-03-01 ${9 + Math.floor(i / 4)}:${(i % 4) * 15}:00`.padStart(19, '0'),
      asset: ['AAPL', 'MSFT', 'NVDA', 'TSLA'][i % 4],
      side: (i % 2 === 0 ? 'BUY' : 'SELL') as 'BUY' | 'SELL',
      quantity: 50 + (i * 10),
      pnl: (i * 17 + 7) % 13 > 6 ? ((i * 17 + 7) % 50) : -((i * 23 + 3) % 80),
    })),
  },
};

// Label colors — consistent with analyze page
const labelStyles: Record<string, { bg: string; text: string; border: string }> = {
  BRILLIANT: { bg: 'bg-cyan-400/20', text: 'text-cyan-400', border: 'ring-cyan-400/30' },
  GREAT: { bg: 'bg-teal-400/20', text: 'text-teal-400', border: 'ring-teal-400/30' },
  BEST: { bg: 'bg-emerald-400/15', text: 'text-emerald-400', border: 'ring-emerald-400/25' },
  EXCELLENT: { bg: 'bg-green-400/15', text: 'text-green-400', border: 'ring-green-400/25' },
  GOOD: { bg: 'bg-green-300/15', text: 'text-green-300', border: 'ring-green-300/25' },
  BOOK: { bg: 'bg-blue-400/15', text: 'text-blue-400', border: 'ring-blue-400/25' },
  FORCED: { bg: 'bg-purple-400/15', text: 'text-purple-400', border: 'ring-purple-400/25' },
  INTERESTING: { bg: 'bg-amber-400/15', text: 'text-amber-400', border: 'ring-amber-400/25' },
  INACCURACY: { bg: 'bg-yellow-400/20', text: 'text-yellow-400', border: 'ring-yellow-400/30' },
  MISTAKE: { bg: 'bg-orange-400/20', text: 'text-orange-400', border: 'ring-orange-400/30' },
  MISS: { bg: 'bg-gray-400/10', text: 'text-gray-400', border: 'ring-gray-400/20' },
  BLUNDER: { bg: 'bg-red-400/20', text: 'text-red-400', border: 'ring-red-400/30' },
  MEGABLUNDER: { bg: 'bg-red-700/20', text: 'text-red-700', border: 'ring-red-700/30' },
  CHECKMATED: { bg: 'bg-rose-600/20', text: 'text-rose-600', border: 'ring-rose-600/30' },
  WINNER: { bg: 'bg-yellow-300/20', text: 'text-yellow-300', border: 'ring-yellow-300/30' },
  DRAW: { bg: 'bg-slate-400/10', text: 'text-slate-400', border: 'ring-slate-400/20' },
  RESIGN: { bg: 'bg-stone-500/15', text: 'text-stone-500', border: 'ring-stone-500/25' },
  TIMEOUT: { bg: 'bg-red-500/15', text: 'text-red-500', border: 'ring-red-500/25' },
  ABANDON: { bg: 'bg-zinc-500/15', text: 'text-zinc-400', border: 'ring-zinc-500/25' },
};

export default function SessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const sessionId = resolvedParams.id;
  const router = useRouter();

  const container = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const hasLocalDemoSession = Boolean(sessionData[sessionId]);
  const session = hasLocalDemoSession ? sessionData[sessionId] : null;
  const analysis = useMemo(
    () => (session ? analyzeSession(session.trades) : null),
    [session],
  );
  const currentTrade = analysis?.trades[currentIndex];

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (hasLocalDemoSession) return;
    router.replace(`/dashboard/analyze?jobId=${encodeURIComponent(sessionId)}`);
  }, [hasLocalDemoSession, router, sessionId]);

  useGSAP(() => {
    if (!mounted) return;
    gsap.set(['.page-header', '.chart-panel', '.timeline-bar', '.analysis-panel'], { clearProps: 'all' });
    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
    tl.fromTo('.page-header', { y: 30, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.6 })
      .fromTo('.chart-panel', { y: 40, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.7 }, '-=0.3')
      .fromTo('.timeline-bar', { y: 20, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5 }, '-=0.3')
      .fromTo('.analysis-panel', { x: 30, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.6 }, '-=0.4');
  }, { scope: container, dependencies: [mounted] });

  useGSAP(() => {
    if (!mounted) return;
    gsap.fromTo('.trade-detail', { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.3, ease: 'power2.out' });
  }, { dependencies: [currentIndex, mounted] });

  useEffect(() => {
    if (!analysis) return;
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setCurrentIndex(prev => {
        if (prev >= analysis.trades.length - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 2500);
    return () => clearInterval(interval);
  }, [analysis, isPlaying]);

  useEffect(() => {
    if (!analysis) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        setCurrentIndex(prev => Math.min(prev + 1, analysis.trades.length - 1));
      } else if (e.key === 'ArrowLeft') {
        setCurrentIndex(prev => Math.max(prev - 1, 0));
      } else if (e.key === ' ') {
        e.preventDefault();
        setIsPlaying(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [analysis]);

  if (!hasLocalDemoSession || !analysis || !currentTrade || !session) {
    return <div className="flex h-full items-center justify-center text-gray-400">Loading...</div>;
  }

  return (
    <div ref={container} className="flex h-full flex-col overflow-hidden bg-[#0a0a0a] text-white">
      {/* Header */}
      <header className="page-header flex shrink-0 items-center justify-between border-b border-white/[0.08] px-6 py-4">
        <div className="flex items-center gap-4">
          <Link
            href="/dashboard/sessions"
            className="flex items-center gap-2 text-sm text-gray-400 transition-colors hover:text-white cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
          <div className="h-4 w-px bg-white/10" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-coach text-lg font-bold text-white">Session Review</h1>
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                style={{
                  backgroundColor: `${TRADER_PROFILES[session.profile].color}20`,
                  color: TRADER_PROFILES[session.profile].color
                }}
              >
                {TRADER_PROFILES[session.profile].name}
              </span>
            </div>
            <p className="text-xs text-gray-400">{analysis.trades.length} trades · Score: {analysis.disciplineScore}</p>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentIndex(0)}
            className="cursor-pointer rounded-lg p-2 text-gray-400 transition-colors hover:bg-white/[0.08] hover:text-white"
          >
            <SkipBack className="h-4 w-4" />
          </button>
          <button
            onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
            disabled={currentIndex === 0}
            className="cursor-pointer rounded-lg p-2 text-gray-400 transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="cursor-pointer rounded-xl bg-emerald-500 p-3 text-black transition-all hover:brightness-110"
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <button
            onClick={() => setCurrentIndex(Math.min(analysis.trades.length - 1, currentIndex + 1))}
            disabled={currentIndex >= analysis.trades.length - 1}
            className="cursor-pointer rounded-lg p-2 text-gray-400 transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
          <button
            onClick={() => setCurrentIndex(analysis.trades.length - 1)}
            className="cursor-pointer rounded-lg p-2 text-gray-400 transition-colors hover:bg-white/[0.08] hover:text-white"
          >
            <SkipForward className="h-4 w-4" />
          </button>
          <span className="ml-2 min-w-[60px] text-center font-mono text-sm text-gray-400">
            {currentIndex + 1} / {analysis.trades.length}
          </span>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Main Content */}
        <div className="flex min-w-0 flex-1 flex-col">
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
          <div className="timeline-bar border-t border-white/[0.08] p-4">
            <div className="flex gap-2 overflow-x-auto pb-2" style={{ scrollbarColor: '#282828 transparent' }}>
              {analysis.trades.map((trade, i) => {
                const style = labelStyles[trade.label] || labelStyles.BOOK;
                const isActive = i === currentIndex;
                const isPast = i < currentIndex;

                return (
                  <button
                    key={i}
                    onClick={() => setCurrentIndex(i)}
                    className={`group relative flex-shrink-0 rounded-xl px-4 py-3 text-left transition-all cursor-pointer ${isActive
                        ? `${style.bg} ring-2 ${style.border}`
                        : isPast
                          ? 'bg-white/[0.06]'
                          : 'bg-white/[0.04] opacity-60 hover:opacity-100'
                      }`}
                  >
                    <div className="flex items-center gap-2">
                      {(() => { const Icon = getLabelIcon(trade.label); return <Icon size={16} />; })()}
                      <span className={`text-xs font-bold ${isActive ? style.text : 'text-white'}`}>
                        {trade.label}
                      </span>
                      {trade.biases.length > 0 && (
                        <AlertTriangle className="h-3 w-3 text-orange-400" />
                      )}
                    </div>
                    <p className="mt-1 text-[10px] text-gray-400">
                      {trade.side} {trade.asset}
                    </p>
                    <div className={`mt-1 text-xs font-semibold ${(trade.pnl || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {(trade.pnl || 0) >= 0 ? '+' : ''}${Math.abs(trade.pnl || 0).toFixed(0)}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Analysis Panel */}
        <div className="analysis-panel w-80 shrink-0 overflow-y-auto overflow-x-hidden border-l border-white/[0.08] bg-[#0a0a0a]">
          <div className="p-6">
            <div className="trade-detail space-y-6">
              {/* Mascot + Label Badge */}
              <div className="flex flex-col items-center">
                <TemperMascot
                  label={currentTrade.label}
                  size={100}
                  showBubble
                  animate
                />
                <div className={`mt-2 inline-flex items-center gap-2 rounded-lg px-4 py-2 ${(labelStyles[currentTrade.label] || labelStyles.BOOK).bg} ${(labelStyles[currentTrade.label] || labelStyles.BOOK).text} ring-1 ${(labelStyles[currentTrade.label] || labelStyles.BOOK).border}`}>
                  {(() => { const Icon = getLabelIcon(currentTrade.label); return <Icon size={20} />; })()}
                  <span className="text-sm font-bold">{currentTrade.label}</span>
                </div>
              </div>

              {/* Trade Info */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-white/[0.06] p-3">
                  <p className="text-[10px] text-gray-400">Asset</p>
                  <p className="text-lg font-bold text-white">{currentTrade.asset}</p>
                </div>
                <div className="rounded-xl bg-white/[0.06] p-3">
                  <p className="text-[10px] text-gray-400">Side</p>
                  <p className={`text-lg font-bold ${currentTrade.side === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {currentTrade.side}
                  </p>
                </div>
                <div className="rounded-xl bg-white/[0.06] p-3">
                  <p className="text-[10px] text-gray-400">P/L</p>
                  <p className={`text-lg font-bold ${(currentTrade.pnl || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {(currentTrade.pnl || 0) >= 0 ? '+' : ''}${Math.abs(currentTrade.pnl || 0).toFixed(0)}
                  </p>
                </div>
                <div className="rounded-xl bg-white/[0.06] p-3">
                  <p className="text-[10px] text-gray-400">Time Gap</p>
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
                  {currentTrade.biases.map((bias, i) => {
                    const BiasIcon = BIAS_ICON_MAP[bias.type];
                    return (
                      <div key={i} className="mt-2 flex items-start gap-2">
                        {BiasIcon && <BiasIcon size={18} className="mt-0.5 shrink-0" />}
                        <div>
                          <p className="text-xs font-medium text-white">{bias.type.replace('_', ' ')}</p>
                          <p className="mt-1 text-xs text-gray-400">{bias.description}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Coach Notes */}
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <Brain className="h-4 w-4 text-emerald-400" />
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Coach Notes</p>
                </div>
                <p className="text-sm leading-relaxed text-white break-words">
                  {currentTrade.annotation}
                </p>
              </div>

              {/* Running P/L */}
              <div className="rounded-xl bg-white/[0.06] p-4">
                <p className="text-[10px] text-gray-400">Session P/L at this point</p>
                <p className={`text-2xl font-bold ${currentTrade.sessionPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {currentTrade.sessionPnL >= 0 ? '+' : ''}${currentTrade.sessionPnL.toFixed(0)}
                </p>
              </div>

              {/* Summary at end */}
              {currentIndex === analysis.trades.length - 1 && (
                <div className="space-y-4 border-t border-white/[0.08] pt-6">
                  <h3 className="text-sm font-semibold text-white">Session Complete</h3>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between rounded-xl bg-emerald-400/10 p-3">
                      <span className="text-sm text-gray-400">Final Score</span>
                      <span className="text-lg font-bold text-emerald-400">{analysis.disciplineScore}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-xl bg-white/[0.06] p-3">
                      <span className="text-sm text-gray-400">Win Rate</span>
                      <span className="text-lg font-bold text-white">{analysis.summary.winRate.toFixed(0)}%</span>
                    </div>
                  </div>

                  {analysis.recommendations.length > 0 && (
                    <div>
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Key Takeaways</p>
                      <ul className="space-y-2">
                        {analysis.recommendations.slice(0, 3).map((rec, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-white">
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
    </div>
  );
}
