'use client';

import * as React from 'react';
import { CoachFactsPayload, TradeEvent } from '../[id]/types';
import { DecisionBadge } from './DecisionBadge';
import { motion, AnimatePresence } from 'framer-motion';

interface CoachPanelProps {
    coachFacts: CoachFactsPayload;
    selectedTrade: TradeEvent | null;
    onCloseSelection?: () => void;
}

export function CoachPanel({ coachFacts, selectedTrade, onCloseSelection }: CoachPanelProps) {
    // If no trade selected, show session overview
    const showOverview = !selectedTrade;

    return (
        <div className="flex h-full w-full flex-col bg-temper-bg border-l border-temper-border overflow-y-auto p-6 scrollbar-thin">
            <AnimatePresence mode='wait'>
                {showOverview ? (
                    <motion.div
                        key="overview"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        className="space-y-6"
                    >
                        {/* Header / Temper Score */}
                        <div className="flex flex-col items-center justify-center space-y-2 py-8 border-b border-temper-border">
                            <div className="relative flex h-32 w-32 items-center justify-center rounded-full border-4 border-temper-gold bg-temper-gold/10 pulse-glow-temper-gold">
                                <span className="text-4xl font-black text-temper-gold font-mono">{coachFacts.overview.temperScore}</span>
                                <div className="absolute top-0 right-0 h-4 w-4 rounded-full bg-temper-gold shadow-[0_0_10px_rgba(249,199,79,0.8)] animate-pulse" />
                            </div>
                            <h2 className="text-xl font-bold font-coach text-white uppercase tracking-wide">Temper Score</h2>
                            <div className="flex items-center justify-center space-x-4 text-sm text-temper-muted">
                                <span>ELO: <span className="font-mono text-white">{coachFacts.overview.eloBefore} → {coachFacts.overview.eloAfter}</span></span>
                                <span className="text-temper-teal font-bold font-mono">(+{coachFacts.overview.eloAfter - coachFacts.overview.eloBefore})</span>
                            </div>
                        </div>

                        {/* Coach Commentary Bubble */}
                        <div className="relative mx-4 rounded-2xl bg-[#0EA5E9] text-white p-6 shadow-lg transform -translate-y-2 z-10 transition-transform hover:scale-105 duration-300">
                            <div className="absolute -top-3 left-8 h-6 w-6 rotate-45 bg-[#0EA5E9]" />
                            <div className="flex items-start space-x-4">
                                <div className="h-12 w-12 flex-shrink-0 rounded-full bg-white/20 flex items-center justify-center text-2xl animate-bounce-slow">
                                    🤖
                                </div>
                                <div>
                                    <h3 className="font-bold text-xl font-coach mb-1">Coach Temper says:</h3>
                                    <p className="text-base font-medium leading-relaxed opacity-90">{coachFacts.coachText.intro}</p>
                                </div>
                            </div>
                        </div>

                        {/* Strengths & Weaknesses */}
                        <div className="grid grid-cols-1 gap-4 px-4">
                            <div className="rounded-xl border border-temper-teal/30 bg-temper-teal/5 p-4">
                                <h4 className="flex items-center text-sm font-bold text-temper-teal mb-2 uppercase tracking-wide">
                                    <span className="mr-2 text-lg">👍</span> Strengths
                                </h4>
                                <ul className="list-disc list-inside space-y-2 text-sm text-temper-text/80">
                                    {coachFacts.coachText.strengths.map((s, i) => <li key={i}>{s}</li>)}
                                </ul>
                            </div>
                            <div className="rounded-xl border border-temper-red/30 bg-temper-red/5 p-4">
                                <h4 className="flex items-center text-sm font-bold text-temper-red mb-2 uppercase tracking-wide">
                                    <span className="mr-2 text-lg">👎</span> Weaknesses
                                </h4>
                                <ul className="list-disc list-inside space-y-2 text-sm text-temper-text/80">
                                    {coachFacts.coachText.weaknesses.map((w, i) => <li key={i}>{w}</li>)}
                                </ul>
                            </div>
                        </div>

                        {/* Biases Summary */}
                        <div className="px-4 pb-8">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-temper-muted mb-4 font-coach">Emotional Biases Detected</h4>
                            <div className="space-y-4">
                                {coachFacts.biases.map((bias) => {
                                    const biasColor = `var(--color-bias-${bias.type.toLowerCase().replace('_', '')})`;
                                    return (
                                        <div key={bias.type} className="group">
                                            <div className="flex justify-between text-xs mb-1 font-medium">
                                                <span className="text-temper-text capitalize">{bias.type.replace('_', ' ').toLowerCase()}</span>
                                                <span className="text-temper-muted font-mono">{bias.score}/100</span>
                                            </div>
                                            <div className="h-2 w-full rounded-full bg-temper-subtle overflow-hidden">
                                                <div
                                                    className="h-full rounded-full transition-all duration-1000 ease-out"
                                                    style={{ width: `${bias.score}%`, backgroundColor: biasColor }}
                                                />
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>

                    </motion.div>
                ) : (
                    <motion.div
                        key="trade-detail"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        className="space-y-6"
                    >
                        <button
                            onClick={onCloseSelection}
                            className="text-xs text-temper-muted hover:text-temper-teal transition-colors mb-2 flex items-center font-medium font-coach uppercase tracking-wider px-4"
                        >
                            ← Back to Overview
                        </button>

                        {/* Classification Header */}
                        <div className="flex flex-col items-center justify-center space-y-3 py-8 border-b border-temper-border bg-temper-subtle/50 rounded-xl relative overflow-hidden mx-4 shadow-inner">
                            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/40 pointer-events-none" />
                            <DecisionBadge
                                label={selectedTrade.label}
                                symbolCode={selectedTrade.symbolCode}
                                size="lg"
                                className="scale-150 shadow-2xl z-10"
                            />
                            <div className="z-10 text-center mt-4">
                                <h2 className="text-3xl font-black font-coach text-white tracking-wide uppercase drop-shadow-md">{selectedTrade.label}</h2>
                                <p className="text-sm font-mono text-temper-muted mt-2">
                                    <span className={selectedTrade.side === 'BUY' ? 'text-temper-teal font-bold' : 'text-temper-red font-bold'}>{selectedTrade.side}</span> {selectedTrade.symbol}
                                    <span className="mx-2 text-temper-border">|</span>
                                    {selectedTrade.timestamp.split('T')[1].split('.')[0]}
                                </p>
                            </div>
                        </div>

                        {/* Coach Reaction */}
                        <div className="relative mx-4 rounded-2xl bg-[#0EA5E9] text-white p-6 shadow-lg border border-[#0EA5E9]/50">
                            <div className="absolute -top-3 right-8 h-6 w-6 rotate-45 bg-[#0EA5E9]" />
                            <div className="flex items-start space-x-4">
                                <div className="h-12 w-12 flex-shrink-0 rounded-full bg-white/20 flex items-center justify-center shadow-lg">
                                    <span className="text-2xl">🎓</span>
                                </div>
                                <div>
                                    <h3 className="font-bold text-xl font-coach mb-1">Coach Insight</h3>
                                    <p className="text-base font-medium leading-relaxed opacity-95">
                                        "{generateTradeCommentary(selectedTrade)}"
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Trade Stats Grid */}
                        <div className="grid grid-cols-2 gap-3 px-4">
                            <StatBox label="Qty" value={selectedTrade.qty} />
                            <StatBox label="Price" value={selectedTrade.price.toFixed(2)} />
                            <StatBox
                                label="Realized PnL"
                                value={selectedTrade.realizedPnl.toFixed(2)}
                                valueClass={selectedTrade.realizedPnl > 0 ? 'text-temper-teal' : selectedTrade.realizedPnl < 0 ? 'text-temper-red' : 'text-temper-text'}
                            />
                            <StatBox
                                label="Running PnL"
                                value={selectedTrade.runningPnl.toFixed(2)}
                                valueClass={selectedTrade.runningPnl > 0 ? 'text-temper-teal' : selectedTrade.runningPnl < 0 ? 'text-temper-red' : 'text-temper-text'}
                            />
                        </div>

                        {/* Psychology Tags */}
                        <div className="px-4 pb-8">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-temper-muted mb-3 font-coach">Psychological Factors</h4>
                            <div className="flex flex-wrap gap-2">
                                {selectedTrade.reasons.map(reason => (
                                    <span key={reason} className="px-3 py-1 rounded-full bg-temper-subtle border border-temper-border text-xs text-temper-text font-medium shadow-sm hover:border-temper-teal/50 transition-colors cursor-help" title="Click for definition">
                                        {reason}
                                    </span>
                                ))}
                                {selectedTrade.reasons.length === 0 && (
                                    <span className="text-xs text-temper-muted italic">No specific biases detected.</span>
                                )}
                            </div>
                        </div>

                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

function StatBox({ label, value, valueClass = 'text-temper-text' }: { label: string, value: string | number, valueClass?: string }) {
    return (
        <div className="bg-temper-subtle p-3 rounded-lg border border-temper-border shadow-sm group hover:border-temper-muted/30 transition-colors">
            <div className="text-[10px] text-temper-muted uppercase tracking-widest mb-1 group-hover:text-temper-teal transition-colors">{label}</div>
            <div className={`text-lg font-mono font-medium ${valueClass}`}>{value}</div>
        </div>
    );
}

function generateTradeCommentary(trade: TradeEvent): string {
    const pnlText = trade.realizedPnl > 0 ? 'locked in a profit' : 'took a loss';

    if (trade.label === 'BLUNDER') return `This was a tough spot. You ${pnlText}, but the decision process showed signs of tilt.`;
    if (trade.label === 'BRILLIANT') return `Outstanding execution! You ${pnlText} and followed your plan perfectly despite the pressure.`;

    if (trade.reasons.includes('Revenge Trading')) return `Careful here. This looks like a revenge trade attempt to recover losses quickly.`;

    return `You ${pnlText} of ${trade.realizedPnl}. This move was rated as ${trade.label.toLowerCase()}.`;
}
