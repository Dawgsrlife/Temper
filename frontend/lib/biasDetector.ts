// Bias Detection Types and Utilities for Temper
// This module analyzes trading data to detect behavioral biases

export interface Trade {
    timestamp: string;
    asset: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    price?: number;
    pnl?: number;
}

export interface BiasDetection {
    type: 'OVERTRADING' | 'LOSS_AVERSION' | 'REVENGE_TRADING' | 'FOMO' | 'DISCIPLINE_BREAK';
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    confidence: number; // 0-100
    description: string;
    tradeIndices: number[];
    recommendation: string;
}

export interface TradeWithAnalysis extends Trade {
    index: number;
    label: 'BRILLIANT' | 'EXCELLENT' | 'GOOD' | 'NEUTRAL' | 'INACCURACY' | 'MISTAKE' | 'BLUNDER';
    biases: BiasDetection[];
    timeSinceLast: number; // seconds
    sessionPnL: number;
    isWinner: boolean;
    annotation: string;
}

export interface SessionAnalysis {
    trades: TradeWithAnalysis[];
    biases: BiasDetection[];
    disciplineScore: number; // 0-100
    psychologicalPnL: {
        strategyPnL: number;
        emotionalCost: number;
        potentialPnL: number;
    };
    summary: {
        totalPnL: number;
        totalTrades: number;
        winners: number;
        losers: number;
        winRate: number;
        avgWin: number;
        avgLoss: number;
        avgTradeInterval: number;
        tradingDuration: number;
        netPnL: number;
        biasBreakdown: Record<string, number>;
    };
    recommendations: string[];
    patterns: {
        name: string;
        count: number;
        impact: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
    }[];
}

// Main analysis function
export function analyzeSession(trades: Trade[]): SessionAnalysis {
    if (trades.length === 0) {
        return {
            trades: [],
            biases: [],
            disciplineScore: 100,
            psychologicalPnL: { strategyPnL: 0, emotionalCost: 0, potentialPnL: 0 },
            summary: {
                totalPnL: 0,
                totalTrades: 0,
                winners: 0,
                losers: 0,
                winRate: 0,
                avgWin: 0,
                avgLoss: 0,
                avgTradeInterval: 0,
                tradingDuration: 0,
                netPnL: 0,
                biasBreakdown: {},
            },
            recommendations: [],
            patterns: [],
        };
    }

    // Detect biases
    const biases: BiasDetection[] = [];

    const overtrading = detectOvertrading(trades);
    if (overtrading) biases.push(overtrading);

    const revenge = detectRevengeTading(trades);
    if (revenge) biases.push(revenge);

    const lossAversion = detectLossAversion(trades);
    if (lossAversion) biases.push(lossAversion);

    // Analyze each trade
    let sessionPnL = 0;
    let strategyPnL = 0;
    let emotionalCost = 0;

    const analyzedTrades: TradeWithAnalysis[] = trades.map((trade, index) => {
        const pnl = trade.pnl !== undefined ? trade.pnl : (Math.random() > 0.45 ? Math.random() * 200 : -Math.random() * 150);
        sessionPnL += pnl;

        const timeSinceLast = index > 0
            ? (new Date(trade.timestamp).getTime() - new Date(trades[index - 1].timestamp).getTime()) / 1000
            : 300;

        const tradeBiases = biases.filter(b => b.tradeIndices.includes(index));
        const label = labelTrade(trades, index, biases);

        // Psychological P&L Logic
        const isBiasDriven = tradeBiases.length > 0;
        if (isBiasDriven && pnl < 0) {
            emotionalCost += Math.abs(pnl);
        } else {
            // Even if bias driven, if it made money, we count it as "strategy" for now to be generous, 
            // or we could split it. Let's keep it simple: only losses from bias are "Emotional Cost".
            strategyPnL += pnl;
        }

        return {
            ...trade,
            index,
            label,
            biases: tradeBiases,
            timeSinceLast,
            sessionPnL,
            isWinner: pnl > 0,
            pnl,
            annotation: generateAnnotation(trade, label, tradeBiases),
        };
    });

    // Calculate summary
    const winners = analyzedTrades.filter(t => t.isWinner).length;
    const losers = analyzedTrades.length - winners;
    const winRate = trades.length > 0 ? (winners / trades.length) * 100 : 0;

    // Avg Win/Loss
    const winningTrades = analyzedTrades.filter(t => t.isWinner);
    const losingTrades = analyzedTrades.filter(t => !t.isWinner);
    const avgWin = winningTrades.length > 0 ? winningTrades.reduce((a, t) => a + (t.pnl || 0), 0) / winningTrades.length : 0;
    const avgLoss = losingTrades.length > 0 ? losingTrades.reduce((a, t) => a + (t.pnl || 0), 0) / losingTrades.length : 0;

    const intervals: number[] = [];
    for (let i = 1; i < trades.length; i++) {
        const t1 = new Date(trades[i - 1].timestamp).getTime();
        const t2 = new Date(trades[i].timestamp).getTime();
        intervals.push((t2 - t1) / 1000);
    }

    const avgInterval = intervals.length > 0
        ? intervals.reduce((a, b) => a + b, 0) / intervals.length
        : 0;

    const firstTime = new Date(trades[0].timestamp).getTime();
    const lastTime = new Date(trades[trades.length - 1].timestamp).getTime();
    const tradingDuration = (lastTime - firstTime) / 1000 / 60; // minutes

    // Calculate discipline score
    let disciplineScore = 100;
    biases.forEach(b => {
        switch (b.severity) {
            case 'CRITICAL': disciplineScore -= 25; break;
            case 'HIGH': disciplineScore -= 15; break;
            case 'MEDIUM': disciplineScore -= 8; break;
            case 'LOW': disciplineScore -= 3; break;
        }
    });
    disciplineScore = Math.max(0, disciplineScore);

    // Bias breakdown
    const biasBreakdown: Record<string, number> = {};
    biases.forEach(b => {
        biasBreakdown[b.type] = (biasBreakdown[b.type] || 0) + 1;
    });

    // Generate recommendations
    const recommendations = biases.map(b => b.recommendation);
    if (disciplineScore > 80) {
        recommendations.push('Great discipline! Continue following your trading plan.');
    }

    // Identify patterns
    const patterns: SessionAnalysis['patterns'] = [];
    if (overtrading) {
        patterns.push({ name: 'Rapid Fire Trading', count: overtrading.tradeIndices.length, impact: 'NEGATIVE' });
    }
    if (revenge) {
        patterns.push({ name: 'Revenge Sequence', count: revenge.tradeIndices.length, impact: 'NEGATIVE' });
    }
    if (avgInterval > 300) {
        patterns.push({ name: 'Patience', count: 1, impact: 'POSITIVE' });
    }

    return {
        trades: analyzedTrades,
        biases,
        disciplineScore,
        psychologicalPnL: {
            strategyPnL,
            emotionalCost,
            potentialPnL: sessionPnL + emotionalCost
        },
        summary: {
            totalPnL: sessionPnL,
            totalTrades: trades.length,
            winners,
            losers,
            winRate,
            avgWin,
            avgLoss,
            avgTradeInterval: avgInterval,
            tradingDuration,
            netPnL: sessionPnL,
            biasBreakdown,
        },
        recommendations,
        patterns,
    };
}

