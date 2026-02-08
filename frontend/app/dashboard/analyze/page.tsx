'use client';

import { useRef, useEffect, useState, useMemo } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
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
  ChevronDown,
  ChevronUp,
  X,
  Maximize2,
  Search,
  Filter,
} from 'lucide-react';
import {
  analyzeSession,
  Trade,
  TradeWithAnalysis,
} from '@/lib/biasDetector';
import { getLabelIcon, BIAS_ICON_MAP } from '@/components/icons/CoachIcons';
import TemperMascot from '@/components/mascot/TemperMascot';
import {
  fetchTradeCoach,
  fetchTradeInspector,
  fetchTradesFromJob,
  generateTradeVoice,
  generateTradeCoach,
  getTradeVoiceUrl,
  getLastJobId,
} from '@/lib/backend-bridge';

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
};

type SortMode = 'chronological' | 'profit_desc' | 'profit_asc' | 'impact_desc';
type BiasFilter = 'ALL' | 'OVERTRADING' | 'REVENGE_TRADING' | 'LOSS_AVERSION';

const BIAS_RULEBOOK: Array<{ key: BiasFilter; title: string; definition: string }> = [
  {
    key: 'OVERTRADING',
    title: 'Overtrading (window/cluster)',
    definition:
      'Triggered when trade cadence clusters too tightly in rolling time windows (too many trades in too little time).',
  },
  {
    key: 'REVENGE_TRADING',
    title: 'Revenge Trading (post-loss escalation)',
    definition:
      'Triggered when risk escalates after a loss: faster re-entry and/or larger size relative to recent baseline.',
  },
  {
    key: 'LOSS_AVERSION',
    title: 'Loss Aversion (distribution imbalance)',
    definition:
      'Triggered by asymmetric payoff behavior: losses dominate wins in magnitude or discipline rules must cap downside.',
  },
];

