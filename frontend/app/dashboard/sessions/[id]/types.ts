export type DecisionLabel =
    | 'BRILLIANT'
    | 'GREAT'
    | 'BEST'
    | 'EXCELLENT'
    | 'GOOD'
    | 'INACCURACY'
    | 'MISTAKE'
    | 'MISS'
    | 'BLUNDER'
    | 'MEGABLUNDER'
    | 'BOOK'
    | 'FORCED'
    | 'INTERESTING'
    | 'ABANDON'
    | 'CHECKMATED'
    | 'WINNER'
    | 'DRAW'
    | 'RESIGN'
    | 'TIMEOUT';

export interface TradeEvent {
    id: string;
    index: number;
    timestamp: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    qty: number;
    price: number;
    realizedPnl: number;
    runningPnl: number;
    label: DecisionLabel;
    symbolCode: '!!' | '!' | '★' | '✓' | '+' | '?!' | '?' | '⨯' | '??' | '???' | '📖' | '□' | '!?' | '#' | '♔' | '½' | '⊘';
    reasons: string[];
}

export interface BiasScore {
    type: 'OVERTRADING' | 'LOSS_AVERSION' | 'REVENGE_TRADING' | 'FOMO' | 'GREED';
    score: number;
}

export interface TemperReport {
    id: string;
    date: string;
    temperScore: number;
    decisionEloBefore: number;
    decisionEloAfter: number;
    trades: TradeEvent[];
    biases: BiasScore[];
    disciplinedReplay: {
        actualPnl: number;
        disciplinedPnl: number;
        savedPnl: number;
        rulesViolated: number;
    };
    summary: {
        totalTrades: number;
        winRate: number;
        grossPnl: number;
        maxDrawdown: number;
        dominantBias: string | null;
    };
}

export interface CoachFactsPayload {
    overview: {
        date: string;
        temperScore: number;
        eloBefore: number;
        eloAfter: number;
        totalTrades: number;
        grossPnl: number;
        maxDrawdown: number;
    };
    biases: BiasScore[];
    labelSummary: {
        label: DecisionLabel;
        count: number;
        percentage: number;
    }[];
    keyEvents: {
        tradeId: string;
        index: number;
        timestamp: string;
        label: DecisionLabel;
        symbolCode: string;
        reasons: string[];
        pnl: number;
    }[];
    tiltSequences: {
        id: string;
        startIndex: number;
        endIndex: number;
        durationMinutes: number;
        dominantBias: string;
    }[];
    disciplinedReplay: {
        actualPnl: number;
        disciplinedPnl: number;
        savedPnl: number;
    };
    coachText: {
        intro: string;
        strengths: string[];
        weaknesses: string[];
        suggestions: string[];
    };
}
