"use client";

import { useEffect, useRef } from "react";
import { createChart, ColorType, LineSeries, type IChartApi } from "lightweight-charts";

interface EloChartProps {
  data: { date: string; rating: number }[];
}

export function EloChart({ data }: EloChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;

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
      height: 260,
      rightPriceScale: {
        borderColor: "oklch(0.24 0.008 260)",
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: "oklch(0.24 0.008 260)",
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      crosshair: {
        vertLine: {
          color: "oklch(0.40 0.01 260)",
          labelBackgroundColor: "oklch(0.20 0.006 260)",
        },
        horzLine: {
          color: "oklch(0.40 0.01 260)",
          labelBackgroundColor: "oklch(0.20 0.006 260)",
        },
      },
      handleScroll: false,
      handleScale: false,
    });

    const series = chart.addSeries(LineSeries, {
      color: "oklch(0.62 0.14 250)",
      lineWidth: 2,
      crosshairMarkerRadius: 4,
      crosshairMarkerBorderColor: "oklch(0.62 0.14 250)",
      crosshairMarkerBackgroundColor: "oklch(0.13 0.004 260)",
      priceLineVisible: false,
      lastValueVisible: true,
    });

    const chartData = data.map((d) => ({
      time: d.date as string,
      value: d.rating,
    }));

    series.setData(chartData);
    chart.timeScale().fitContent();
    chartRef.current = chart;

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
    };
  }, [data]);

  if (data.length === 0) {
    return (
      <div className="flex h-[260px] items-center justify-center rounded-lg border border-border bg-surface-1 text-xs text-muted-foreground">
        No ELO history yet
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="rounded-lg border border-border bg-surface-1"
    />
  );
}
