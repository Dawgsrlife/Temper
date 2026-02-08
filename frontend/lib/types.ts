// ─────────────────────────────────────────────────────────────
// Temper – Core Domain Types
// ─────────────────────────────────────────────────────────────
// Every metric, label, and score is deterministic and
// reproducible for a given CSV input. The AI/LLM layer is only
// allowed to consume the CoachFactsPayload for explanation.
// ─────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════
//  ENUMS
// ═══════════════════════════════════════════════════════════════

export enum BiasType {
  OVERTRADING = "OVERTRADING",
  LOSS_AVERSION = "LOSS_AVERSION",
  REVENGE_TRADING = "REVENGE_TRADING",
  FOMO = "FOMO",
  GREED = "GREED",
}

/**
 * Decision labels modeled after chess.com's move classification.
 * Ordered from best to worst behavioral quality,
 * then special classifications, then session results.
 */
export enum DecisionLabel {
  // ── Trade grades (best → worst) ──
  BRILLIANT = "BRILLIANT",
  GREAT = "GREAT",
  BEST = "BEST",
  EXCELLENT = "EXCELLENT",
  GOOD = "GOOD",
  INACCURACY = "INACCURACY",
  MISTAKE = "MISTAKE",
  MISS = "MISS",
  BLUNDER = "BLUNDER",
  MEGABLUNDER = "MEGABLUNDER",
  // ── Special classifications ──
  BOOK = "BOOK",
  FORCED = "FORCED",
  INTERESTING = "INTERESTING",
  // ── Session results ──
  CHECKMATED = "CHECKMATED",
  WINNER = "WINNER",
  DRAW = "DRAW",
  RESIGN = "RESIGN",
}

export enum TradeSide {
  LONG = "LONG",
  SHORT = "SHORT",
}

// ═══════════════════════════════════════════════════════════════
//  CONSTANTS — symbols, score weights, ELO values
// ═══════════════════════════════════════════════════════════════

/** Chess-style symbols for UI rendering. */
export const DECISION_SYMBOLS: Record<DecisionLabel, string> = {
  [DecisionLabel.BRILLIANT]: "!!",
  [DecisionLabel.GREAT]: "!",
  [DecisionLabel.BEST]: "★",
  [DecisionLabel.EXCELLENT]: "✓",
  [DecisionLabel.GOOD]: "+",
  [DecisionLabel.BOOK]: "📖",
  [DecisionLabel.FORCED]: "□",
  [DecisionLabel.INTERESTING]: "!?",
  [DecisionLabel.INACCURACY]: "?!",
  [DecisionLabel.MISTAKE]: "?",
  [DecisionLabel.MISS]: "⨯",
  [DecisionLabel.BLUNDER]: "??",
  [DecisionLabel.MEGABLUNDER]: "???",
  [DecisionLabel.CHECKMATED]: "#",
  [DecisionLabel.WINNER]: "♔",
  [DecisionLabel.DRAW]: "½",
  [DecisionLabel.RESIGN]: "⊘",
};

/**
 * Per-trade score contribution on a 0–10 scale.
 * The Temper Score averages these and scales to 0–100.
 */
export const DECISION_SCORE_WEIGHTS: Record<DecisionLabel, number> = {
  [DecisionLabel.BRILLIANT]: 10,
  [DecisionLabel.GREAT]: 9.5,
  [DecisionLabel.BEST]: 9,
  [DecisionLabel.EXCELLENT]: 8.5,
  [DecisionLabel.GOOD]: 7.5,
  [DecisionLabel.BOOK]: 8,
  [DecisionLabel.FORCED]: 6,
  [DecisionLabel.INTERESTING]: 7,
  [DecisionLabel.INACCURACY]: 5,
  [DecisionLabel.MISTAKE]: 3,
  [DecisionLabel.MISS]: 4,
  [DecisionLabel.BLUNDER]: 0,
  [DecisionLabel.MEGABLUNDER]: 0,
  [DecisionLabel.CHECKMATED]: 1,
  [DecisionLabel.WINNER]: 9,
  [DecisionLabel.DRAW]: 5,
  [DecisionLabel.RESIGN]: 2,
};

/**
 * ELO performance value per trade (0.0 – 1.0).
 * Session performance = mean of these across all trades.
 */
export const DECISION_ELO_VALUES: Record<DecisionLabel, number> = {
  [DecisionLabel.BRILLIANT]: 1.0,
  [DecisionLabel.GREAT]: 0.95,
  [DecisionLabel.BEST]: 0.9,
  [DecisionLabel.EXCELLENT]: 0.85,
  [DecisionLabel.GOOD]: 0.75,
  [DecisionLabel.BOOK]: 0.8,
  [DecisionLabel.FORCED]: 0.6,
  [DecisionLabel.INTERESTING]: 0.7,
  [DecisionLabel.INACCURACY]: 0.5,
  [DecisionLabel.MISTAKE]: 0.3,
  [DecisionLabel.MISS]: 0.4,
  [DecisionLabel.BLUNDER]: 0.0,
  [DecisionLabel.MEGABLUNDER]: 0.0,
  [DecisionLabel.CHECKMATED]: 0.1,
  [DecisionLabel.WINNER]: 0.95,
  [DecisionLabel.DRAW]: 0.5,
  [DecisionLabel.RESIGN]: 0.2,
};

