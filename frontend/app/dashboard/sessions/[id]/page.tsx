'use client';

import { useRef, useEffect, useState, useMemo, use } from 'react';
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
  Target,
  Zap,
  Download,
  Share2,
} from 'lucide-react';
import { analyzeSession, Trade, TradeWithAnalysis, SessionAnalysis, TRADER_PROFILES, TraderProfile } from '@/lib/biasDetector';

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
      pnl: Math.random() > 0.5 ? Math.random() * 50 : -Math.random() * 80,
    })),
  },
};

// Label colors
const labelStyles: Record<TradeWithAnalysis['label'], { bg: string; text: string; border: string }> = {
  BRILLIANT: { bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500/30' },
  EXCELLENT: { bg: 'bg-temper-teal/20', text: 'text-temper-teal', border: 'border-temper-teal/30' },
  GOOD: { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/30' },
  NEUTRAL: { bg: 'bg-gray-500/20', text: 'text-gray-400', border: 'border-gray-500/30' },
  INACCURACY: { bg: 'bg-temper-gold/20', text: 'text-temper-gold', border: 'border-temper-gold/30' },
  MISTAKE: { bg: 'bg-temper-orange/20', text: 'text-temper-orange', border: 'border-temper-orange/30' },
  BLUNDER: { bg: 'bg-temper-red/20', text: 'text-temper-red', border: 'border-temper-red/30' },
};

export default function SessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const sessionId = resolvedParams.id;

  const container = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const session = sessionData[sessionId] || sessionData['demo'];
  const analysis = useMemo(() => analyzeSession(session.trades), [session.trades]);
  const currentTrade = analysis.trades[currentIndex];

  useEffect(() => {
    setMounted(true);
  }, []);

  useGSAP(() => {
    if (!mounted) return;

    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
    tl.from('.page-header', { y: 30, opacity: 0, duration: 0.6 })
      .from('.chart-panel', { y: 40, opacity: 0, duration: 0.7 }, '-=0.3')
      .from('.timeline-bar', { y: 20, opacity: 0, duration: 0.5 }, '-=0.3')
      .from('.analysis-panel', { x: 30, opacity: 0, duration: 0.6 }, '-=0.4');
  }, { scope: container, dependencies: [mounted] });

  useGSAP(() => {
    if (!mounted) return;
    gsap.from('.trade-detail', {
      opacity: 0,
      y: 10,
      duration: 0.3,
      ease: 'power2.out',
    });
  }, { dependencies: [currentIndex, mounted] });

  useEffect(() => {
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
  }, [isPlaying, analysis.trades.length]);

  useEffect(() => {
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
  }, [analysis.trades.length]);

  if (!currentTrade) {
    return <div className="flex h-screen items-center justify-center text-temper-muted">Loading...</div>;
  }

  return (
    <div ref={container} className="flex h-[calc(100vh-3.5rem)] flex-col md:h-screen">
      {/* Header */}
      <header className="page-header flex items-center justify-between border-b border-temper-border/10 bg-temper-bg/80 px-6 py-4 backdrop-blur-xl">
        <div className="flex items-center gap-4">
          <Link
            href="/dashboard/sessions"
            className="flex items-center gap-2 text-sm text-temper-muted transition-colors hover:text-temper-text"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
          <div className="h-4 w-px bg-temper-border/20" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-coach text-lg font-bold text-temper-text">Session Review</h1>
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
            <p className="text-xs text-temper-muted">{analysis.trades.length} trades · Score: {analysis.disciplineScore}</p>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentIndex(0)}
            className="rounded-lg p-2 text-temper-muted transition-colors hover:bg-temper-surface hover:text-temper-text"
          >
            <SkipBack className="h-4 w-4" />
          </button>
          <button
            onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
            disabled={currentIndex === 0}
            className="rounded-lg p-2 text-temper-muted transition-colors hover:bg-temper-surface hover:text-temper-text disabled:opacity-30"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="rounded-xl bg-temper-teal p-3 text-temper-bg transition-all hover:bg-white"
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <button
            onClick={() => setCurrentIndex(Math.min(analysis.trades.length - 1, currentIndex + 1))}
            disabled={currentIndex >= analysis.trades.length - 1}
            className="rounded-lg p-2 text-temper-muted transition-colors hover:bg-temper-surface hover:text-temper-text disabled:opacity-30"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
          <button
            onClick={() => setCurrentIndex(analysis.trades.length - 1)}
            className="rounded-lg p-2 text-temper-muted transition-colors hover:bg-temper-surface hover:text-temper-text"
          >
            <SkipForward className="h-4 w-4" />
          </button>
          <span className="ml-2 min-w-[60px] text-center font-mono text-sm text-temper-muted">
            {currentIndex + 1} / {analysis.trades.length}
          </span>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Main Content */}
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
          <div className="timeline-bar border-t border-temper-border/10 bg-temper-bg/50 p-4">
            <div className="flex gap-2 overflow-x-auto pb-2">
              {analysis.trades.map((trade, i) => {
                const style = labelStyles[trade.label];
                const isActive = i === currentIndex;
                const isPast = i < currentIndex;

                return (
                  <button
                    key={i}
                    onClick={() => setCurrentIndex(i)}
                    className={`group relative flex-shrink-0 rounded-xl px-4 py-3 text-left transition-all ${isActive
                        ? `${style.bg} ring-2 ${style.border}`
                        : isPast
                          ? 'bg-temper-surface/60'
                          : 'bg-temper-surface/30 opacity-60 hover:opacity-100'
                      }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold ${isActive ? style.text : 'text-temper-text'}`}>
                        {trade.label}
                      </span>
                      {trade.biases.length > 0 && (
                        <AlertTriangle className="h-3 w-3 text-temper-orange" />
                      )}
                    </div>
                    <p className="mt-1 text-[10px] text-temper-muted">
                      {trade.side} {trade.asset}
                    </p>
                    <div className={`mt-1 text-xs font-semibold ${(trade.pnl || 0) >= 0 ? 'text-temper-teal' : 'text-temper-red'}`}>
                      {(trade.pnl || 0) >= 0 ? '+' : ''}${Math.abs(trade.pnl || 0).toFixed(0)}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Analysis Panel */}
        <div className="analysis-panel w-96 shrink-0 overflow-y-auto border-l border-temper-border/10 bg-temper-bg/80">
          <div className="p-6">
            <div className="trade-detail space-y-6">
              {/* Label Badge */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-temper-muted">Trade Rating</p>
                <div className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 ${labelStyles[currentTrade.label].bg} ${labelStyles[currentTrade.label].text} ring-1 ${labelStyles[currentTrade.label].border}`}>
                  <Target className="h-4 w-4" />
                  <span className="text-sm font-bold">{currentTrade.label}</span>
                </div>
              </div>

              {/* Trade Info */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-temper-surface/50 p-3">
                  <p className="text-xs text-temper-muted">Asset</p>
                  <p className="text-lg font-bold text-temper-text">{currentTrade.asset}</p>
                </div>
                <div className="rounded-xl bg-temper-surface/50 p-3">
                  <p className="text-xs text-temper-muted">Side</p>
                  <p className={`text-lg font-bold ${currentTrade.side === 'BUY' ? 'text-temper-teal' : 'text-temper-red'}`}>
                    {currentTrade.side}
                  </p>
                </div>
                <div className="rounded-xl bg-temper-surface/50 p-3">
                  <p className="text-xs text-temper-muted">P/L</p>
                  <p className={`text-lg font-bold ${(currentTrade.pnl || 0) >= 0 ? 'text-temper-teal' : 'text-temper-red'}`}>
                    {(currentTrade.pnl || 0) >= 0 ? '+' : ''}${Math.abs(currentTrade.pnl || 0).toFixed(0)}
                  </p>
                </div>
                <div className="rounded-xl bg-temper-surface/50 p-3">
                  <p className="text-xs text-temper-muted">Time Gap</p>
                  <p className="text-lg font-bold text-temper-text">
                    {currentTrade.timeSinceLast > 60
                      ? `${Math.floor(currentTrade.timeSinceLast / 60)}m`
                      : `${Math.round(currentTrade.timeSinceLast)}s`}
                  </p>
                </div>
              </div>

              {/* Biases */}
              {currentTrade.biases.length > 0 && (
                <div className="rounded-xl bg-temper-red/5 p-4 ring-1 ring-temper-red/20">
                  <div className="mb-2 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-temper-red" />
                    <p className="text-sm font-semibold text-temper-red">Bias Detected</p>
                  </div>
                  {currentTrade.biases.map((bias, i) => (
                    <div key={i} className="mt-2">
                      <p className="text-xs font-medium text-temper-text">{bias.type.replace('_', ' ')}</p>
                      <p className="mt-1 text-xs text-temper-muted">{bias.description}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Coach Notes */}
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <Brain className="h-4 w-4 text-temper-teal" />
                  <p className="text-xs font-semibold uppercase tracking-wider text-temper-muted">Coach Notes</p>
                </div>
                <p className="text-sm leading-relaxed text-temper-text">
                  {currentTrade.annotation}
                </p>
              </div>

              {/* Running P/L */}
              <div className="rounded-xl bg-temper-surface/50 p-4">
                <p className="text-xs text-temper-muted">Session P/L at this point</p>
                <p className={`text-2xl font-bold ${currentTrade.sessionPnL >= 0 ? 'text-temper-teal' : 'text-temper-red'}`}>
                  {currentTrade.sessionPnL >= 0 ? '+' : ''}${currentTrade.sessionPnL.toFixed(0)}
                </p>
              </div>

              {/* Summary at end */}
              {currentIndex === analysis.trades.length - 1 && (
                <div className="space-y-4 border-t border-temper-border/10 pt-6">
                  <h3 className="text-sm font-semibold text-temper-text">Session Complete</h3>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between rounded-xl bg-temper-teal/10 p-3">
                      <span className="text-sm text-temper-muted">Final Score</span>
                      <span className="text-lg font-bold text-temper-teal">{analysis.disciplineScore}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-xl bg-temper-surface/50 p-3">
                      <span className="text-sm text-temper-muted">Win Rate</span>
                      <span className="text-lg font-bold text-temper-text">{analysis.summary.winRate.toFixed(0)}%</span>
                    </div>
                  </div>

                  {analysis.recommendations.length > 0 && (
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-temper-muted">Key Takeaways</p>
                      <ul className="space-y-2">
                        {analysis.recommendations.slice(0, 3).map((rec, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-temper-text">
                            <Zap className="mt-0.5 h-3 w-3 flex-shrink-0 text-temper-gold" />
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