// Parse CSV data
export function parseCSV(csv: string): Trade[] {
    const lines = csv.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());

    return lines.slice(1).map(line => {
        const values = line.split(',');
        return {
            timestamp: values[headers.indexOf('timestamp')]?.trim() || '',
            asset: values[headers.indexOf('asset')]?.trim() || 'UNKNOWN',
            side: (values[headers.indexOf('side')]?.trim().toUpperCase() || 'BUY') as 'BUY' | 'SELL',
            quantity: parseFloat(values[headers.indexOf('quantity')] || '0'),
            pnl: headers.indexOf('pnl') !== -1 ? parseFloat(values[headers.indexOf('pnl')] || '0') : undefined,
            price: headers.indexOf('price') !== -1 ? parseFloat(values[headers.indexOf('price')] || '0') : undefined,
        };
    }).filter(t => t.timestamp);
}

// Detect Overtrading
function detectOvertrading(trades: Trade[]): BiasDetection | null {
    if (trades.length < 5) return null;

    // Calculate average time between trades
    const intervals: number[] = [];
    for (let i = 1; i < trades.length; i++) {
        const t1 = new Date(trades[i - 1].timestamp).getTime();
        const t2 = new Date(trades[i].timestamp).getTime();
        intervals.push((t2 - t1) / 1000); // seconds
    }

    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const rapidTrades = intervals.filter(i => i < 120).length; // trades within 2 min

    if (rapidTrades > trades.length * 0.3) {
        const severity = rapidTrades > trades.length * 0.5 ? 'CRITICAL' :
            rapidTrades > trades.length * 0.4 ? 'HIGH' : 'MEDIUM';

        return {
            type: 'OVERTRADING',
            severity,
            confidence: Math.min(95, 60 + rapidTrades * 2),
            description: `${rapidTrades} trades executed within 2 minutes of the previous trade. Average interval: ${Math.round(avgInterval)}s`,
            tradeIndices: intervals.map((int, i) => int < 120 ? i + 1 : -1).filter(i => i !== -1),
            recommendation: 'Set a mandatory 5-minute cooldown between trades. Consider using a trading journal to document decision rationale before each entry.',
        };
    }

    return null;
}