export default function AnalyzePage() {
  const container = useRef<HTMLDivElement>(null);
  const searchParams = useSearchParams();
  const [mounted, setMounted] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [trades, setTrades] = useState<Trade[]>(demoTrades);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({ coach: true, biases: true });
  const [modalTrade, setModalTrade] = useState<TradeWithAnalysis | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [assetFilter, setAssetFilter] = useState<string>('ALL');
  const [biasFilter, setBiasFilter] = useState<BiasFilter>('ALL');
  const [labelFilter, setLabelFilter] = useState<string>('ALL');
  const [sortMode, setSortMode] = useState<SortMode>('chronological');
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [tradeCoachText, setTradeCoachText] = useState<string | null>(null);
  const [tradeCoachFix, setTradeCoachFix] = useState<string | null>(null);
  const [tradeCoachError, setTradeCoachError] = useState<string | null>(null);
  const [tradeCoachLoading, setTradeCoachLoading] = useState(false);
  const [tradeHeuristic, setTradeHeuristic] = useState<string | null>(null);
  const [tradeLesson, setTradeLesson] = useState<string | null>(null);
  const [tradeVoiceLoading, setTradeVoiceLoading] = useState(false);
  const [tradeVoicePlaying, setTradeVoicePlaying] = useState(false);
  const [tradeVoiceError, setTradeVoiceError] = useState<string | null>(null);
  const tradeVoiceRef = useRef<HTMLAudioElement | null>(null);

  const toggleSection = (key: string) =>
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));

  const stopTradeVoice = () => {
    if (tradeVoiceRef.current) {
      tradeVoiceRef.current.pause();
      tradeVoiceRef.current.currentTime = 0;
    }
    setTradeVoicePlaying(false);
  };

  const playTradeVoice = async () => {
    if (!activeJobId || !currentTrade) {
      setTradeVoiceError('Trade voice requires a completed backend job.');
      return;
    }

    setTradeVoiceLoading(true);
    setTradeVoiceError(null);
    try {
      await generateTradeVoice(activeJobId, currentTrade.index, 'elevenlabs', false);
      const audio = new Audio(`${getTradeVoiceUrl(activeJobId, currentTrade.index)}?ts=${Date.now()}`);
      audio.onended = () => setTradeVoicePlaying(false);
      audio.onerror = () => {
        setTradeVoicePlaying(false);
        setTradeVoiceError('Unable to play generated trade voice.');
      };
      stopTradeVoice();
      tradeVoiceRef.current = audio;
      await audio.play();
      setTradeVoicePlaying(true);
    } catch (error) {
      setTradeVoiceError(error instanceof Error ? error.message : 'Voice generation failed.');
      setTradeVoicePlaying(false);
    } finally {
      setTradeVoiceLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const savedSession = localStorage.getItem('temper_current_session');
    if (savedSession) {
      try {
        const parsed = JSON.parse(savedSession);
        if (Array.isArray(parsed) && parsed.length > 0) setTrades(parsed);
      } catch { /* ignore */ }
    }

    const jobId = searchParams.get('jobId') || getLastJobId();
    if (jobId) {
      setActiveJobId(jobId);
      void fetchTradesFromJob(jobId)
        .then((rows) => {
          if (cancelled) return;
          if (rows.length > 0) {
            setTrades(rows);
            localStorage.setItem('temper_current_session', JSON.stringify(rows));
          }
        })
        .catch(() => {
          // Keep existing local session fallback for UI continuity.
        });
    } else {
      setActiveJobId(null);
    }

    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  useEffect(() => () => stopTradeVoice(), []);

  const analysis = useMemo(() => analyzeSession(trades), [trades]);
  const assetOptions = useMemo(
    () => ['ALL', ...Array.from(new Set(analysis.trades.map((t) => t.asset))).sort()],
    [analysis.trades],
  );
  const labelOptions = useMemo(
    () => ['ALL', ...Array.from(new Set(analysis.trades.map((t) => t.label))).sort()],
    [analysis.trades],
  );

  const filteredIndices = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const ranked = analysis.trades
      .map((trade, index) => ({ trade, index }))
      .filter(({ trade }) => {
        if (assetFilter !== 'ALL' && trade.asset !== assetFilter) return false;
        if (biasFilter !== 'ALL' && !trade.biases.some((b) => b.type === biasFilter)) return false;
        if (labelFilter !== 'ALL' && trade.label !== labelFilter) return false;
        if (flaggedOnly && trade.biases.length === 0) return false;
        if (!query) return true;
        const haystack = [
          trade.asset,
          trade.side,
          trade.label,
          ...trade.biases.map((b) => b.type),
          ...trade.reasons,
          trade.annotation,
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(query);
      });

    if (sortMode === 'profit_desc') ranked.sort((a, b) => (b.trade.pnl ?? 0) - (a.trade.pnl ?? 0));
    if (sortMode === 'profit_asc') ranked.sort((a, b) => (a.trade.pnl ?? 0) - (b.trade.pnl ?? 0));
    if (sortMode === 'impact_desc') ranked.sort((a, b) => Math.abs(b.trade.scoreContribution) - Math.abs(a.trade.scoreContribution));

    return ranked.map((r) => r.index);
  }, [analysis.trades, assetFilter, biasFilter, flaggedOnly, labelFilter, searchQuery, sortMode]);

  const activeIndices = filteredIndices.length > 0
    ? filteredIndices
    : analysis.trades.map((_, index) => index);

  const activePositionByIndex = useMemo(() => {
    const map = new Map<number, number>();
    activeIndices.forEach((idx, pos) => map.set(idx, pos));
    return map;
  }, [activeIndices]);

  const currentFilteredPos = Math.max(0, activePositionByIndex.get(currentIndex) ?? 0);
  const currentTrade = analysis.trades[currentIndex] || analysis.trades[activeIndices[0] || 0];

  useEffect(() => {
    let cancelled = false;
    const loadTradeCoach = async () => {
      if (!activeJobId || !currentTrade) {
        setTradeCoachText(null);
        setTradeCoachFix(null);
        setTradeCoachError(null);
        setTradeCoachLoading(false);
        setTradeHeuristic(null);
        setTradeLesson(null);
        setTradeVoiceError(null);
        setTradeVoicePlaying(false);
        return;
      }

      setTradeCoachLoading(true);
      setTradeCoachError(null);
      const tradeId = currentTrade.index;
      try {
        const inspectorData = await fetchTradeInspector(activeJobId, tradeId);
        const inspectorTrade = inspectorData.trade;
        if (!cancelled && inspectorTrade && typeof inspectorTrade === 'object') {
          const tradeRecord = inspectorTrade as Record<string, unknown>;
          setTradeHeuristic(typeof tradeRecord.explanation_plain_english === 'string' ? tradeRecord.explanation_plain_english : null);
          setTradeLesson(typeof tradeRecord.lesson === 'string' ? tradeRecord.lesson : null);
        }
      } catch {
        if (!cancelled) {
          setTradeHeuristic(null);
          setTradeLesson(null);
        }
      }

      try {
        let coachData = await fetchTradeCoach(activeJobId, tradeId);
        if (!coachData.trade_coach) {
          coachData = await generateTradeCoach(activeJobId, tradeId);
        }
        if (cancelled) return;
        const tradeCoach = coachData.trade_coach as Record<string, unknown> | undefined;
        if (tradeCoach) {
          setTradeCoachText(typeof tradeCoach.llm_explanation === 'string' ? tradeCoach.llm_explanation : null);
          setTradeCoachFix(typeof tradeCoach.actionable_fix === 'string' ? tradeCoach.actionable_fix : null);
          setTradeCoachError(null);
        } else {
          setTradeCoachText(null);
          setTradeCoachFix(null);
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Trade coach unavailable';
          setTradeCoachText(null);
          setTradeCoachFix(null);
          setTradeCoachError(message);
        }
      } finally {
        if (!cancelled) setTradeCoachLoading(false);
      }
    };

    void loadTradeCoach();
    return () => {
      cancelled = true;
    };
  }, [activeJobId, currentTrade]);

  const navigateByStep = (step: number) => {
    if (activeIndices.length === 0) return;
    const pos = Math.max(0, activePositionByIndex.get(currentIndex) ?? 0);
    const nextPos = Math.min(activeIndices.length - 1, Math.max(0, pos + step));
    setCurrentIndex(activeIndices[nextPos]);
  };

  useEffect(() => {
    if (activeIndices.length === 0) return;
    if (!activeIndices.includes(currentIndex)) {
      setCurrentIndex(activeIndices[0]);
    }
  }, [activeIndices, currentIndex]);

  useEffect(() => { setMounted(true); }, []);

  /* Entrance */
  useGSAP(
    () => {
      if (!mounted) return;
      gsap.set(['.page-header', '.chart-panel', '.timeline-bar', '.analysis-panel', '.summary-cards'], { clearProps: 'all' });
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      tl.fromTo('.page-header', { y: 30, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.6 })
        .fromTo('.chart-panel', { y: 40, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.7 }, '-=0.3')
        .fromTo('.timeline-bar', { y: 20, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5 }, '-=0.3')
        .fromTo('.analysis-panel', { x: 30, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.6 }, '-=0.4')
        .fromTo('.summary-cards', { y: 20, autoAlpha: 0 }, { y: 0, autoAlpha: 1, stagger: 0.1, duration: 0.4 }, '-=0.3');
    },
    { scope: container, dependencies: [mounted] },
  );

  /* Trade nav anim */
  useGSAP(
    () => {
      if (!mounted) return;
      gsap.fromTo('.trade-detail', { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.3, ease: 'power2.out' });
    },
    { dependencies: [currentIndex, mounted] },
  );

  /* Autoplay */
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setCurrentIndex((prev) => {
        const pos = activePositionByIndex.get(prev) ?? -1;
        if (pos === -1 || pos >= activeIndices.length - 1) {
          setIsPlaying(false);
          return prev;
        }
        return activeIndices[pos + 1];
      });
    }, 2500);
    return () => clearInterval(interval);
  }, [activeIndices, activePositionByIndex, isPlaying]);

  /* Keyboard */
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') navigateByStep(1);
      else if (e.key === 'ArrowLeft') navigateByStep(-1);
      else if (e.key === ' ') { e.preventDefault(); setIsPlaying((p) => !p); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [activeIndices, currentIndex]);

  return (
    <div ref={container} className="flex h-full flex-col overflow-hidden bg-[#0a0a0a] text-white">
      {/* ── Header ── */}
      <header className="page-header flex shrink-0 items-center justify-between border-b border-white/[0.08] px-6 py-4">
        <div className="flex items-center gap-4">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-sm text-gray-400 transition-colors hover:text-white cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="h-4 w-px bg-white/10" />
          <div>
            <h1 className="font-coach text-lg font-bold text-white">Session Analysis</h1>
            <p className="text-xs text-gray-400">
              {analysis.trades.length} trades
            </p>
          </div>
        </div>

        {/* Playback */}
        <div className="flex items-center gap-3">
          <div className="mr-4 hidden text-xs text-gray-500 sm:block">
            <kbd className="rounded bg-white/[0.08] px-1.5 py-0.5 font-mono text-gray-400">←</kbd>{' '}
            <kbd className="rounded bg-white/[0.08] px-1.5 py-0.5 font-mono text-gray-400">→</kbd>{' '}
            navigate
          </div>
          <button onClick={() => setCurrentIndex(activeIndices[0] ?? 0)} className="cursor-pointer rounded-lg p-2 text-gray-400 transition-colors hover:bg-white/[0.08] hover:text-white">
            <SkipBack className="h-4 w-4" />
          </button>
          <button onClick={() => navigateByStep(-1)} disabled={activeIndices.length === 0 || currentFilteredPos === 0} className="cursor-pointer rounded-lg p-2 text-gray-400 transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <button onClick={() => setIsPlaying(!isPlaying)} className="cursor-pointer rounded-xl bg-emerald-500 p-3 text-black transition-all hover:brightness-110">
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <button onClick={() => navigateByStep(1)} disabled={activeIndices.length === 0 || currentFilteredPos >= activeIndices.length - 1} className="cursor-pointer rounded-lg p-2 text-gray-400 transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed">
            <ArrowRight className="h-4 w-4" />
          </button>
          <button onClick={() => setCurrentIndex(activeIndices[activeIndices.length - 1] ?? 0)} className="cursor-pointer rounded-lg p-2 text-gray-400 transition-colors hover:bg-white/[0.08] hover:text-white">
            <SkipForward className="h-4 w-4" />
          </button>
          <span className="ml-2 min-w-[60px] text-center font-mono text-sm text-gray-400">
            {currentFilteredPos + 1} / {activeIndices.length}
          </span>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ─── Chart + Timeline ─── */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="chart-panel flex-1 p-6">
            {mounted && (
              <EquityChart
                trades={analysis.trades}
                currentIndex={currentIndex}
                height={400}
                analysis={analysis}
              />
            )}
            <p className="mt-3 text-xs text-gray-500">
              Disciplined replay shows the same trade history under behavioral guardrails (skip, rescale, loss-cap), not a predictive strategy.
            </p>
          </div>

          {/* Timeline */}
          <div className="timeline-bar shrink-0 border-t border-white/[0.08] p-4">
            <div className="mb-3 grid grid-cols-1 gap-2 xl:grid-cols-6">
              <label className="xl:col-span-2 flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-gray-300">
                <Search className="h-3.5 w-3.5 text-gray-500" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search asset, label, bias, reason..."
                  className="w-full bg-transparent text-xs text-white placeholder:text-gray-500 outline-none"
                />
              </label>
              <select
                value={assetFilter}
                onChange={(e) => setAssetFilter(e.target.value)}
                className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-gray-200"
              >
                {assetOptions.map((asset) => (
                  <option key={asset} value={asset}>
                    Asset: {asset}
                  </option>
                ))}
              </select>
              <select
                value={biasFilter}
                onChange={(e) => setBiasFilter(e.target.value as BiasFilter)}
                className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-gray-200"
              >
                <option value="ALL">Bias: All</option>
                <option value="OVERTRADING">Bias: Overtrading</option>
                <option value="REVENGE_TRADING">Bias: Revenge Trading</option>
                <option value="LOSS_AVERSION">Bias: Loss Aversion</option>
              </select>
              <select
                value={labelFilter}
                onChange={(e) => setLabelFilter(e.target.value)}
                className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-gray-200"
              >
                {labelOptions.map((label) => (
                  <option key={label} value={label}>
                    Label: {label}
                  </option>
                ))}
              </select>
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
                className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-gray-200"
              >
                <option value="chronological">Sort: Timeline</option>
                <option value="profit_desc">Sort: Highest P/L</option>
                <option value="profit_asc">Sort: Lowest P/L</option>
                <option value="impact_desc">Sort: Highest Impact</option>
              </select>
            </div>

            <div className="mb-3 flex items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2 text-xs text-gray-400">
                <input
                  type="checkbox"
                  checked={flaggedOnly}
                  onChange={(e) => setFlaggedOnly(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-white/20 bg-transparent"
                />
                flagged trades only
              </label>
              <div className="flex items-center gap-2 text-[11px] text-gray-500">
                <Filter className="h-3.5 w-3.5" />
                showing {activeIndices.length} / {analysis.trades.length}
              </div>
            </div>

            <input
              type="range"
              min={0}
              max={Math.max(activeIndices.length - 1, 0)}
              value={currentFilteredPos}
              onChange={(e) => {
                const pos = Number(e.target.value);
                setCurrentIndex(activeIndices[pos] ?? activeIndices[0] ?? 0);
              }}
              className="mb-4 h-2 w-full cursor-pointer appearance-none rounded-lg bg-white/[0.10]"
            />

            <div className="mb-3 rounded-lg border border-white/[0.08] bg-white/[0.03] p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-500">Bias Rulebook</p>
              <div className="space-y-1.5">
                {BIAS_RULEBOOK.map((rule) => {
                  const score = analysis.biases.find((b) => b.type === rule.key)?.score ?? 0;
                  return (
                    <p key={rule.key} className="text-xs text-gray-300">
                      <span className="font-semibold text-white">{rule.title}</span>: {rule.definition}{' '}
                      <span className="text-gray-500">(score {score}/100)</span>
                    </p>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-2 overflow-x-auto pb-2" style={{ scrollbarColor: '#282828 transparent' }}>
              {(() => {
                const total = activeIndices.length;
                const WINDOW = 24;
                const start = total > WINDOW * 2 ? Math.max(0, currentFilteredPos - WINDOW) : 0;
                const end = total > WINDOW * 2 ? Math.min(total, currentFilteredPos + WINDOW + 1) : total;
                const visible = activeIndices.slice(start, end);
                return (
                  <>
                    {start > 0 && (
                      <button
                        onClick={() => setCurrentIndex(activeIndices[start - 1])}
                        className="flex-shrink-0 rounded-xl bg-white/[0.06] px-3 py-3 text-xs text-gray-400 hover:bg-white/[0.08] cursor-pointer"
                      >
                        ← {start} earlier
                      </button>
                    )}
                    {visible.map((i) => {
                      const trade = analysis.trades[i];
                      const style = labelStyles[trade.label] || labelStyles.BOOK;
                      const isActive = i === currentIndex;
                      const visiblePos = activePositionByIndex.get(i) ?? 0;
                      const isPast = visiblePos < currentFilteredPos;
                      return (
                        <button
                          key={i}
                          onClick={() => setCurrentIndex(i)}
                          className={`group relative flex-shrink-0 rounded-xl px-4 py-3 text-left transition-all cursor-pointer ${
                            isActive
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
                            {trade.side} {trade.asset} · {trade.timestamp.split(' ')[1]?.slice(0, 5)}
                          </p>
                          <div className={`mt-1 text-xs font-semibold ${(trade.pnl || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {(trade.pnl || 0) >= 0 ? '+' : ''}{trade.pnl?.toFixed(0)}
                          </div>
                        </button>
                      );
                    })}
                    {end < total && (
                      <button
                        onClick={() => setCurrentIndex(activeIndices[end])}
                        className="flex-shrink-0 rounded-xl bg-white/[0.06] px-3 py-3 text-xs text-gray-400 hover:bg-white/[0.08] cursor-pointer"
                      >
                        {total - end} later →
                      </button>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </div>

        {/* ─── Analysis Side Panel ─── */}
        <div className="analysis-panel w-80 shrink-0 overflow-y-auto overflow-x-hidden border-l border-white/[0.08] bg-[#0a0a0a]">
          <div className="p-6">
            <div className="trade-detail space-y-6">
              {/* Mascot + Label Badge */}
              <div className="flex flex-col items-center">
                <button
                  onClick={playTradeVoice}
                  disabled={tradeVoiceLoading || !activeJobId}
                  className="cursor-pointer rounded-2xl p-1 transition hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-50"
                  title="Click mascot to play coach voice"
                >
                  <TemperMascot
                    label={currentTrade.label}
                    size={100}
                    showBubble
                    animate
                  />
                </button>
                <p className="mt-1 text-[10px] text-gray-500">
                  {tradeVoiceLoading
                    ? 'Generating coach voice...'
                    : tradeVoicePlaying
                      ? 'Mascot is speaking'
                      : activeJobId
                        ? 'Click mascot for voice coach'
                        : 'Voice available after backend job upload'}
                </p>
                {tradeVoiceError && (
                  <p className="mt-1 text-center text-[10px] text-red-400">{tradeVoiceError}</p>
                )}
                <div
                  className={`mt-2 inline-flex items-center gap-2 rounded-lg px-4 py-2 ${(labelStyles[currentTrade.label] || labelStyles.BOOK).bg} ${(labelStyles[currentTrade.label] || labelStyles.BOOK).text} ring-1 ${(labelStyles[currentTrade.label] || labelStyles.BOOK).border}`}
                >
                  {(() => { const Icon = getLabelIcon(currentTrade.label); return <Icon size={20} />; })()}
                  <span className="text-sm font-bold">{currentTrade.label}</span>
                </div>
              </div>

              {/* Info Grid */}
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
                    {(currentTrade.pnl || 0) >= 0 ? '+' : ''}${(Math.trunc(Math.abs(currentTrade.pnl || 0) * 100) / 100).toFixed(2)}
                  </p>
                </div>
                <div className="rounded-xl bg-white/[0.06] p-3">
                  <p className="text-[10px] text-gray-400">Time Since Last</p>
                  <p className="text-lg font-bold text-white">
                    {currentTrade.timeSinceLast > 60
                      ? `${Math.floor(currentTrade.timeSinceLast / 60)}m`
                      : `${Math.round(currentTrade.timeSinceLast)}s`}
                  </p>
                </div>
              </div>

              {/* Biases — expandable */}
              {currentTrade.biases.length > 0 && (
                <div className="rounded-xl bg-red-400/5 ring-1 ring-red-400/20 overflow-hidden">
                  <button
                    onClick={() => toggleSection('biases')}
                    className="flex w-full cursor-pointer items-center justify-between p-4"
                  >
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-red-400" />
                      <p className="text-sm font-semibold text-red-400">
                        Bias Detected ({currentTrade.biases.length})
                      </p>
                    </div>
                    {expandedSections.biases
                      ? <ChevronUp className="h-4 w-4 text-red-400" />
                      : <ChevronDown className="h-4 w-4 text-red-400" />}
                  </button>
                  {expandedSections.biases && (
                    <div className="px-4 pb-4 space-y-2">
                      {currentTrade.biases.map((bias, i) => {
                        const BiasIcon = BIAS_ICON_MAP[bias.type];
                        return (
                          <div key={i} className="flex items-start gap-2">
                            {BiasIcon && <BiasIcon size={18} className="mt-0.5 shrink-0" />}
                            <div>
                              <p className="text-xs font-medium text-white">{bias.type.replace('_', ' ')}</p>
                              <p className="text-xs text-gray-400">{bias.description}</p>
                              {bias.recommendation && (
                                <p className="mt-1 text-[10px] text-purple-400 italic">
                                  💡 {bias.recommendation}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Coach — expandable */}
              <div className="rounded-xl bg-white/[0.04] ring-1 ring-white/[0.08] overflow-hidden">
                <button
                  onClick={() => toggleSection('coach')}
                  className="flex w-full cursor-pointer items-center justify-between p-4"
                >
                  <div className="flex items-center gap-2">
                    <Brain className="h-4 w-4 text-emerald-400" />
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                      Coach Notes
                    </p>
                  </div>
                  {expandedSections.coach
                    ? <ChevronUp className="h-4 w-4 text-gray-400" />
                    : <ChevronDown className="h-4 w-4 text-gray-400" />}
                </button>
                {expandedSections.coach && (
                  <div className="px-4 pb-4 space-y-3">
                    {tradeCoachLoading && (
                      <p className="text-xs text-gray-400">Loading deterministic trade evidence and coach...</p>
                    )}
                    <p className="text-sm leading-relaxed text-gray-300 break-words">
                      {tradeHeuristic || currentTrade.annotation}
                    </p>
                    {tradeLesson && (
                      <p className="text-xs leading-relaxed text-emerald-300 break-words">
                        {tradeLesson}
                      </p>
                    )}
                    {tradeCoachText && (
                      <p className="text-sm leading-relaxed text-cyan-200 break-words">
                        {tradeCoachText}
                      </p>
                    )}
                    {tradeCoachFix && (
                      <p className="text-xs leading-relaxed text-cyan-300 break-words">
                        Action: {tradeCoachFix}
                      </p>
                    )}
                    {tradeCoachError && (
                      <p className="text-xs leading-relaxed text-red-300 break-words">
                        Coach unavailable: {tradeCoachError}
                      </p>
                    )}
                    {/* Bullet points for reasons */}
                    {currentTrade.reasons.length > 0 && (
                      <ul className="space-y-1.5 pl-1">
                        {currentTrade.reasons.map((reason, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-gray-400">
                            <span className="mt-1 h-1 w-1 flex-shrink-0 rounded-full bg-emerald-400/60" />
                            {reason.replace(/_/g, ' ')}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="text-[10px] text-gray-500">
                      Score contribution: <span className="font-bold text-white">+{currentTrade.scoreContribution.toFixed(1)}</span>
                    </p>
                  </div>
                )}
              </div>

              {/* Full Detail button */}
              <button
                onClick={() => setModalTrade(currentTrade)}
                className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-white/[0.06] px-4 py-3 text-sm font-medium text-gray-300 ring-1 ring-white/[0.08] transition-all hover:bg-white/[0.10] hover:text-white"
              >
                <Maximize2 className="h-4 w-4" />
                Full Detail
              </button>

              {/* Running P/L */}
              <div className="rounded-xl bg-white/[0.06] p-4">
                <p className="text-[10px] text-gray-400">Session P/L at this point</p>
                <p className={`text-2xl font-bold ${currentTrade.sessionPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {currentTrade.sessionPnL >= 0 ? '+' : ''}${currentTrade.sessionPnL.toFixed(0)}
                </p>
              </div>
            </div>

            {/* Session Summary */}
            {currentIndex === analysis.trades.length - 1 && (
              <div className="summary-cards mt-8 space-y-4 border-t border-white/[0.08] pt-6">
                <h3 className="text-sm font-semibold text-white">Session Summary</h3>

                {/* Psychological P&L → Disciplined Replay */}
                <div className="rounded-xl bg-white/[0.06] p-4 ring-1 ring-white/[0.08]">
                  <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                    Disciplined Replay
                  </p>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-400">Actual P&L</span>
                      <span className={`font-mono font-bold ${analysis.summary.totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {analysis.summary.totalPnL >= 0 ? '+' : '-'}${Math.abs(analysis.summary.totalPnL).toFixed(0)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-400">Trades Filtered</span>
                      <span className="font-mono font-bold text-orange-400">
                        {analysis.report.disciplinedReplay.tradesRemoved}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-400">Disciplined P&L</span>
                      <span className={`font-mono font-bold ${analysis.psychologicalPnL.strategyPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {analysis.psychologicalPnL.strategyPnL >= 0 ? '+' : '-'}${Math.abs(analysis.psychologicalPnL.strategyPnL).toFixed(0)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between border-t border-white/[0.08] pt-2">
                      <span className="text-sm font-medium text-white">Savings</span>
                      <span className={`font-mono font-bold ${analysis.report.disciplinedReplay.savings >= 0 ? 'text-purple-400' : 'text-red-400'}`}>
                        {analysis.report.disciplinedReplay.savings >= 0 ? '+' : ''}${analysis.report.disciplinedReplay.savings.toFixed(0)}
                      </span>
                    </div>
                  </div>
                  {analysis.report.disciplinedReplay.tradesRemoved > 0 && (
                    <p className="mt-3 text-xs italic text-gray-400">
                      {analysis.report.disciplinedReplay.savings >= 0 ? 'Following discipline rules would have saved you' : 'Net impact of rule enforcement'}:{' '}
                      <span className="font-bold text-purple-400">
                        ${Math.abs(analysis.report.disciplinedReplay.savings).toFixed(0)}
                      </span>
                    </p>
                  )}
                </div>

                {/* Bias Score Bars */}
                {analysis.biases.length > 0 && (
                  <div className="rounded-xl bg-white/[0.06] p-4 ring-1 ring-white/[0.08]">
                    <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                      Bias Scores
                    </p>
                    <div className="space-y-2.5">
                      {analysis.biases.map((bias, i) => (
                        <div key={i}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-gray-400">{bias.type.replace(/_/g, ' ')}</span>
                            <span className="text-xs font-bold text-white">{bias.score}/100</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-white/[0.06]">
                            <div
                              className={`h-full rounded-full transition-all ${
                                bias.score >= 70 ? 'bg-red-400' : bias.score >= 40 ? 'bg-orange-400' : 'bg-yellow-400'
                              }`}
                              style={{ width: `${bias.score}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  <div className="flex items-center justify-between rounded-xl bg-emerald-400/10 p-3">
                    <div className="flex items-center gap-2">
                      <TemperMascot
                        label={
                          analysis.disciplineScore >= 80
                            ? 'BRILLIANT'
                            : analysis.disciplineScore >= 70
                              ? 'EXCELLENT'
                              : analysis.disciplineScore >= 60
                                ? 'GOOD'
                                : analysis.disciplineScore >= 50
                                  ? 'BOOK'
                                  : analysis.disciplineScore >= 40
                                    ? 'INACCURACY'
                                    : analysis.disciplineScore >= 25
                                      ? 'MISTAKE'
                                      : 'BLUNDER'
                        }
                        size={32}
                        animate={false}
                      />
                      <span className="text-sm text-gray-400">Discipline Score</span>
                    </div>
                    <span className="text-lg font-bold text-emerald-400">{analysis.disciplineScore}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-white/[0.06] p-3">
                    <span className="text-sm text-gray-400">Win Rate</span>
                    <span className="text-lg font-bold text-white">{analysis.summary.winRate.toFixed(0)}%</span>
                  </div>
                </div>

                {analysis.recommendations.length > 0 && (
                  <div className="mt-4">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                      Personalized Recommendations
                    </p>
                    <ul className="space-y-2">
                      {analysis.recommendations.slice(0, 6).map((rec, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs text-gray-300">
                          <Zap className="mt-0.5 h-3 w-3 flex-shrink-0 text-yellow-400" />
                          {rec}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Coach Summary */}
                {analysis.coachResponse?.daySummary && (
                  <div className="mt-4 rounded-xl bg-purple-400/[0.06] p-3 ring-1 ring-purple-400/10">
                    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-purple-400/60">
                      AI Coach Summary
                    </p>
                    <p className="text-xs leading-relaxed text-gray-300">
                      {analysis.coachResponse.daySummary}
                    </p>
                    {analysis.coachResponse.closingMessage && (
                      <p className="mt-2 text-xs italic text-purple-400/80">
                        {analysis.coachResponse.closingMessage}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ Glassmorphism Detail Modal ═══ */}
      {modalTrade && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setModalTrade(null)}
        >
          <div
            className="detail-modal relative mx-4 max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-white/[0.12] bg-white/[0.06] p-8 shadow-2xl ring-1 ring-white/[0.08] backdrop-blur-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close */}
            <button
              onClick={() => setModalTrade(null)}
              className="absolute right-4 top-4 cursor-pointer rounded-xl p-2 text-gray-400 transition-colors hover:bg-white/[0.08] hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>

            {/* Mascot + Label */}
            <div className="flex flex-col items-center mb-6">
              <TemperMascot label={modalTrade.label} size={90} showBubble animate />
              <div className={`mt-3 inline-flex items-center gap-2 rounded-xl px-5 py-2.5 ${(labelStyles[modalTrade.label] || labelStyles.BOOK).bg} ${(labelStyles[modalTrade.label] || labelStyles.BOOK).text} ring-1 ${(labelStyles[modalTrade.label] || labelStyles.BOOK).border}`}>
                {(() => { const Icon = getLabelIcon(modalTrade.label); return <Icon size={22} />; })()}
                <span className="text-base font-bold">{modalTrade.label}</span>
              </div>
            </div>

            {/* Trade Info Grid */}
            <div className="grid grid-cols-2 gap-3 mb-6">
              <div className="rounded-xl bg-white/[0.06] p-4">
                <p className="text-[10px] text-gray-400 uppercase tracking-wider">Asset</p>
                <p className="text-xl font-bold text-white">{modalTrade.asset}</p>
              </div>
              <div className="rounded-xl bg-white/[0.06] p-4">
                <p className="text-[10px] text-gray-400 uppercase tracking-wider">Side</p>
                <p className={`text-xl font-bold ${modalTrade.side === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>
                  {modalTrade.side}
                </p>
              </div>
              <div className="rounded-xl bg-white/[0.06] p-4">
                <p className="text-[10px] text-gray-400 uppercase tracking-wider">P/L</p>
                <p className={`text-xl font-bold ${(modalTrade.pnl || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {(modalTrade.pnl || 0) >= 0 ? '+' : ''}${(Math.trunc(Math.abs(modalTrade.pnl || 0) * 100) / 100).toFixed(2)}
                </p>
              </div>
              <div className="rounded-xl bg-white/[0.06] p-4">
                <p className="text-[10px] text-gray-400 uppercase tracking-wider">Session P/L</p>
                <p className={`text-xl font-bold ${modalTrade.sessionPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {modalTrade.sessionPnL >= 0 ? '+' : ''}${modalTrade.sessionPnL.toFixed(0)}
                </p>
              </div>
              <div className="rounded-xl bg-white/[0.06] p-4">
                <p className="text-[10px] text-gray-400 uppercase tracking-wider">Timestamp</p>
                <p className="text-sm font-medium text-gray-300">{modalTrade.timestamp}</p>
              </div>
              <div className="rounded-xl bg-white/[0.06] p-4">
                <p className="text-[10px] text-gray-400 uppercase tracking-wider">Time Since Last</p>
                <p className="text-sm font-medium text-white">
                  {modalTrade.timeSinceLast > 60
                    ? `${Math.floor(modalTrade.timeSinceLast / 60)}m ${Math.round(modalTrade.timeSinceLast % 60)}s`
                    : `${Math.round(modalTrade.timeSinceLast)}s`}
                </p>
              </div>
              <div className="rounded-xl bg-white/[0.06] p-4">
                <p className="text-[10px] text-gray-400 uppercase tracking-wider">Drawdown</p>
                <p className="text-sm font-medium text-white">{modalTrade.drawdownFromPeak.toFixed(2)}</p>
              </div>
              <div className="rounded-xl bg-white/[0.06] p-4">
                <p className="text-[10px] text-gray-400 uppercase tracking-wider">Size vs Baseline</p>
                <p className="text-sm font-medium text-white">{modalTrade.sizeRelativeToBaseline.toFixed(2)}×</p>
              </div>
            </div>

            {/* Biases Detail */}
            {modalTrade.biases.length > 0 && (
              <div className="mb-6 rounded-xl bg-red-400/5 p-5 ring-1 ring-red-400/20">
                <div className="mb-3 flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-red-400" />
                  <p className="text-sm font-bold text-red-400">Behavioral Biases</p>
                </div>
                <div className="space-y-3">
                  {modalTrade.biases.map((bias, i) => {
                    const BiasIcon = BIAS_ICON_MAP[bias.type];
                    return (
                      <div key={i} className="rounded-lg bg-white/[0.04] p-3">
                        <div className="flex items-start gap-2">
                          {BiasIcon && <BiasIcon size={20} className="mt-0.5 shrink-0" />}
                          <div className="flex-1">
                            <div className="flex items-center justify-between">
                              <p className="text-sm font-semibold text-white">{bias.type.replace(/_/g, ' ')}</p>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                                bias.severity === 'CRITICAL' ? 'bg-red-500/20 text-red-400'
                                  : bias.severity === 'HIGH' ? 'bg-orange-500/20 text-orange-400'
                                  : bias.severity === 'MEDIUM' ? 'bg-yellow-500/20 text-yellow-400'
                                  : 'bg-gray-500/20 text-gray-400'
                              }`}>{bias.severity}</span>
                            </div>
                            <p className="mt-1 text-xs text-gray-400 leading-relaxed">{bias.description}</p>
                            {bias.recommendation && (
                              <p className="mt-2 text-xs text-purple-400">💡 {bias.recommendation}</p>
                            )}
                            <div className="mt-2 flex items-center gap-3">
                              <span className="text-[10px] text-gray-500">Confidence: {bias.confidence}%</span>
                              <span className="text-[10px] text-gray-500">Score: {bias.score}/100</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Coach Analysis */}
            <div className="mb-6 rounded-xl bg-emerald-400/[0.04] p-5 ring-1 ring-emerald-400/10">
              <div className="mb-3 flex items-center gap-2">
                <Brain className="h-5 w-5 text-emerald-400" />
                <p className="text-sm font-bold text-emerald-400">Coach Analysis</p>
              </div>
              <p className="text-sm leading-relaxed text-gray-300">{modalTrade.annotation}</p>
              {modalTrade.reasons.length > 0 && (
                <div className="mt-4 space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Decision Factors</p>
                  <ul className="space-y-1.5">
                    {modalTrade.reasons.map((reason, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-gray-400">
                        <Zap className="mt-0.5 h-3 w-3 flex-shrink-0 text-yellow-400" />
                        {reason.replace(/_/g, ' ')}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="mt-4 flex items-center gap-4 text-[10px] text-gray-500">
                <span>Score contribution: <span className="font-bold text-white">+{modalTrade.scoreContribution.toFixed(1)}</span></span>
                <span>Symbol: <span className="font-bold text-white">{modalTrade.labelSymbol}</span></span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