/**
 * UI color mapping for decision labels (Tailwind class names).
 */
export const DECISION_COLORS: Record<DecisionLabel, string> = {
  [DecisionLabel.BRILLIANT]: "text-cyan-400",
  [DecisionLabel.GREAT]: "text-teal-400",
  [DecisionLabel.BEST]: "text-emerald-400",
  [DecisionLabel.EXCELLENT]: "text-green-400",
  [DecisionLabel.GOOD]: "text-green-300",
  [DecisionLabel.BOOK]: "text-blue-400",
  [DecisionLabel.FORCED]: "text-purple-400",
  [DecisionLabel.INTERESTING]: "text-amber-400",
  [DecisionLabel.INACCURACY]: "text-yellow-400",
  [DecisionLabel.MISTAKE]: "text-orange-400",
  [DecisionLabel.MISS]: "text-gray-400",
  [DecisionLabel.BLUNDER]: "text-red-500",
  [DecisionLabel.MEGABLUNDER]: "text-red-700",
  [DecisionLabel.CHECKMATED]: "text-rose-600",
  [DecisionLabel.WINNER]: "text-yellow-300",
  [DecisionLabel.DRAW]: "text-slate-400",
  [DecisionLabel.RESIGN]: "text-stone-500",
};

export const DECISION_BG_COLORS: Record<DecisionLabel, string> = {
  [DecisionLabel.BRILLIANT]: "bg-cyan-400/15",
  [DecisionLabel.GREAT]: "bg-teal-400/15",
  [DecisionLabel.BEST]: "bg-emerald-400/15",
  [DecisionLabel.EXCELLENT]: "bg-green-400/15",
  [DecisionLabel.GOOD]: "bg-green-300/10",
  [DecisionLabel.BOOK]: "bg-blue-400/10",
  [DecisionLabel.FORCED]: "bg-purple-400/10",
  [DecisionLabel.INTERESTING]: "bg-amber-400/10",
  [DecisionLabel.INACCURACY]: "bg-yellow-400/10",
  [DecisionLabel.MISTAKE]: "bg-orange-400/10",
  [DecisionLabel.MISS]: "bg-gray-400/10",
  [DecisionLabel.BLUNDER]: "bg-red-500/15",
  [DecisionLabel.MEGABLUNDER]: "bg-red-700/15",
  [DecisionLabel.CHECKMATED]: "bg-rose-600/15",
  [DecisionLabel.WINNER]: "bg-yellow-300/15",
  [DecisionLabel.DRAW]: "bg-slate-400/10",
  [DecisionLabel.RESIGN]: "bg-stone-500/10",
};

// ═══════════════════════════════════════════════════════════════
//  REASON CODES
// ═══════════════════════════════════════════════════════════════

export type ReasonCode =
  // Negative
  | "OVERTRADE_CLUSTER"
  | "REVENGE_AFTER_BIG_LOSS"
  | "SIZE_SPIKE_AFTER_STREAK"
  | "FOMO_LATE_ENTRY"
  | "FOMO_CHASING_MOMENTUM"
  | "LOSS_HELD_TOO_LONG"
  | "GREED_NO_PROFIT_TAKE"
  | "GREED_SIZE_INCREASE"
  | "EMOTIONAL_ENTRY"
  | "TILT_SEQUENCE"
  | "MAX_LOSS_BREACH"
  | "RULE_VIOLATION"
  // Positive
  | "DISCIPLINED_EXIT"
  | "FOLLOWED_PLAN"
  | "CLEAN_RISK_MANAGEMENT"
  | "PERFECT_EXECUTION"
  | "STRONG_UNDER_PRESSURE"
  // Neutral
  | "MINOR_TIMING_DEVIATION"
  | "SLIGHT_OVERSIZE";

// ═══════════════════════════════════════════════════════════════
//  TRADE TYPES
// ═══════════════════════════════════════════════════════════════

/** Raw trade as parsed from CSV, before enrichment. */
export interface RawTrade {
  timestamp: string; // ISO 8601
  symbol: string;
  side: TradeSide;
  quantity: number;
  price: number;
  pnl: number;
  tags: string[];
}

