'use client';

import * as React from 'react';
import { TradeEvent } from '../[id]/types';
import { DecisionBadge } from './DecisionBadge';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

interface TradeTimelineProps {
    trades: TradeEvent[];
    selectedId: string | null;
    onSelect: (tradeId: string) => void;
}

export function TradeTimeline({ trades, selectedId, onSelect }: TradeTimelineProps) {
    const scrollContainerRef = React.useRef<HTMLDivElement>(null);

    // Scroll current selection into view
    React.useEffect(() => {
        if (selectedId && scrollContainerRef.current) {
            const selectedEl = document.getElementById(`trade-chip-${selectedId}`);
            if (selectedEl) {
                selectedEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            }
        }
    }, [selectedId]);

    return (
        <div className="relative flex w-full flex-col border-t border-temper-border bg-temper-bg/95 p-4 backdrop-blur-md">
            <div className="flex items-center justify-between mb-2 px-2">
                <h3 className="text-sm font-bold text-temper-muted uppercase tracking-wider font-coach">Session Timeline</h3>
                <div className="flex space-x-2">
                    {/* Navigation controls could go here too, but main ones are likely global */}
                </div>
            </div>

            <div
                ref={scrollContainerRef}
                className="flex w-full space-x-4 overflow-x-auto pb-4 pt-2 scrollbar-active"
            >
                {trades.map((trade, idx) => {
                    const isSelected = selectedId === trade.id;
                    return (
                        <button
                            key={trade.id}
                            id={`trade-chip-${trade.id}`}
                            onClick={() => onSelect(trade.id)}
                            className={cn(
                                "group relative flex min-w-[140px] flex-col items-start rounded-xl border p-3 transition-all duration-200",
                                isSelected
                                    ? "border-temper-teal bg-temper-teal/10 shadow-[0_0_15px_rgba(6,214,160,0.3)] ring-1 ring-temper-teal"
                                    : "border-temper-border bg-temper-surface hover:border-temper-muted/50"
                            )}
                        >
                            <div className="flex w-full items-center justify-between mb-2">
                                <span className="text-xs font-mono text-temper-muted">#{trade.index + 1}</span>
                                <DecisionBadge label={trade.label} symbolCode={trade.symbolCode} size="sm" className="w-5 h-5 text-[10px]" />
                            </div>

                            <div className="flex items-baseline space-x-2">
                                <span className={cn(
                                    "text-sm font-bold font-mono",
                                    trade.side === 'BUY' ? "text-temper-teal" : "text-temper-red"
                                )}>
                                    {trade.side}
                                </span>
                                <span className="text-xs text-temper-muted font-mono">{trade.qty} @ {trade.price}</span>
                            </div>

                            <div className={cn(
                                "mt-2 text-xs font-mono font-medium",
                                trade.realizedPnl > 0 ? "text-temper-teal" : trade.realizedPnl < 0 ? "text-temper-red" : "text-temper-muted"
                            )}>
                                {trade.realizedPnl > 0 ? '+' : ''}{trade.realizedPnl.toFixed(2)}
                            </div>

                            {isSelected && (
                                <div className="absolute -bottom-1 left-1/2 h-1 w-8 -translate-x-1/2 rounded-t-full bg-temper-teal" />
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
