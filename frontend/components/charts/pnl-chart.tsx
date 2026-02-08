"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  createSeriesMarkers,
  ColorType,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
} from "lightweight-charts";
import type { Trade, DecisionEvent, DisciplinedSessionResult } from "@/lib/types";
import { DecisionLabel, DECISION_SYMBOLS } from "@/lib/types";
import { sanitizeIndexedChartPoints } from "@/lib/chart-sanitize";

interface PnlChartProps {
  trades: Trade[];
  decisions: DecisionEvent[];
  replay?: DisciplinedSessionResult;
  activeIndex?: number;
  onTradeClick?: (index: number) => void;
}

const MARKER_COLORS: Partial<Record<DecisionLabel, string>> = {
  [DecisionLabel.BRILLIANT]: "oklch(0.72 0.14 195)",
  [DecisionLabel.GREAT]: "oklch(0.70 0.14 200)",
  [DecisionLabel.BEST]: "oklch(0.68 0.14 160)",
  [DecisionLabel.EXCELLENT]: "oklch(0.72 0.16 150)",
  [DecisionLabel.GOOD]: "oklch(0.68 0.12 230)",
  [DecisionLabel.BOOK]: "oklch(0.65 0.12 250)",
  [DecisionLabel.FORCED]: "oklch(0.60 0.14 290)",
  [DecisionLabel.INTERESTING]: "oklch(0.74 0.14 85)",
  [DecisionLabel.INACCURACY]: "oklch(0.74 0.14 85)",
  [DecisionLabel.MISTAKE]: "oklch(0.66 0.14 55)",
  [DecisionLabel.MISS]: "oklch(0.55 0.02 250)",
  [DecisionLabel.BLUNDER]: "oklch(0.58 0.18 28)",
  [DecisionLabel.MEGABLUNDER]: "oklch(0.40 0.18 25)",
  [DecisionLabel.CHECKMATED]: "oklch(0.45 0.20 15)",
  [DecisionLabel.WINNER]: "oklch(0.80 0.14 95)",
  [DecisionLabel.DRAW]: "oklch(0.60 0.02 250)",
  [DecisionLabel.RESIGN]: "oklch(0.45 0.02 250)",
};