/** Enriched trade with computed derived fields. */
export interface Trade extends RawTrade {
  id: string; // generated deterministic UUID
  index: number; // position in session (0-based)
  timestampMs: number; // parsed epoch ms
  runningPnl: number; // cumulative P/L including this trade
  runningTradeCount: number; // 1-based count at this point
  drawdownFromPeak: number; // how far below peak P/L (always <= 0)
  peakPnlAtTrade: number; // peak cumulative P/L at or before this trade
  timeSinceLastTradeMs: number | null; // ms since previous trade (null for first)
  sizeRelativeToBaseline: number; // quantity / baseline avg size (1.0 = normal)
  isWin: boolean;
  rMultiple: number | null; // pnl / avgRisk if computable
}

// ═══════════════════════════════════════════════════════════════
//  SESSION TYPES
// ═══════════════════════════════════════════════════════════════

/** A reconstructed trading session (typically one day). */
export interface Session {
  id: string;
  userId: string;
  date: string; // YYYY-MM-DD
  trades: Trade[];
  // ── Aggregate stats ──
  totalPnl: number;
  maxDrawdown: number; // worst peak-to-trough (always <= 0)
  maxRunup: number; // best trough-to-peak
  tradeCount: number;
  winCount: number;
  lossCount: number;
  winRate: number; // 0.0 – 1.0
  avgWin: number;
  avgLoss: number; // negative number
  profitFactor: number; // gross_wins / |gross_losses|, Infinity if no losses
  largestWin: number;
  largestLoss: number; // negative
  avgHoldingTimeMs: number;
  avgWinHoldingTimeMs: number;
  avgLossHoldingTimeMs: number;
  peakPnl: number;
  symbols: string[];
  durationMs: number; // first trade to last trade
  avgPositionSize: number;
}

// ═══════════════════════════════════════════════════════════════
//  BIAS TYPES
// ═══════════════════════════════════════════════════════════════

/** Bias scores for a session, each 0–100. */
export interface BiasScores {
  [BiasType.OVERTRADING]: number;
  [BiasType.LOSS_AVERSION]: number;
  [BiasType.REVENGE_TRADING]: number;
  [BiasType.FOMO]: number;
  [BiasType.GREED]: number;
  /** Weighted average of all bias scores, 0–100. */
  aggregate: number;
}

/** Detailed breakdown for a single bias. */
export interface BiasDetail {
  type: BiasType;
  score: number; // 0–100
  metrics: Record<string, number>; // raw metric values used
  triggeredRules: string[]; // human-readable rule descriptions
}

// ═══════════════════════════════════════════════════════════════
//  DECISION EVENTS
// ═══════════════════════════════════════════════════════════════

/** Per-trade or per-segment decision classification. */
export interface DecisionEvent {
  tradeId: string;
  tradeIndex: number;
  label: DecisionLabel;
  symbol: string; // chess-style symbol from DECISION_SYMBOLS
  reasons: ReasonCode[];
  scoreContribution: number; // from DECISION_SCORE_WEIGHTS
  eloValue: number; // from DECISION_ELO_VALUES
  /** Deterministic engine explanation (NOT from LLM). */
  explanation: string;
}

// ═══════════════════════════════════════════════════════════════
//  TEMPER SCORE
// ═══════════════════════════════════════════════════════════════

/**
 * Day-level discipline score, 0–100.
 *
 * Formula:
 *   rawScore     = mean(DECISION_SCORE_WEIGHTS[label] for each trade) × 10
 *   biasPenalty  = (sum(biasScores) / 500) × 20   → max 20 pts off
 *   value        = clamp(rawScore − biasPenalty, 0, 100)
 */
export interface TemperScore {
  value: number; // final 0–100
  rawScore: number; // before bias penalty
  biasPenalty: number; // points deducted (0–20)
  tradeScoreAvg: number; // mean of per-trade weights (0–10)
  labelDistribution: Record<DecisionLabel, number>; // count per label
}

// ═══════════════════════════════════════════════════════════════
//  DECISION ELO
// ═══════════════════════════════════════════════════════════════

/**
 * ELO-like rating for a trader's decision quality over time.
 *
 * Starting rating:  1200
 * K-factor:         max(16, 40 − sessionsPlayed × 0.8)  → decays from 40 → 16
 * Expected perf:    E = 1 / (1 + 10^((1500 − rating) / 400))
 * Actual perf:      S = mean(DECISION_ELO_VALUES[label]) for the session
 * Update:           newRating = rating + K × (S − E)
 */
export interface DecisionEloState {
  rating: number;
  peakRating: number;
  sessionsPlayed: number;
  kFactor: number;
  lastSessionDelta: number;
  lastSessionPerformance: number;
  lastSessionExpected: number;
  history: EloHistoryEntry[];
}

export interface EloHistoryEntry {
  date: string;
  rating: number;
  delta: number;
}

// ═══════════════════════════════════════════════════════════════
//  DISCIPLINED REPLAY
// ═══════════════════════════════════════════════════════════════

