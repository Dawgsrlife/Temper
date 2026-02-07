'use client';

import { useRef, useEffect, useState } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ArrowLeft, Play, Pause, SkipForward, SkipBack, Info } from 'lucide-react';

// Dynamic import for chart (SSR issues with lightweight-charts)
const TradingChart = dynamic(() => import('@/components/TradingChart'), { ssr: false });

interface Trade {
    timestamp: string;
    asset: string;
    side: 'BUY' | 'SELL';
    quantity: number;
}

// Demo trades data
const demoTrades: Trade[] = [
    { timestamp: '2025-03-01 09:30:00', asset: 'MSFT', side: 'BUY', quantity: 100 },
    { timestamp: '2025-03-01 09:45:00', asset: 'MSFT', side: 'SELL', quantity: 100 },
    { timestamp: '2025-03-01 10:00:00', asset: 'MSFT', side: 'BUY', quantity: 150 },
    { timestamp: '2025-03-01 10:30:00', asset: 'MSFT', side: 'BUY', quantity: 200 },
    { timestamp: '2025-03-01 11:00:00', asset: 'MSFT', side: 'SELL', quantity: 350 },
    { timestamp: '2025-03-01 11:30:00', asset: 'MSFT', side: 'BUY', quantity: 300 },
    { timestamp: '2025-03-01 12:00:00', asset: 'MSFT', side: 'SELL', quantity: 300 },
    { timestamp: '2025-03-01 13:00:00', asset: 'MSFT', side: 'BUY', quantity: 100 },
    { timestamp: '2025-03-01 14:00:00', asset: 'MSFT', side: 'SELL', quantity: 100 },
];

const tradeAnnotations = [
    { index: 0, label: 'Clean Entry', type: 'good', note: 'Waited for confirmation. Proper position sizing.' },
    { index: 1, label: 'Premature Exit', type: 'bad', note: 'Exited too early. Fear of loss overrode the plan.' },
    { index: 2, label: 'Re-entry', type: 'neutral', note: 'Re-entered after pullback. Slightly impulsive.' },
    { index: 3, label: 'Overtrading', type: 'bad', note: 'Added size without conviction. Revenge pattern starting.' },
    { index: 4, label: 'Panic Sell', type: 'bad', note: 'Closed full position at worst moment. Classic tilt.' },
    { index: 5, label: 'Revenge Trade', type: 'bad', note: 'Immediately re-entered to "win back" losses. Dangerous.' },
    { index: 6, label: 'Recovery', type: 'neutral', note: 'Exited to reset. Good self-awareness.' },
    { index: 7, label: 'Clean Entry', type: 'good', note: 'Waited 1 hour. Proper cool-down period.' },
    { index: 8, label: 'Clean Exit', type: 'good', note: 'Small win. Discipline restored.' },
];

