"use client";

import { useState, useCallback } from "react";
import type { Trade, DecisionEvent, DisciplinedSessionResult } from "@/lib/types";
import { TradeCard } from "./trade-card";
import { DecisionLegend } from "./decision-badge";
import { PnlChart } from "@/components/charts/pnl-chart";
import { cn } from "@/lib/utils";

interface TradeTimelineProps {
  trades: Trade[];
  decisions: DecisionEvent[];
  replay?: DisciplinedSessionResult;
}

/**
 * Interactive trade timeline with TradingView P/L chart.
 * Keyboard navigation: arrows to step, Home/End to jump.
 */
export function TradeTimeline({ trades, decisions, replay }: TradeTimelineProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
        case "ArrowRight":
          e.preventDefault();
          setActiveIndex((i) => Math.min(i + 1, trades.length - 1));
          break;
        case "ArrowUp":
        case "ArrowLeft":
          e.preventDefault();
          setActiveIndex((i) => Math.max(i - 1, 0));
          break;
        case "Home":
          e.preventDefault();
          setActiveIndex(0);
          break;
        case "End":
          e.preventDefault();
          setActiveIndex(trades.length - 1);
          break;
      }
    },
    [trades.length],
  );

  if (trades.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No trades in this session.
      </p>
    );
  }

  // Mini sparkline data
  const maxAbsPnl = Math.max(
    ...trades.map((t) => Math.abs(t.runningPnl)),
    1,
  );

  return (
    <div
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="rounded-lg border border-border bg-surface-1 focus:outline-none focus:ring-1 focus:ring-accent/40"
    >
      {/* P/L Chart */}
      <div className="border-b border-border">
        <PnlChart
          trades={trades}
          decisions={decisions}
          replay={replay}
          activeIndex={activeIndex}
        />
      </div>

      <div className="p-4">
        {/* Legend */}
        <div className="mb-4">
          <DecisionLegend />
        </div>

        {/* Nav controls */}
        <div className="mb-4 flex items-center gap-2">
          <NavBtn
            onClick={() => setActiveIndex(0)}
            disabled={activeIndex === 0}
          >
            First
          </NavBtn>
          <NavBtn
            onClick={() => setActiveIndex((i) => Math.max(i - 1, 0))}
            disabled={activeIndex === 0}
          >
            Prev
          </NavBtn>
          <span className="tabular mx-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{activeIndex + 1}</span>
            {" / "}
            {trades.length}
          </span>
          <NavBtn
            onClick={() => setActiveIndex((i) => Math.min(i + 1, trades.length - 1))}
            disabled={activeIndex === trades.length - 1}
          >
            Next
          </NavBtn>
          <NavBtn
            onClick={() => setActiveIndex(trades.length - 1)}
            disabled={activeIndex === trades.length - 1}
          >
            Last
          </NavBtn>
        </div>

        {/* Mini P/L bar */}
        <div className="mb-4 flex h-6 items-end gap-px rounded bg-surface-0 p-0.5">
          {trades.map((trade, i) => {
            const height = Math.max(
              3,
              (Math.abs(trade.runningPnl) / maxAbsPnl) * 20,
            );
            return (
              <button
                key={trade.id}
                onClick={() => setActiveIndex(i)}
                className={cn(
                  "flex-1 cursor-pointer rounded-sm transition-opacity",
                  i === activeIndex
                    ? "ring-1 ring-accent opacity-100"
                    : "opacity-50 hover:opacity-80",
                  trade.runningPnl >= 0 ? "bg-positive" : "bg-negative",
                )}
                style={{ height: `${height}px` }}
                title={`#${i + 1}: ${trade.symbol}`}
              />
            );
          })}
        </div>

        {/* Trade cards */}
        <div className="max-h-[400px] space-y-1 overflow-y-auto pr-1">
          {trades.map((trade, i) => (
            <TradeCard
              key={trade.id}
              trade={trade}
              decision={decisions[i]}
              isActive={i === activeIndex}
              onClick={() => setActiveIndex(i)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function NavBtn({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground disabled:opacity-30"
    >
      {children}
    </button>
  );
}
