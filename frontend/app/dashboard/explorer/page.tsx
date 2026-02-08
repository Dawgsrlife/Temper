'use client';

import { useRef, useEffect, useState, useMemo } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  Network,
  Eye,
  Layers,
  ArrowLeft,
  RotateCcw,
  Maximize2,
  Info,
  X,
  AlertTriangle,
  TrendingUp,
  Brain,
  Zap,
} from 'lucide-react';
import {
  analyzeSession,
  Trade,
  TradeWithAnalysis,
  SessionAnalysis,
} from '@/lib/biasDetector';
import type { TradeNode } from '@/components/charts/TradeScene3D';
import type { GraphNode, GraphLink } from '@/components/charts/TradeGraph';

/* Dynamically import 3D / canvas components (no SSR) */
const TradeScene3D = dynamic(() => import('@/components/charts/TradeScene3D'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
    </div>
  ),
});
const TradeGraph = dynamic(() => import('@/components/charts/TradeGraph'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
    </div>
  ),
});

/* Demo trades ─────────────────────────────────────────────── */
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

/* ──────────────────────────────────────────────────────────── */
type ViewMode = '3d' | 'graph';

export default function ExplorerPage() {
  const container = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState<ViewMode>('3d');
  const [analysis, setAnalysis] = useState<SessionAnalysis | null>(null);
  const [selectedTrade, setSelectedTrade] = useState<TradeNode | null>(null);
  const [showInfoPanel, setShowInfoPanel] = useState(false);

  /* Load data ------------------------------------------------ */
  useEffect(() => {
    setMounted(true);

    let trades = demoTrades;
    const savedSession = localStorage.getItem('temper_current_session');
    if (savedSession) {
      try {
        const parsed: Trade[] = JSON.parse(savedSession);
        if (Array.isArray(parsed) && parsed.length > 0) trades = parsed;
      } catch {
        /* fallback to demo */
      }
    }
    setAnalysis(analyzeSession(trades));
  }, []);

  /* Entrance animation --------------------------------------- */
  useGSAP(
    () => {
      if (!mounted) return;
      gsap.set(['.explorer-header', '.mode-toggle', '.explorer-canvas', '.explorer-sidebar'], { clearProps: 'all' });
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      tl.fromTo('.explorer-header', { y: 30, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5 })
        .fromTo('.mode-toggle', { y: 20, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.4 }, '-=0.3')
        .fromTo('.explorer-canvas', { scale: 0.97, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.6 }, '-=0.3')
        .fromTo('.explorer-sidebar', { x: 30, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.5 }, '-=0.3');
    },
    { scope: container, dependencies: [mounted] },
  );

  /* Build 3D nodes from analysis ----------------------------- */
  const tradeNodes: TradeNode[] = useMemo(() => {
    if (!analysis) return [];
    return analysis.trades.map((t, i) => ({
      id: `t-${i}`,
      timestamp: t.timestamp,
      asset: t.asset,
      pnl: t.pnl ?? 0,
      sessionPnL: t.sessionPnL,
      label: t.label,
      biases: t.biases.map((b) => b.type),
      side: t.side,
      index: i,
    }));
  }, [analysis]);

  /* Build graph nodes + links -------------------------------- */
  const { graphNodes, graphLinks } = useMemo(() => {
    if (!analysis) return { graphNodes: [], graphLinks: [] };

    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];
    const assetSet = new Set<string>();
    const biasSet = new Set<string>();

    // Trade nodes
    analysis.trades.forEach((t, i) => {
      const id = `trade-${i}`;
      nodes.push({
        id,
        label: `${t.side} ${t.asset}`,
        group: 'session',
        value: Math.abs(t.pnl ?? 0) + 10,
        color: '#3b82f6',
        depth: 0,
      });

      // Consecutive links
      if (i > 0) links.push({ source: `trade-${i - 1}`, target: id });

      // Asset grouping
      if (!assetSet.has(t.asset)) {
        assetSet.add(t.asset);
        nodes.push({
          id: `asset-${t.asset}`,
          label: t.asset,
          group: 'asset',
          value: 40,
          color: '#06d6a0',
          depth: 1,
        });
      }
      links.push({ source: id, target: `asset-${t.asset}` });

      // Bias grouping
      t.biases.forEach((b) => {
        const biasId = `bias-${b.type}`;
        if (!biasSet.has(b.type)) {
          biasSet.add(b.type);
          nodes.push({
            id: biasId,
            label: b.type.replace('_', ' '),
            group: 'bias',
            value: 35,
            color: '#ef476f',
            depth: 1,
          });
        }
        links.push({ source: id, target: biasId });
      });
    });

    return { graphNodes: nodes, graphLinks: links };
  }, [analysis]);

  /* Event handlers ------------------------------------------- */
  const handleNodeClick = (trade: TradeNode) => {
    setSelectedTrade(trade);
    setShowInfoPanel(true);
    gsap.from('.info-panel-inner', { y: 15, opacity: 0, duration: 0.3, ease: 'power2.out' });
  };

  const handleGraphNodeClick = (node: GraphNode) => {
    // find matching trade if it's a trade node
    const idx = parseInt(node.id.replace('trade-', ''));
    if (!isNaN(idx) && tradeNodes[idx]) {
      setSelectedTrade(tradeNodes[idx]);
      setShowInfoPanel(true);
      gsap.from('.info-panel-inner', { y: 15, opacity: 0, duration: 0.3, ease: 'power2.out' });
    }
  };

  /* Derived stats -------------------------------------------- */
  const stats = analysis
    ? {
        totalTrades: analysis.summary.totalTrades,
        biases: analysis.biases.length,
        score: analysis.disciplineScore,
        winRate: analysis.summary.winRate,
      }
    : null;

  /* ═══════════════════════════════════════════════════════════ */
  return (
    <div
      ref={container}
      className="flex h-full flex-col overflow-hidden bg-[#0a0a0a] text-white"
    >
      {/* ── Header ── */}
      <header className="explorer-header flex shrink-0 items-center justify-between border-b border-white/[0.08] px-6 py-4">
        <div className="flex items-center gap-4">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-sm text-gray-400 transition-colors hover:text-white cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="h-4 w-px bg-white/10" />
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 ring-1 ring-emerald-400/20">
              <Network className="h-4 w-4 text-emerald-400" />
            </div>
            <div>
              <h1 className="font-coach text-lg font-bold">3D Explorer</h1>
              <p className="text-xs text-gray-400">
                {stats
                  ? `${stats.totalTrades} trades · ${stats.biases} biases · Score ${stats.score}`
                  : 'No data loaded'}
              </p>
            </div>
          </div>
        </div>

        {/* Mode toggle */}
        <div className="mode-toggle flex items-center gap-2 rounded-xl bg-white/[0.06] p-1">
          <button
            onClick={() => setMode('3d')}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-all cursor-pointer ${
              mode === '3d'
                ? 'bg-emerald-500 text-black'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            3D Scene
          </button>
          <button
            onClick={() => setMode('graph')}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-all cursor-pointer ${
              mode === 'graph'
                ? 'bg-emerald-500 text-black'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Network className="h-3.5 w-3.5" />
            Graph
          </button>
        </div>
      </header>

      {/* ── Main Area ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Canvas */}
        <div className="explorer-canvas relative min-w-0 flex-1 overflow-hidden">
          {mounted && mode === '3d' && (
            <TradeScene3D
              trades={tradeNodes}
              onNodeClick={handleNodeClick}
              className="h-full w-full"
            />
          )}
          {mounted && mode === 'graph' && (
            <TradeGraph
              nodes={graphNodes}
              links={graphLinks}
              onNodeClick={handleGraphNodeClick}
              className="h-full w-full"
            />
          )}

          {/* Floating hint */}
          {!showInfoPanel && (
            <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2">
              <div className="flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-xs text-gray-400 backdrop-blur-sm">
                <Eye className="h-3.5 w-3.5" />
                {mode === '3d'
                  ? 'Drag to orbit · Scroll to zoom · Click a node'
                  : 'Drag to pan · Scroll to zoom · Click a node'}
              </div>
            </div>
          )}
        </div>

        {/* ── Sidebar ── */}
        <aside
          className={`explorer-sidebar shrink-0 overflow-y-auto overflow-x-hidden border-l border-white/[0.08] bg-[#0a0a0a] transition-all duration-300 ${
            showInfoPanel ? 'w-80' : 'w-0'
          }`}
        >
          {showInfoPanel && selectedTrade && (
            <div className="info-panel-inner p-5 space-y-5">
              {/* Close */}
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">
                  Trade Detail
                </h3>
                <button
                  onClick={() => setShowInfoPanel(false)}
                  className="cursor-pointer rounded-lg p-1.5 text-gray-400 hover:bg-white/[0.08] hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Label */}
              <div
                className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold ring-1 ${
                  selectedTrade.label === 'BRILLIANT' || selectedTrade.label === 'EXCELLENT'
                    ? 'bg-emerald-400/10 text-emerald-400 ring-emerald-400/20'
                    : selectedTrade.label === 'BLUNDER' || selectedTrade.label === 'MISTAKE'
                      ? 'bg-red-400/10 text-red-400 ring-red-400/20'
                      : selectedTrade.label === 'INACCURACY'
                        ? 'bg-yellow-400/10 text-yellow-400 ring-yellow-400/20'
                        : 'bg-gray-400/10 text-gray-400 ring-gray-400/20'
                }`}
              >
                {selectedTrade.label}
              </div>

              {/* Info grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-white/[0.06] p-3">
                  <p className="text-[10px] text-gray-400">Asset</p>
                  <p className="text-sm font-bold text-white">
                    {selectedTrade.asset}
                  </p>
                </div>
                <div className="rounded-xl bg-white/[0.06] p-3">
                  <p className="text-[10px] text-gray-400">Side</p>
                  <p
                    className={`text-sm font-bold ${
                      selectedTrade.side === 'BUY'
                        ? 'text-emerald-400'
                        : 'text-red-400'
                    }`}
                  >
                    {selectedTrade.side}
                  </p>
                </div>
                <div className="rounded-xl bg-white/[0.06] p-3">
                  <p className="text-[10px] text-gray-400">P/L</p>
                  <p
                    className={`text-sm font-bold ${
                      selectedTrade.pnl >= 0
                        ? 'text-emerald-400'
                        : 'text-red-400'
                    }`}
                  >
                    {selectedTrade.pnl >= 0 ? '+' : ''}$
                    {Math.abs(selectedTrade.pnl).toFixed(0)}
                  </p>
                </div>
                <div className="rounded-xl bg-white/[0.06] p-3">
                  <p className="text-[10px] text-gray-400">Session P/L</p>
                  <p
                    className={`text-sm font-bold ${
                      selectedTrade.sessionPnL >= 0
                        ? 'text-emerald-400'
                        : 'text-red-400'
                    }`}
                  >
                    {selectedTrade.sessionPnL >= 0 ? '+' : ''}$
                    {Math.abs(selectedTrade.sessionPnL).toFixed(0)}
                  </p>
                </div>
              </div>

              {/* Biases */}
              {selectedTrade.biases.length > 0 && (
                <div className="rounded-xl bg-red-400/5 p-4 ring-1 ring-red-400/20">
                  <div className="mb-2 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-400" />
                    <p className="text-xs font-semibold text-red-400">
                      Bias Detected
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selectedTrade.biases.map((b, i) => (
                      <span
                        key={i}
                        className="rounded-full bg-red-400/10 px-2.5 py-1 text-[10px] font-medium text-red-400"
                      >
                        {b.replace('_', ' ')}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Timestamp */}
              <div className="rounded-xl bg-white/[0.06] p-3">
                <p className="text-[10px] text-gray-400">Timestamp</p>
                <p className="text-xs font-medium text-gray-300">
                  {selectedTrade.timestamp}
                </p>
              </div>

              {/* Quick nav */}
              <Link
                href="/dashboard/analyze"
                className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-black transition-all hover:brightness-110"
              >
                <Brain className="h-4 w-4" />
                Full Analysis
              </Link>
            </div>
          )}
        </aside>
      </div>

      {/* ── Bottom stats strip ── */}
      {stats && (
        <div className="flex items-center justify-between border-t border-white/[0.08] px-6 py-3">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-xs text-gray-400">
                Win Rate{' '}
                <span className="font-semibold text-white">
                  {stats.winRate.toFixed(0)}%
                </span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Zap className="h-3.5 w-3.5 text-yellow-400" />
              <span className="text-xs text-gray-400">
                Score{' '}
                <span className="font-semibold text-white">{stats.score}</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
              <span className="text-xs text-gray-400">
                Biases{' '}
                <span className="font-semibold text-white">
                  {stats.biases}
                </span>
              </span>
            </div>
          </div>
          <p className="text-[10px] text-gray-600">
            {mode === '3d' ? 'Three.js WebGL' : 'Canvas Force Graph'} · {tradeNodes.length} nodes
          </p>
        </div>
      )}
    </div>
  );
}