/** Rules for the "what if you were disciplined?" replay. */
export interface DisciplinedReplayRules {
  maxDailyLossAbsolute: number; // e.g., -500 (stop trading if hit)
  maxTradesPerDay: number; // e.g., 10
  revengeWindowMs: number; // e.g., 15 × 60 × 1000 (15 min cooldown)
  maxPositionSizeMultiple: number; // e.g., 1.5 (1.5× baseline size)
  noEntryAfterTimeMs: number | null; // ms from session start; null = disabled
}

/** Result of replaying the session under disciplined rules. */
export interface DisciplinedSessionResult {
  originalPnl: number;
  disciplinedPnl: number;
  tradesKept: number;
  tradesRemoved: number;
  removedTradeIds: string[];
  removedReasons: Record<string, ReasonCode>;
  disciplinedTrades: Trade[];
  savings: number; // disciplinedPnl − originalPnl (positive = saved money)
}

export const DEFAULT_REPLAY_RULES: DisciplinedReplayRules = {
  maxDailyLossAbsolute: -500,
  maxTradesPerDay: 10,
  revengeWindowMs: 15 * 60 * 1000, // 15 minutes
  maxPositionSizeMultiple: 1.5,
  noEntryAfterTimeMs: null,
};

// ═══════════════════════════════════════════════════════════════
//  TEMPER REPORT (full analysis output)
// ═══════════════════════════════════════════════════════════════

export interface TemperReport {
  id: string;
  sessionId: string;
  userId: string;
  date: string;
  session: Session;
  biasScores: BiasScores;
  biasDetails: BiasDetail[];
  decisions: DecisionEvent[];
  temperScore: TemperScore;
  eloBefore: number;
  eloAfter: number;
  eloDelta: number;
  disciplinedReplay: DisciplinedSessionResult;
  generatedAt: string; // ISO timestamp
}

// ═══════════════════════════════════════════════════════════════
//  COACH FACTS PAYLOAD (strict LLM input contract)
// ═══════════════════════════════════════════════════════════════

/**
 * The ONLY data an LLM receives. No raw trades, no free-text,
 * no user PII. Structured sections with pre-computed metrics.
 */
export interface CoachFactsPayload {
  overview: {
    date: string;
    temperScore: number;
    eloBefore: number;
    eloAfter: number;
    eloDelta: number;
    totalTrades: number;
    winRate: number;
    totalPnl: number;
    maxDrawdown: number;
  };
  biases: {
    type: BiasType;
    score: number;
    isTriggered: boolean; // score >= 40
    topMetric: string; // e.g., "3.2× baseline trade count"
  }[];
  labelSummary: {
    label: DecisionLabel;
    symbol: string;
    count: number;
    percentage: number;
  }[];
  keyEvents: {
    tradeIndex: number;
    timestamp: string;
    label: DecisionLabel;
    symbol: string;
    reasons: ReasonCode[];
    pnl: number;
    explanation: string;
  }[];
  tiltSequences: {
    startIndex: number;
    endIndex: number;
    durationDescription: string;
    aggregatePnl: number;
    dominantBias: BiasType;
  }[];
  disciplinedReplay: {
    originalPnl: number;
    disciplinedPnl: number;
    tradesRemoved: number;
    savings: number;
  };
  streaks: {
    bestStreak: {
      startIndex: number;
      endIndex: number;
      labels: DecisionLabel[];
    };
    worstStreak: {
      startIndex: number;
      endIndex: number;
      labels: DecisionLabel[];
    };
  };
}

// ═══════════════════════════════════════════════════════════════
//  USER BASELINE (rolling averages for comparison)
// ═══════════════════════════════════════════════════════════════

export interface UserBaseline {
  avgTradesPerDay: number;
  avgPositionSize: number;
  avgDailyPnl: number;
  avgWinRate: number;
  avgHoldingTimeMs: number;
  avgWinHoldingTimeMs: number;
  avgLossHoldingTimeMs: number;
  sessionsCount: number;
}

export const DEFAULT_BASELINE: UserBaseline = {
  avgTradesPerDay: 10,
  avgPositionSize: 100,
  avgDailyPnl: 0,
  avgWinRate: 0.5,
  avgHoldingTimeMs: 300_000,
  avgWinHoldingTimeMs: 300_000,
  avgLossHoldingTimeMs: 300_000,
  sessionsCount: 0,
};

// ═══════════════════════════════════════════════════════════════
//  UTILITY TYPES
// ═══════════════════════════════════════════════════════════════

/** Clamp a number to [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Linear interpolation between 0–100 given value in [low, high]. */
export function linearScore(
  value: number,
  low: number,
  high: number,
): number {
  if (value <= low) return 0;
  if (value >= high) return 100;
  return ((value - low) / (high - low)) * 100;
}
