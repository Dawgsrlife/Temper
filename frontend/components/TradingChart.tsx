'use client';

import { useEffect, useRef } from 'react';
import { createChart, ColorType, CandlestickData, Time, IChartApi, CandlestickSeries } from 'lightweight-charts';

interface Trade {
    timestamp: string;
    asset: string;
    side: 'BUY' | 'SELL';
    quantity: number;
}

// Generate realistic candle data based on trades
function generateCandleData(trades: Trade[]): CandlestickData<Time>[] {
    const candles: CandlestickData<Time>[] = [];
    let basePrice = 180;

    if (trades.length === 0) {
        // Generate demo candles
        const now = new Date();
        for (let i = 100; i >= 0; i--) {
            const time = new Date(now.getTime() - i * 60 * 60 * 1000);
            const direction = Math.random() > 0.5 ? 1 : -1;
            const movement = Math.random() * 2 * direction;

            const open = basePrice;
            const close = basePrice + movement;
            const high = Math.max(open, close) + Math.random() * 1;
            const low = Math.min(open, close) - Math.random() * 1;

            candles.push({
                time: Math.floor(time.getTime() / 1000) as Time,
                open: parseFloat(open.toFixed(2)),
                high: parseFloat(high.toFixed(2)),
                low: parseFloat(low.toFixed(2)),
                close: parseFloat(close.toFixed(2)),
            });

            basePrice = close;
        }
        return candles;
    }

    const uniqueDates = [...new Set(trades.map(t => t.timestamp.split(' ')[0]))];

    uniqueDates.forEach((date) => {
        const dayTrades = trades.filter(t => t.timestamp.startsWith(date));
        const volatility = dayTrades.length * 0.5;

        for (let hour = 9; hour <= 16; hour++) {
            const time = `${date} ${hour.toString().padStart(2, '0')}:00:00`;
            const direction = Math.random() > 0.5 ? 1 : -1;
            const movement = (Math.random() * 2 + volatility * 0.2) * direction;

            const open = basePrice;
            const close = basePrice + movement;
            const high = Math.max(open, close) + Math.random() * 1.5;
            const low = Math.min(open, close) - Math.random() * 1.5;

            candles.push({
                time: Math.floor(new Date(time).getTime() / 1000) as Time,
                open: parseFloat(open.toFixed(2)),
                high: parseFloat(high.toFixed(2)),
                low: parseFloat(low.toFixed(2)),
                close: parseFloat(close.toFixed(2)),
            });

            basePrice = close;
        }
    });

    return candles.slice(-100);
}

interface TradingChartProps {
    trades?: Trade[];
    height?: number;
}

export default function TradingChart({ trades = [], height = 400 }: TradingChartProps) {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);

    useEffect(() => {
        if (!chartContainerRef.current) return;

        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: 'transparent' },
                textColor: '#8A8A8A',
                fontFamily: 'Inter, sans-serif',
            },
            grid: {
                vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
                horzLines: { color: 'rgba(255, 255, 255, 0.03)' },
            },
            width: chartContainerRef.current.clientWidth,
            height: height,
            crosshair: {
                vertLine: { color: 'rgba(6, 214, 160, 0.3)', width: 1 },
                horzLine: { color: 'rgba(6, 214, 160, 0.3)', width: 1 },
            },
            rightPriceScale: {
                borderVisible: false,
                scaleMargins: { top: 0.1, bottom: 0.1 },
            },
            timeScale: {
                borderVisible: false,
                timeVisible: true,
                secondsVisible: false,
            },
        });

        chartRef.current = chart;

        // Use CandlestickSeries definition for v5 API
        const candlestickSeries = chart.addSeries(CandlestickSeries, {
            upColor: '#06D6A0',
            downColor: '#EF476F',
            borderUpColor: '#06D6A0',
            borderDownColor: '#EF476F',
            wickUpColor: '#06D6A0',
            wickDownColor: '#EF476F',
        });

        // Generate and set data
        const candles = generateCandleData(trades);
        candlestickSeries.setData(candles);

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
    }, [trades, height]);

    return (
        <div
            ref={chartContainerRef}
            className="w-full rounded-xl bg-temper-bg/50 ring-1 ring-temper-border/20"
        />
    );
}