export function PnlChart({
  trades,
  decisions,
  replay,
  activeIndex,
}: PnlChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  useEffect(() => {
    if (!containerRef.current || trades.length === 0) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "oklch(0.52 0.01 260)",
        fontSize: 11,
        fontFamily: "Inter, system-ui, sans-serif",
      },
      grid: {
        vertLines: { color: "oklch(0.20 0.006 260)" },
        horzLines: { color: "oklch(0.20 0.006 260)" },
      },
      width: containerRef.current.clientWidth,
      height: 220,
      rightPriceScale: {
        borderColor: "oklch(0.24 0.008 260)",
        scaleMargins: { top: 0.15, bottom: 0.15 },
      },
      timeScale: {
        borderColor: "oklch(0.24 0.008 260)",
        fixLeftEdge: true,
        fixRightEdge: true,
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: {
          color: "oklch(0.35 0.01 260)",
          labelBackgroundColor: "oklch(0.20 0.006 260)",
        },
        horzLine: {
          color: "oklch(0.35 0.01 260)",
          labelBackgroundColor: "oklch(0.20 0.006 260)",
        },
      },
      handleScroll: false,
      handleScale: false,
    });

    // Actual P/L line
    const actualSeries = chart.addSeries(LineSeries, {
      color: "oklch(0.62 0.14 250)",
      lineWidth: 2,
      crosshairMarkerRadius: 3,
      crosshairMarkerBorderColor: "oklch(0.62 0.14 250)",
      crosshairMarkerBackgroundColor: "oklch(0.13 0.004 260)",
      priceLineVisible: false,
      lastValueVisible: true,
    });

    const normalizedActualRows = sanitizeIndexedChartPoints(
      trades.map((t, index) => ({
        index,
        time: Math.floor(Number(t.timestampMs) / 1000),
        value: Number(t.runningPnl),
      })),
    );
    if (normalizedActualRows.length === 0) {
      chart.remove();
      return;
    }
    const indexToActualTime = new Map<number, number>(
      normalizedActualRows.map((row) => [row.index, row.time]),
    );
    const actualData = normalizedActualRows.map((row) => ({
      time: row.time as unknown as string,
      value: row.value,
    }));

    actualSeries.setData(actualData);

    // Decision markers via createSeriesMarkers plugin
    const markers = decisions
      .filter(
        (d) =>
          d.label === DecisionLabel.BLUNDER ||
          d.label === DecisionLabel.MISTAKE ||
          d.label === DecisionLabel.BRILLIANT ||
          d.label === DecisionLabel.EXCELLENT,
      )
      .map((d) => {
        const trade = trades[d.tradeIndex];
        const time = indexToActualTime.get(d.tradeIndex);
        if (!trade || time === undefined) return null;
        const isNegative =
          d.label === DecisionLabel.BLUNDER ||
          d.label === DecisionLabel.MISTAKE;
        return {
          time: time as unknown as string,
          position: isNegative ? ("belowBar" as const) : ("aboveBar" as const),
          color: MARKER_COLORS[d.label] ?? "oklch(0.52 0.01 260)",
          shape: isNegative ? ("arrowDown" as const) : ("arrowUp" as const),
          text: DECISION_SYMBOLS[d.label],
        };
      })
      .filter((marker): marker is NonNullable<typeof marker> => marker !== null);

    if (markers.length > 0) {
      createSeriesMarkers(actualSeries, markers);
    }

    // Disciplined replay overlay
    if (replay && replay.disciplinedTrades.length > 0) {
      const replaySeries = chart.addSeries(LineSeries, {
        color: "oklch(0.50 0.08 150)",
        lineWidth: 1,
        lineStyle: 2, // Dashed
        crosshairMarkerVisible: false,
        priceLineVisible: false,
        lastValueVisible: false,
      });

      const normalizedReplayRows = sanitizeIndexedChartPoints(
        replay.disciplinedTrades.map((t, index) => ({
          index,
          time: Math.floor(Number(t.timestampMs) / 1000),
          value: Number(t.runningPnl),
        })),
      );
      const replayData = normalizedReplayRows.map((row) => ({
        time: row.time as unknown as string,
        value: row.value,
      }));

      if (replayData.length > 0) {
        replaySeries.setData(replayData);
      }
    }

    chart.timeScale().fitContent();
    chartRef.current = chart;
    seriesRef.current = actualSeries;

    const observer = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [trades, decisions, replay]);

  // Highlight active trade via crosshair
  useEffect(() => {
    if (
      chartRef.current &&
      seriesRef.current &&
      activeIndex !== undefined &&
      trades[activeIndex]
    ) {
      const timestamp = Math.floor(Number(trades[activeIndex].timestampMs) / 1000);
      const pnl = Number(trades[activeIndex].runningPnl);
      if (Number.isFinite(timestamp) && Number.isFinite(pnl)) {
        try {
          chartRef.current.setCrosshairPosition(
            pnl,
            timestamp as unknown as Parameters<IChartApi["setCrosshairPosition"]>[1],
            seriesRef.current,
          );
        } catch {
          // Ignore stale/corrupt crosshair updates instead of crashing the page.
        }
      }
    }
  }, [activeIndex, trades]);

  if (trades.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center rounded-lg border border-border bg-surface-1 text-xs text-muted-foreground">
        No trade data
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface-1">
      <div ref={containerRef} />
      {replay && (
        <div className="flex items-center gap-4 border-t border-border px-3 py-2 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-3 rounded bg-accent" />
            Actual P/L
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-3 rounded border-t border-dashed border-positive bg-transparent" />
            Disciplined P/L
          </span>
        </div>
      )}
    </div>
  );
}
