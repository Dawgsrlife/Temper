'use client';

import { useEffect, useRef } from 'react';
import { createChart, ColorType, IChartApi, AreaSeries, LineSeries, Time, createSeriesMarkers } from 'lightweight-charts';
import { TradeWithAnalysis } from '@/lib/biasDetector';

interface EquityChartProps {
    trades: TradeWithAnalysis[];
    currentIndex: number;
    height?: number;
}

export default function EquityChart({ trades, currentIndex, height = 400 }: EquityChartProps) {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);

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
        });

        chartRef.current = chart;

        // Create equity curve data from trades
        const equityData = trades.map((trade, i) => ({
            time: Math.floor(new Date(trade.timestamp).getTime() / 1000) as Time,
            value: trade.sessionPnL,
        }));

        // Add starting point
        if (equityData.length > 0 && trades.length > 0) {
            const firstTradeTime = new Date(trades[0].timestamp).getTime();
            equityData.unshift({
                time: Math.floor((firstTradeTime - 60000) / 1000) as Time, // 1 min before first trade
                value: 0,
            });
        }

        // Area series for equity curve
        const areaSeries = chart.addSeries(AreaSeries, {
            lineColor: trades[trades.length - 1]?.sessionPnL >= 0 ? '#06D6A0' : '#EF476F',
            topColor: trades[trades.length - 1]?.sessionPnL >= 0 ? 'rgba(6, 214, 160, 0.3)' : 'rgba(239, 71, 111, 0.3)',
            bottomColor: trades[trades.length - 1]?.sessionPnL >= 0 ? 'rgba(6, 214, 160, 0.02)' : 'rgba(239, 71, 111, 0.02)',
            lineWidth: 2,
            crosshairMarkerVisible: true,
            crosshairMarkerRadius: 6,
            crosshairMarkerBackgroundColor: '#06D6A0',
            crosshairMarkerBorderColor: '#0B0B16',
            crosshairMarkerBorderWidth: 2,
        });

        areaSeries.setData(equityData);

        // Add trade markers
        const markers = trades.map((trade, i) => ({
            time: Math.floor(new Date(trade.timestamp).getTime() / 1000) as Time,
            position: 'inBar' as const,
            color: trade.sessionPnL >= 0 ? '#06D6A0' : '#EF476F',
            shape: 'circle' as const,
            size: i === currentIndex ? 1.5 : 0.8,
            text: i === currentIndex ? `${trade.sessionPnL >= 0 ? '+' : ''}$${trade.sessionPnL.toFixed(0)}` : undefined,
        }));

        // Use v5 createSeriesMarkers instead of deprecated areaSeries.setMarkers()
        createSeriesMarkers(areaSeries, markers);



        // Zero line
        const zeroLine = chart.addSeries(LineSeries, {
            color: 'rgba(156, 163, 175, 0.3)',
            lineWidth: 1,
            lineStyle: 2, // dashed
            crosshairMarkerVisible: false,
            priceLineVisible: false,
        });

        if (equityData.length >= 2) {
            zeroLine.setData([
                { time: equityData[0].time, value: 0 },
                { time: equityData[equityData.length - 1].time, value: 0 },
            ]);
        }

        chart.timeScale().fitContent();

        // Handle resize
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
    }, [trades, currentIndex, height]);

    return (
        <div className="relative h-full w-full">
            {/* Chart Stats Overlay */}
            <div className="absolute left-4 top-4 z-10 flex gap-4">
                <div className="rounded-lg bg-temper-bg/80 px-3 py-2 backdrop-blur-sm ring-1 ring-temper-border/20">
                    <p className="text-xs text-temper-muted">Current P/L</p>
                    <p className={`text-lg font-bold ${trades[trades.length - 1]?.sessionPnL >= 0 ? 'text-temper-teal' : 'text-temper-red'}`}>
                        {trades[trades.length - 1]?.sessionPnL >= 0 ? '+' : ''}${trades[trades.length - 1]?.sessionPnL.toFixed(0) || 0}
                    </p>
                </div>
                <div className="rounded-lg bg-temper-bg/80 px-3 py-2 backdrop-blur-sm ring-1 ring-temper-border/20">
                    <p className="text-xs text-temper-muted">Trades</p>
                    <p className="text-lg font-bold text-temper-text">{trades.length}</p>
                </div>
            </div>

            <div
                ref={chartContainerRef}
                className="h-full w-full rounded-xl chart-container"
            />
        </div>
    );
}