export default function DemoPage() {
    const container = useRef<HTMLDivElement>(null);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);

    useGSAP(() => {
        const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
        tl.from('.page-header', { y: 20, opacity: 0, duration: 0.5 })
            .from('.chart-section', { y: 30, opacity: 0, duration: 0.5 }, '-=0.3')
            .from('.annotation-panel', { x: 20, opacity: 0, duration: 0.5 }, '-=0.3');
    }, { scope: container });

    // Auto-play
    useEffect(() => {
        if (!isPlaying) return;

        const interval = setInterval(() => {
            setCurrentIndex(prev => {
                if (prev >= demoTrades.length - 1) {
                    setIsPlaying(false);
                    return prev;
                }
                return prev + 1;
            });
        }, 2000);

        return () => clearInterval(interval);
    }, [isPlaying]);

    const currentAnnotation = tradeAnnotations[currentIndex];
    const currentTrade = demoTrades[currentIndex];

    const typeColors: Record<string, string> = {
        good: 'text-temper-teal bg-temper-teal/10 ring-temper-teal/30',
        bad: 'text-temper-red bg-temper-red/10 ring-temper-red/30',
        neutral: 'text-temper-gold bg-temper-gold/10 ring-temper-gold/30',
    };

    return (
        <div ref={container} className="flex h-[calc(100vh-3.5rem)] flex-col md:h-screen md:flex-row">
            {/* Main Chart Area */}
            <div className="chart-section flex flex-1 flex-col">
                {/* Header */}
                <header className="flex items-center justify-between border-b border-temper-border/10 px-6 py-4">
                    <div className="flex items-center gap-4">
                        <Link
                            href="/dashboard"
                            className="flex items-center gap-2 text-sm text-temper-muted transition-colors hover:text-temper-text"
                        >
                            <ArrowLeft className="h-4 w-4" />
                            Exit Demo
                        </Link>
                        <div className="h-4 w-px bg-temper-border/20" />
                        <h1 className="font-coach text-lg font-bold text-temper-text">
                            Demo Session
                        </h1>
                    </div>

                    {/* Playback Controls */}
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
                            disabled={currentIndex === 0}
                            className="rounded-lg p-2 text-temper-muted transition-colors hover:bg-temper-surface hover:text-temper-text disabled:opacity-30"
                        >
                            <SkipBack className="h-4 w-4" />
                        </button>
                        <button
                            onClick={() => setIsPlaying(!isPlaying)}
                            className="rounded-lg bg-temper-teal p-2.5 text-temper-bg transition-all hover:bg-white"
                        >
                            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                        </button>
                        <button
                            onClick={() => setCurrentIndex(Math.min(demoTrades.length - 1, currentIndex + 1))}
                            disabled={currentIndex >= demoTrades.length - 1}
                            className="rounded-lg p-2 text-temper-muted transition-colors hover:bg-temper-surface hover:text-temper-text disabled:opacity-30"
                        >
                            <SkipForward className="h-4 w-4" />
                        </button>
                        <span className="ml-2 font-mono text-xs text-temper-muted">
                            {currentIndex + 1} / {demoTrades.length}
                        </span>
                    </div>
                </header>

                {/* Chart */}
                <div className="flex-1 p-6">
                    <TradingChart trades={demoTrades.slice(0, currentIndex + 1)} height={500} />
                </div>

                {/* Trade Timeline */}
                <div className="border-t border-temper-border/10 p-4">
                    <div className="flex gap-2 overflow-x-auto pb-2">
                        {demoTrades.map((trade, i) => {
                            const annotation = tradeAnnotations[i];
                            const isActive = i === currentIndex;
                            const isPast = i < currentIndex;

                            return (
                                <button
                                    key={i}
                                    onClick={() => setCurrentIndex(i)}
                                    className={`flex-shrink-0 rounded-lg px-3 py-2 text-left transition-all ${isActive
                                            ? 'bg-temper-teal/10 ring-1 ring-temper-teal/30'
                                            : isPast
                                                ? 'bg-temper-surface/50'
                                                : 'bg-temper-surface/30 opacity-50'
                                        }`}
                                >
                                    <p className={`text-xs font-medium ${isActive ? 'text-temper-teal' : 'text-temper-text'}`}>
                                        {annotation.label}
                                    </p>
                                    <p className="text-[10px] text-temper-muted">
                                        {trade.side} {trade.quantity}
                                    </p>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Annotation Panel */}
            <div className="annotation-panel w-full border-t border-temper-border/10 bg-temper-surface/30 md:w-80 md:border-l md:border-t-0">
                <div className="p-6">
                    <div className="mb-4 flex items-center gap-2 text-temper-muted">
                        <Info className="h-4 w-4" />
                        <span className="text-xs font-medium uppercase tracking-wider">Trade Analysis</span>
                    </div>

                    <div className="space-y-6">
                        {/* Trade Info */}
                        <div className="space-y-3">
                            <div className={`inline-block rounded-lg px-3 py-1 text-xs font-semibold ring-1 ${typeColors[currentAnnotation.type]}`}>
                                {currentAnnotation.label}
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="rounded-lg bg-temper-bg/50 p-3">
                                    <p className="text-xs text-temper-muted">Asset</p>
                                    <p className="text-sm font-medium text-temper-text">{currentTrade.asset}</p>
                                </div>
                                <div className="rounded-lg bg-temper-bg/50 p-3">
                                    <p className="text-xs text-temper-muted">Side</p>
                                    <p className={`text-sm font-medium ${currentTrade.side === 'BUY' ? 'text-temper-teal' : 'text-temper-red'}`}>
                                        {currentTrade.side}
                                    </p>
                                </div>
                                <div className="rounded-lg bg-temper-bg/50 p-3">
                                    <p className="text-xs text-temper-muted">Quantity</p>
                                    <p className="text-sm font-medium text-temper-text">{currentTrade.quantity}</p>
                                </div>
                                <div className="rounded-lg bg-temper-bg/50 p-3">
                                    <p className="text-xs text-temper-muted">Time</p>
                                    <p className="text-sm font-medium text-temper-text">
                                        {currentTrade.timestamp.split(' ')[1].slice(0, 5)}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Coach Note */}
                        <div className="space-y-2">
                            <p className="text-xs font-medium uppercase tracking-wider text-temper-muted">
                                Coach Notes
                            </p>
                            <p className="text-sm leading-relaxed text-temper-text">
                                {currentAnnotation.note}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
