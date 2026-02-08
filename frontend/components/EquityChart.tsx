'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import {
    createChart, ColorType, IChartApi, AreaSeries, LineSeries, Time,
    createSeriesMarkers, ISeriesApi, SeriesType,
} from 'lightweight-charts';
import { TradeWithAnalysis } from '@/lib/biasDetector';

interface EquityChartProps {
    trades: TradeWithAnalysis[];
    currentIndex: number;
    height?: number;
    onTradeClick?: (index: number) => void;
}

export default function EquityChart({ trades, currentIndex, height = 400, onTradeClick }: EquityChartProps) {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const [focusedTrade, setFocusedTrade] = useState<TradeWithAnalysis | null>(null);
    const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

    useEffect(() => {
        if (!chartContainerRef.current) return;

        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: 'transparent' },
                textColor: '#6B7280',
                fontFamily: 'Inter, sans-serif',
                fontSize: 11,
            },
            grid: {
                vertLines: { color: 'rgba(47, 47, 66, 0.3)' },
                horzLines: { color: 'rgba(47, 47, 66, 0.3)' },
            },
            width: chartContainerRef.current.clientWidth,
            height: height,
            crosshair: {
                vertLine: { color: 'rgba(6, 214, 160, 0.4)', width: 1, labelBackgroundColor: '#1E1E2F' },
                horzLine: { color: 'rgba(6, 214, 160, 0.4)', width: 1, labelBackgroundColor: '#1E1E2F' },
            },
            rightPriceScale: {
                borderVisible: false,
                scaleMargins: { top: 0.15, bottom: 0.1 },
            },
            timeScale: {
                borderVisible: false,
                timeVisible: true,
                secondsVisible: false,
            },
            handleScroll: { mouseWheel: true, pressedMouseMove: true },
            handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
        });

        chartRef.current = chart;

        // Build equity curve
        const equityData = trades.map((trade) => ({
            time: Math.floor(new Date(trade.timestamp).getTime() / 1000) as Time,
            value: trade.sessionPnL,
        }));

        if (equityData.length > 0) {
            const firstTime = new Date(trades[0].timestamp).getTime();
            equityData.unshift({
                time: Math.floor((firstTime - 60000) / 1000) as Time,
                value: 0,
            });
        }

        // Equity area
        const lastPnL = trades[trades.length - 1]?.sessionPnL ?? 0;
        const isPositive = lastPnL >= 0;
        const mainColor = isPositive ? '#06D6A0' : '#EF476F';

        const areaSeries = chart.addSeries(AreaSeries, {
            lineColor: mainColor,
            topColor: isPositive ? 'rgba(6, 214, 160, 0.3)' : 'rgba(239, 71, 111, 0.3)',
            bottomColor: isPositive ? 'rgba(6, 214, 160, 0.02)' : 'rgba(239, 71, 111, 0.02)',
            lineWidth: 2,
            crosshairMarkerVisible: true,
            crosshairMarkerRadius: 6,
            crosshairMarkerBackgroundColor: mainColor,
            crosshairMarkerBorderColor: '#0B0B16',
            crosshairMarkerBorderWidth: 2,
        });

        areaSeries.setData(equityData);

        // Markers
        const markers = trades.map((trade, i) => ({
            time: Math.floor(new Date(trade.timestamp).getTime() / 1000) as Time,
            position: 'inBar' as const,
            color: trade.sessionPnL >= 0 ? '#06D6A0' : '#EF476F',
            shape: 'circle' as const,
            size: i === currentIndex ? 1.5 : 0.8,
            text: i === currentIndex ? `${trade.sessionPnL >= 0 ? '+' : ''}$${trade.sessionPnL.toFixed(0)}` : undefined,
        }));

        createSeriesMarkers(areaSeries, markers);

        // Zero line
        const zeroLine = chart.addSeries(LineSeries, {
            color: 'rgba(156, 163, 175, 0.3)',
            lineWidth: 1,
            lineStyle: 2,
            crosshairMarkerVisible: false,
            priceLineVisible: false,
        });

        if (equityData.length >= 2) {
            zeroLine.setData([
                { time: equityData[0].time, value: 0 },
                { time: equityData[equityData.length - 1].time, value: 0 },
            ]);
        }

        // Click handler for data points
        chart.subscribeClick((param) => {
            if (!param.point || !param.time) return;

            // Find the closest trade to this timestamp
            const clickedTime = param.time as number;
            let closestIdx = 0;
            let closestDist = Infinity;
            trades.forEach((trade, i) => {
                const tradeTime = Math.floor(new Date(trade.timestamp).getTime() / 1000);
                const dist = Math.abs(tradeTime - clickedTime);
                if (dist < closestDist) {
                    closestDist = dist;
                    closestIdx = i;
                }
            });

            if (closestDist < 300) { // within 5 minutes
                setFocusedTrade(trades[closestIdx]);
                setTooltipPos({ x: param.point.x, y: param.point.y });
                onTradeClick?.(closestIdx);

                // Zoom to area around clicked trade
                const tradeTime = Math.floor(new Date(trades[closestIdx].timestamp).getTime() / 1000);
                const windowSize = 1800; // 30 min window
                chart.timeScale().setVisibleRange({
                    from: (tradeTime - windowSize) as Time,
                    to: (tradeTime + windowSize) as Time,
                });
            } else {
                setFocusedTrade(null);
                setTooltipPos(null);
            }
        });

        chart.timeScale().fitContent();

        // Resize
        const handleResize = () => {
            if (chartContainerRef.current) {
                chart.applyOptions({ width: chartContainerRef.current.clientWidth });
            }
        };
        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            chart.remove();
        };
    }, [trades, currentIndex, height, onTradeClick]);

    const resetZoom = useCallback(() => {
        chartRef.current?.timeScale().fitContent();
        setFocusedTrade(null);
        setTooltipPos(null);
    }, []);

    return (
        <div className="relative h-full w-full">
            {/* Stats overlay */}
            <div className="absolute left-4 top-4 z-10 flex gap-3">
                <div className="rounded-lg bg-[#0a0a0a]/80 px-3 py-2 backdrop-blur-sm ring-1 ring-white/[0.08]">
                    <p className="text-[10px] text-gray-500">Current P/L</p>
                    <p className={`text-lg font-bold ${(trades[trades.length - 1]?.sessionPnL ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {(trades[trades.length - 1]?.sessionPnL ?? 0) >= 0 ? '+' : ''}${trades[trades.length - 1]?.sessionPnL.toFixed(0) || 0}
                    </p>
                </div>
                <div className="rounded-lg bg-[#0a0a0a]/80 px-3 py-2 backdrop-blur-sm ring-1 ring-white/[0.08]">
                    <p className="text-[10px] text-gray-500">Trades</p>
                    <p className="text-lg font-bold text-white">{trades.length}</p>
                </div>
            </div>

            {/* Zoom controls */}
            <div className="absolute right-4 top-4 z-10 flex gap-2">
                <button
                    onClick={resetZoom}
                    className="cursor-pointer rounded-lg bg-[#0a0a0a]/80 px-2.5 py-1.5 text-[10px] font-medium text-gray-400 ring-1 ring-white/[0.08] backdrop-blur-sm transition-colors hover:text-white hover:ring-emerald-400/30"
                >
                    Reset Zoom
                </button>
            </div>

            {/* Focused trade tooltip */}
            {focusedTrade && tooltipPos && (
                <div
                    className="absolute z-20 rounded-xl bg-[#141414]/95 p-3 shadow-2xl ring-1 ring-white/10 backdrop-blur-md"
                    style={{
                        left: Math.min(tooltipPos.x + 12, (chartContainerRef.current?.clientWidth || 400) - 220),
                        top: Math.max(tooltipPos.y - 100, 8),
                        width: 200,
                    }}
                >
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-white">{focusedTrade.asset}</span>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${focusedTrade.label === 'BRILLIANT' || focusedTrade.label === 'EXCELLENT' || focusedTrade.label === 'GOOD'
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : focusedTrade.label === 'BLUNDER' || focusedTrade.label === 'MISTAKE'
                                    ? 'bg-red-500/20 text-red-400'
                                    : 'bg-yellow-500/20 text-yellow-400'
                            }`}>{focusedTrade.label}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                            <p className="text-gray-400">Side</p>
                            <p className={focusedTrade.side === 'BUY' ? 'text-emerald-400' : 'text-red-400'}>{focusedTrade.side}</p>
                        </div>
                        <div>
                            <p className="text-gray-400">P/L</p>
                            <p className={`font-semibold ${(focusedTrade.pnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {(focusedTrade.pnl ?? 0) >= 0 ? '+' : ''}${Math.abs(focusedTrade.pnl ?? 0).toFixed(0)}
                            </p>
                        </div>
                    </div>
                    {focusedTrade.biases.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                            {focusedTrade.biases.map((b, i) => (
                                <span key={i} className="rounded-full bg-red-400/10 px-2 py-0.5 text-[10px] text-red-400">
                                    ⚠ {b.type}
                                </span>
                            ))}
                        </div>
                    )}
                    <p className="mt-2 text-[10px] text-gray-400">{focusedTrade.timestamp}</p>
                    <button
                        onClick={() => { setFocusedTrade(null); setTooltipPos(null); resetZoom(); }}
                        className="mt-2 cursor-pointer text-[10px] text-emerald-400 hover:text-emerald-300 transition-colors"
                    >
                        ← Zoom out
                    </button>
                </div>
            )}

            <div ref={chartContainerRef} className="h-full w-full rounded-xl chart-container cursor-crosshair" />

            {/* Scroll zoom hint */}
            <div className="absolute bottom-2 right-4 z-10">
                <p className="text-[9px] text-gray-500">Scroll to zoom · Click data point to inspect</p>
            </div>
        </div>
    );
}