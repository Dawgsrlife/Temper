'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation'; // Wait, next/router is old, app dir uses next/navigation
import { useParams } from 'next/navigation';
import { mockCoachFacts, mockTemperReport, mockTradeEvents } from './mockData';
import { TradeGraph } from '../_components/TradeGraph';
import { TradeTimeline } from '../_components/TradeTimeline';
import { CoachPanel } from '../_components/CoachPanel';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';

export default function SessionReviewPage() {
  const params = useParams();
  const router = useRouter();

  // In real app, fetch data based on params.id
  const report = mockTemperReport;
  const coachFacts = mockCoachFacts;

  const [selectedTradeIndex, setSelectedTradeIndex] = React.useState<number | null>(null);

  // Keyboard navigation
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        setSelectedTradeIndex(prev => {
          if (prev === null) return 0;
          return Math.min(prev + 1, report.trades.length - 1);
        });
      } else if (e.key === 'ArrowLeft') {
        setSelectedTradeIndex(prev => {
          if (prev === null) return 0;
          return Math.max(prev - 1, 0);
        });
      } else if (e.key.toLowerCase() === 'b') {
        // Find next blunder
        const nextBlunder = report.trades.find((t, i) => i > (selectedTradeIndex ?? -1) && (t.label === 'BLUNDER' || t.label === 'MISTAKE'));
        if (nextBlunder) setSelectedTradeIndex(nextBlunder.index);
      } else if (e.key.toLowerCase() === 'g') {
        // Find next brilliant
        const nextGood = report.trades.find((t, i) => i > (selectedTradeIndex ?? -1) && (t.label === 'BRILLIANT' || t.label === 'EXCELLENT'));
        if (nextGood) setSelectedTradeIndex(nextGood.index);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [report.trades, selectedTradeIndex]);

  const selectedTrade = selectedTradeIndex !== null ? report.trades[selectedTradeIndex] : null;

  return (
    <div className="flex h-[calc(100vh-theme(spacing.16))] flex-row overflow-hidden md:flex-row flex-col bg-temper-bg text-temper-text">

      {/* Left/Center Main Area */}
      <div className="flex flex-1 flex-col relative h-full">
        {/* Toolbar */}
        <div className="flex items-center justify-between border-b border-temper-border bg-temper-bg px-4 py-2">
          <div className="flex items-center space-x-4">
            <Link href="/dashboard" className="flex items-center text-sm text-temper-muted hover:text-white transition-colors">
              <ArrowLeft className="mr-2 h-4 w-4" /> Exit Review
            </Link>
            <h1 className="text-lg font-bold font-coach">
              Session {report.date}
              <span className="ml-3 rounded-full bg-temper-subtle px-2 py-0.5 text-xs text-temper-muted font-mono tracking-wide">
                {report.summary.totalTrades} Trades
              </span>
            </h1>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setSelectedTradeIndex(prev => prev !== null && prev > 0 ? prev - 1 : 0)}
              disabled={selectedTradeIndex === 0}
              className="rounded bg-temper-surface p-1 hover:bg-temper-border disabled:opacity-50"
              title="Previous (Left Arrow)"
            >
              <ChevronLeft size={20} />
            </button>
            <button
              onClick={() => setSelectedTradeIndex(prev => prev !== null && prev < report.trades.length - 1 ? prev + 1 : 0)}
              disabled={selectedTradeIndex === report.trades.length - 1}
              className="rounded bg-temper-surface p-1 hover:bg-temper-border disabled:opacity-50"
              title="Next (Right Arrow)"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        </div>

        {/* Graph View (Board) */}
        <div className="flex-1 relative bg-[#0B0B16]">
          <TradeGraph
            trades={report.trades}
            selectedId={selectedTrade?.id ?? null}
            onSelect={(id) => {
              const trade = report.trades.find(t => t.id === id);
              if (trade) setSelectedTradeIndex(trade.index);
            }}
          />

          {/* Instructions Overlay */}
          <div className="absolute top-4 left-4 bg-black/40 backdrop-blur-md p-3 rounded-lg border border-white/10 text-xs text-temper-muted pointer-events-none">
            <p>Press <span className="font-bold text-white">Left/Right</span> to step</p>
            <p>Press <span className="font-bold text-white">B</span> for Blunders</p>
            <p>Scroll to Zoom</p>
          </div>
        </div>

        {/* Timeline Strip */}
        <div className="h-48 flex-shrink-0 z-20 shadow-2xl">
          <TradeTimeline
            trades={report.trades}
            selectedId={selectedTrade?.id ?? null}
            onSelect={(id) => {
              const trade = report.trades.find(t => t.id === id);
              if (trade) setSelectedTradeIndex(trade.index);
            }}
          />
        </div>
      </div>

      {/* Right Panel (Coach) */}
      <div className="w-full md:w-[400px] flex-shrink-0 border-l border-temper-border bg-temper-surface z-30 shadow-2xl">
        <CoachPanel
          coachFacts={coachFacts}
          selectedTrade={selectedTrade}
          onCloseSelection={() => setSelectedTradeIndex(null)}
        />
      </div>

    </div>
  );
}