// Detect Revenge Trading
function detectRevengeTading(trades: Trade[]): BiasDetection | null {
    const revengeTrades: number[] = [];
    let consecutiveLosses = 0;
    let lastPnL = 0;

    for (let i = 0; i < trades.length; i++) {
        const pnl = trades[i].pnl || (Math.random() > 0.5 ? 100 : -100); // simulate if not provided

        if (pnl < 0) {
            consecutiveLosses++;
            // Check if next trade is made quickly after a loss
            if (i < trades.length - 1) {
                const t1 = new Date(trades[i].timestamp).getTime();
                const t2 = new Date(trades[i + 1].timestamp).getTime();
                const interval = (t2 - t1) / 1000;

                if (interval < 60 && consecutiveLosses >= 2) {
                    revengeTrades.push(i + 1);
                }
            }
        } else {
            consecutiveLosses = 0;
        }
        lastPnL = pnl;
    }

    if (revengeTrades.length > 0) {
        const severity = revengeTrades.length >= 5 ? 'CRITICAL' :
            revengeTrades.length >= 3 ? 'HIGH' : 'MEDIUM';

        return {
            type: 'REVENGE_TRADING',
            severity,
            confidence: Math.min(90, 50 + revengeTrades.length * 10),
            description: `Detected ${revengeTrades.length} potential revenge trades - rapid entries following losses.`,
            tradeIndices: revengeTrades,
            recommendation: 'After any loss, take a 15-minute break. Document the loss and identify what went wrong before considering another trade.',
        };
    }

    return null;
}

// Detect Loss Aversion
function detectLossAversion(trades: Trade[]): BiasDetection | null {
    // Look for patterns of holding losers too long or cutting winners too short
    const lossAversionIndicators: number[] = [];

    // Analyze position sizing after losses
    let prevQuantity = 0;
    let afterLossReduction = 0;

    for (let i = 1; i < trades.length; i++) {
        const prevPnL = trades[i - 1].pnl || 0;
        const currQuantity = trades[i].quantity;

        if (prevPnL < 0 && currQuantity < prevQuantity * 0.7) {
            afterLossReduction++;
            lossAversionIndicators.push(i);
        }

        prevQuantity = currQuantity;
    }

    if (afterLossReduction > 2) {
        return {
            type: 'LOSS_AVERSION',
            severity: afterLossReduction > 5 ? 'HIGH' : 'MEDIUM',
            confidence: Math.min(85, 40 + afterLossReduction * 8),
            description: `Position sizing reduced significantly after ${afterLossReduction} losses, suggesting fear-based decision making.`,
            tradeIndices: lossAversionIndicators,
            recommendation: 'Develop a fixed position sizing strategy independent of recent P/L. Consider using percentage-based risk management.',
        };
    }

    return null;
}

// Label a trade based on context
function labelTrade(trades: Trade[], index: number, biases: BiasDetection[]): TradeWithAnalysis['label'] {
    const trade = trades[index];
    const tradeInBias = biases.some(b => b.tradeIndices.includes(index));
    const biasSeverity = biases
        .filter(b => b.tradeIndices.includes(index))
        .map(b => b.severity);

    if (biasSeverity.includes('CRITICAL')) return 'BLUNDER';
    if (biasSeverity.includes('HIGH')) return 'MISTAKE';
    if (biasSeverity.includes('MEDIUM')) return 'INACCURACY';

    // Check for good patterns
    const timeSinceLast = index > 0
        ? (new Date(trade.timestamp).getTime() - new Date(trades[index - 1].timestamp).getTime()) / 1000
        : 300;

    if (timeSinceLast > 300 && !tradeInBias) return 'EXCELLENT';
    if (!tradeInBias) return 'GOOD';

    return 'NEUTRAL';
}

// Generate annotation for trade
function generateAnnotation(trade: Trade, label: TradeWithAnalysis['label'], biases: BiasDetection[]): string {
    const relevantBiases = biases.filter(b => b.tradeIndices.includes(0));

    switch (label) {
        case 'BRILLIANT':
            return 'Perfect execution. Followed the plan with discipline.';
        case 'EXCELLENT':
            return 'Well-timed entry with proper position sizing. Good patience displayed.';
        case 'GOOD':
            return 'Solid trade following established rules.';
        case 'NEUTRAL':
            return 'Neither particularly good nor bad execution.';
        case 'INACCURACY':
            return 'Slight deviation from optimal strategy. Review timing and sizing.';
        case 'MISTAKE':
            return 'Clear error in judgment. Emotional influence detected.';
        case 'BLUNDER':
            return 'Severe discipline breakdown. This trade shows clear bias-driven behavior.';
        default:
            return '';
    }
}



// Trader profiles from datasets
export type TraderProfile = 'calm_trader' | 'loss_averse_trader' | 'overtrader' | 'revenge_trader';

export const TRADER_PROFILES: Record<TraderProfile, { name: string; description: string; color: string }> = {
    calm_trader: {
        name: 'Calm Trader',
        description: 'Exhibits disciplined trading behavior with proper interval between trades.',
        color: '#06D6A0',
    },
    loss_averse_trader: {
        name: 'Loss Averse',
        description: 'Shows fear-based patterns, reducing risk after losses.',
        color: '#8B5CF6',
    },
    overtrader: {
        name: 'Overtrader',
        description: 'Trades too frequently, often without clear rationale.',
        color: '#F97316',
    },
    revenge_trader: {
        name: 'Revenge Trader',
        description: 'Immediately re-enters after losses to recover.',
        color: '#EF476F',
    },
};
