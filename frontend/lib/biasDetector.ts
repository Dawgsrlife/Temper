// ─────────────────────────────────────────────────────────────
// Temper – Bias Detector (Production Adapter)
// ─────────────────────────────────────────────────────────────
// Backward-compatible adapter wrapping the production engine.
// All page imports continue to work while gaining richer
// analysis from the real engine underneath.
//
// Replaces the old crude detector with:
//   • 5 continuous bias scores (0–100)
//   • 8 chess-style decision labels per trade
//   • ELO decision rating system
//   • Disciplined replay ("what-if" simulation)
//   • Structured coach contract (facts + prompt)
//   • PapaParse + Zod CSV parsing (25+ column aliases)
//   • Fully deterministic (no Math.random)
// ─────────────────────────────────────────────────────────────

import { parseCsv } from "@/lib/trades/parser";
import { enrichTrades, buildSession } from "@/lib/trades/session";
import { analyzeSession as engineAnalyze } from "@/lib/behavior/engine";
import { buildCoachFacts } from "@/lib/coach/facts";
import {
  mockCoachResponse,
  type CoachResponse,
} from "@/lib/coach/prompt";
import {
  DEFAULT_ELO_STATE,
  getRatingBracket,
  type RatingBracket,
} from "@/lib/ratings/elo";
import type {
  RawTrade,
  Session,
  TemperReport,
  DecisionEloState,
  CoachFactsPayload,
  BiasDetail,
  DecisionEvent,
  DisciplinedSessionResult,
  BiasScores,
  TemperScore,
} from "@/lib/types";
import {
  BiasType,
  DecisionLabel,
  TradeSide,
  DEFAULT_BASELINE,
  DECISION_SYMBOLS,
  DECISION_COLORS,
  DECISION_BG_COLORS,
} from "@/lib/types";

// ═══════════════════════════════════════════════════════════════
//  RE-EXPORTS — pages can import rich engine types directly
// ═══════════════════════════════════════════════════════════════

export type {
  TemperReport,
  BiasScores,
  BiasDetail,
  DecisionEvent,
  TemperScore,
  DecisionEloState,
  DisciplinedSessionResult,
  CoachFactsPayload,
  CoachResponse,
  Session,
  RatingBracket,
};

export {
  BiasType,
  DecisionLabel,
  DECISION_SYMBOLS,
  DECISION_COLORS,
  DECISION_BG_COLORS,
  DEFAULT_ELO_STATE,
  getRatingBracket,
  buildCoachFacts,
  mockCoachResponse,
};

// ═══════════════════════════════════════════════════════════════
//  BACKWARD-COMPATIBLE TYPES
// ═══════════════════════════════════════════════════════════════

export interface Trade {
  timestamp: string;
  asset: string;
  side: "BUY" | "SELL";
  quantity: number;
  price?: number;
  pnl?: number;
  entryPrice?: number;
  exitPrice?: number;
  balance?: number;
  tradeId?: number;
  serverLabel?: TradeLabel;
  serverOutcome?: string;
  reasonLabel?: string;
  blockedReason?: string;
}

export type TradeLabel =
  | "BRILLIANT"
  | "GREAT"
  | "BEST"
  | "EXCELLENT"
  | "GOOD"
  | "INACCURACY"
  | "MISTAKE"
  | "MISS"
  | "BLUNDER"
  | "MEGABLUNDER"
  | "BOOK"
  | "FORCED"
  | "INTERESTING"
  | "ABANDON"
  | "CHECKMATED"
  | "WINNER"
  | "DRAW"
  | "RESIGN"
  | "TIMEOUT";

export interface BiasDetection {
  type: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  confidence: number;
  score: number;
  description: string;
  tradeIndices: number[];
  recommendation: string;
  triggeredRules: string[];
}

export interface TradeWithAnalysis extends Trade {
  index: number;
  label: TradeLabel;
  labelSymbol: string;
  biases: BiasDetection[];
  timeSinceLast: number;
  sessionPnL: number;
  isWinner: boolean;
  annotation: string;
  drawdownFromPeak: number;
  sizeRelativeToBaseline: number;
  reasons: string[];
  scoreContribution: number;
}

export interface SessionAnalysis {
  trades: TradeWithAnalysis[];
  biases: BiasDetection[];
  disciplineScore: number;
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
    maxDrawdown: number;
    profitFactor: number;
    largestWin: number;
    largestLoss: number;
  };
  recommendations: string[];
  patterns: {
    name: string;
    count: number;
    impact: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
  }[];
  // ── Rich engine data (always populated) ──
  report: TemperReport;
  eloState: DecisionEloState;
  coachFacts: CoachFactsPayload;
  coachResponse: CoachResponse;
}

// ═══════════════════════════════════════════════════════════════
//  INTERNAL HELPERS
// ═══════════════════════════════════════════════════════════════

function tradesToRaw(trades: Trade[]): RawTrade[] {
  return trades.map((t) => {
    let pnl = t.pnl ?? 0;
    const price = t.entryPrice ?? t.price ?? 100;

    // Auto-compute P/L from entry/exit prices if pnl not provided
    if (
      t.pnl === undefined &&
      t.entryPrice !== undefined &&
      t.exitPrice !== undefined
    ) {
      const sign = t.side === "BUY" ? 1 : -1;
      pnl = (t.exitPrice - t.entryPrice) * t.quantity * sign;
    }

    return {
      timestamp: new Date(t.timestamp).toISOString(),
      symbol: t.asset || "UNKNOWN",
      side: t.side === "BUY" ? TradeSide.LONG : TradeSide.SHORT,
      quantity: t.quantity || 1,
      price,
      pnl,
      tags: [],
    };
  });
}

function severityFromScore(score: number): BiasDetection["severity"] {
  if (score >= 70) return "CRITICAL";
  if (score >= 50) return "HIGH";
  if (score >= 30) return "MEDIUM";
  return "LOW";
}

const BIAS_RECOMMENDATIONS: Record<string, string> = {
  OVERTRADING:
    "Set a daily trade limit and enforce a 5-minute cooldown between trades.",
  LOSS_AVERSION:
    "Set predefined stop-losses before entering. Accept small losses as part of the strategy.",
  REVENGE_TRADING:
    "After any loss, take a 15-minute cooling-off break. Document the loss before re-entering.",
  FOMO: "Stick to your watchlist and pre-planned setups. If you missed a move, wait for the next one.",
  GREED:
    "Take partial profits at predetermined levels. Trail your stop-loss on remaining position.",
};

function reasonMatchesBias(reason: string, biasType: BiasType): boolean {
  const map: Record<string, BiasType[]> = {
    OVERTRADE_CLUSTER: [BiasType.OVERTRADING],
    REVENGE_AFTER_BIG_LOSS: [BiasType.REVENGE_TRADING],
    FOMO_LATE_ENTRY: [BiasType.FOMO],
    FOMO_CHASING_MOMENTUM: [BiasType.FOMO],
    SIZE_SPIKE_AFTER_STREAK: [BiasType.GREED],
    GREED_SIZE_INCREASE: [BiasType.GREED],
    GREED_NO_PROFIT_TAKE: [BiasType.GREED],
    LOSS_HELD_TOO_LONG: [BiasType.LOSS_AVERSION],
    MAX_LOSS_BREACH: [BiasType.REVENGE_TRADING],
    SLIGHT_OVERSIZE: [BiasType.GREED],
    EMOTIONAL_ENTRY: [BiasType.REVENGE_TRADING, BiasType.FOMO],
    TILT_SEQUENCE: [BiasType.REVENGE_TRADING],
    RULE_VIOLATION: [BiasType.OVERTRADING],
  };
  return map[reason]?.includes(biasType) ?? false;
}

function loadEloState(): DecisionEloState {
  if (typeof window === "undefined") return DEFAULT_ELO_STATE;
  try {
    const saved = localStorage.getItem("temper_elo_state");
    return saved ? JSON.parse(saved) : DEFAULT_ELO_STATE;
  } catch {
    return DEFAULT_ELO_STATE;
  }
}

function saveEloState(state: DecisionEloState): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem("temper_elo_state", JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

// ═══════════════════════════════════════════════════════════════
//  MAIN ANALYSIS FUNCTION
// ═══════════════════════════════════════════════════════════════

export function analyzeSession(trades: Trade[]): SessionAnalysis {
  if (trades.length === 0) return emptyAnalysis();

  // 1. Convert to engine types
  const rawTrades = tradesToRaw(trades);
  rawTrades.sort(
    (a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  // 2. Enrich trades + build single session
  const baseline = DEFAULT_BASELINE;
  const enriched = enrichTrades(rawTrades, baseline);
  const date = rawTrades[0].timestamp.slice(0, 10);
  const session = buildSession("user", date, enriched);

  // 3. Run full engine pipeline
  const previousElo = loadEloState();
  const { report, newElo } = engineAnalyze({
    session,
    baseline,
    previousElo,
  });
  saveEloState(newElo);

  // 4. Build coach data
  const coachFacts = buildCoachFacts(report);
  const coachResponse = mockCoachResponse(coachFacts);

  // 5. Map biases → backward-compatible BiasDetection[]
  const biases: BiasDetection[] = report.biasDetails
    .filter((d) => d.score >= 15)
    .map((d) => {
      const tradeIndices = report.decisions
        .filter((dec) =>
          dec.reasons.some((r) => reasonMatchesBias(r, d.type)),
        )
        .map((dec) => dec.tradeIndex);

      return {
        type: d.type,
        severity: severityFromScore(d.score),
        confidence: Math.min(95, d.score + 10),
        score: d.score,
        description:
          d.triggeredRules.join(". ") ||
          `${d.type.replace(/_/g, " ")} detected (score: ${d.score}/100)`,
        tradeIndices,
        recommendation:
          BIAS_RECOMMENDATIONS[d.type] || "Review your trading rules.",
        triggeredRules: d.triggeredRules,
      };
    });

  // 6. Map trades → backward-compatible TradeWithAnalysis[]
  const analyzedTrades: TradeWithAnalysis[] = session.trades.map(
    (engineTrade, i) => {
      const decision = report.decisions[i];
      const tradeBiases = biases.filter((b) =>
        b.tradeIndices.includes(i),
      );

      return {
        timestamp: engineTrade.timestamp,
        asset: engineTrade.symbol,
        side:
          engineTrade.side === TradeSide.LONG
            ? ("BUY" as const)
            : ("SELL" as const),
        quantity: engineTrade.quantity,
        price: engineTrade.price,
        pnl: engineTrade.pnl,
        index: i,
        label: decision.label as TradeLabel,
        labelSymbol: decision.symbol,
        biases: tradeBiases,
        timeSinceLast:
          engineTrade.timeSinceLastTradeMs !== null
            ? engineTrade.timeSinceLastTradeMs / 1000
            : 300,
        sessionPnL: engineTrade.runningPnl,
        isWinner: engineTrade.isWin,
        annotation: decision.explanation,
        drawdownFromPeak: engineTrade.drawdownFromPeak,
        sizeRelativeToBaseline: engineTrade.sizeRelativeToBaseline,
        reasons: decision.reasons,
        scoreContribution: decision.scoreContribution,
      };
    },
  );

  // 7. Build summary
  const biasBreakdown: Record<string, number> = {};
  biases.forEach((b) => {
    biasBreakdown[b.type] = (biasBreakdown[b.type] || 0) + 1;
  });

  const avgTradeInterval =
    session.durationMs > 0 && session.tradeCount > 1
      ? session.durationMs / (session.tradeCount - 1) / 1000
      : 0;

  // 8. Spec-aligned recommendations
  const recommendations = generateRecommendations(report, coachResponse);

  // 9. Patterns
  const patterns = detectPatterns(report);

  return {
    trades: analyzedTrades,
    biases,
    disciplineScore: report.temperScore.value,
    psychologicalPnL: {
      strategyPnL: report.disciplinedReplay.disciplinedPnl,
      emotionalCost: Math.abs(report.disciplinedReplay.savings),
      potentialPnL: report.disciplinedReplay.disciplinedPnl,
    },
    summary: {
      totalPnL: session.totalPnl,
      totalTrades: session.tradeCount,
      winners: session.winCount,
      losers: session.lossCount,
      winRate: session.winRate * 100,
      avgWin: session.avgWin,
      avgLoss: session.avgLoss,
      avgTradeInterval,
      tradingDuration: session.durationMs / 60_000,
      netPnL: session.totalPnl,
      biasBreakdown,
      maxDrawdown: session.maxDrawdown,
      profitFactor:
        session.profitFactor === Infinity ? 999 : session.profitFactor,
      largestWin: session.largestWin,
      largestLoss: session.largestLoss,
    },
    recommendations,
    patterns,
    report,
    eloState: newElo,
    coachFacts,
    coachResponse,
  };
}

// ═══════════════════════════════════════════════════════════════
//  SPEC-ALIGNED RECOMMENDATIONS
// ═══════════════════════════════════════════════════════════════

function generateRecommendations(
  report: TemperReport,
  coach: CoachResponse,
): string[] {
  const recs: string[] = [];

  if (report.biasScores.OVERTRADING >= 25) {
    const limit = Math.max(
      5,
      Math.ceil(report.session.tradeCount * 0.6),
    );
    recs.push(
      `Daily trade limit: Cap at ${limit} trades per session to curb overtrading.`,
    );
  }
  if (report.biasScores.LOSS_AVERSION >= 25) {
    recs.push(
      "Stop-loss discipline: Set predefined exit levels before entering and honor them without exception.",
    );
  }
  if (report.biasScores.REVENGE_TRADING >= 25) {
    recs.push(
      "Cooling-off period: After any loss exceeding 1R, enforce a 15-minute break before re-entering.",
    );
  }
  if (report.biasScores.FOMO >= 25) {
    recs.push(
      "FOMO management: Avoid late-session entries after drawdowns. Stick to your pre-planned watchlist.",
    );
  }
  if (report.biasScores.GREED >= 25) {
    recs.push(
      "Profit management: Take partial profits at 2R and trail the rest. Don't let winners reverse into losses.",
    );
  }

  if (report.disciplinedReplay.tradesRemoved > 0) {
    const saved = report.disciplinedReplay.savings;
    recs.push(
      `Discipline replay: ${report.disciplinedReplay.tradesRemoved} trades filtered by rules. ` +
        `${saved >= 0 ? "P/L improvement" : "Net impact"}: $${Math.abs(saved).toFixed(2)}.`,
    );
  }

  recs.push(
    "Journaling prompt: What was your emotional state before your worst decision today?",
  );

  recs.push(...coach.guardrails.slice(0, 3));

  if (report.temperScore.value >= 80) {
    recs.push(
      "Excellent discipline! Keep building consistency session over session.",
    );
  }

  return recs;
}

function detectPatterns(
  report: TemperReport,
): SessionAnalysis["patterns"] {
  const patterns: SessionAnalysis["patterns"] = [];

  if (report.biasScores.OVERTRADING >= 25) {
    patterns.push({
      name: "Rapid Fire Trading",
      count:
        (report.biasDetails.find((b) => b.type === BiasType.OVERTRADING)
          ?.metrics?.clusterCount as number) ?? 1,
      impact: "NEGATIVE",
    });
  }
  if (report.biasScores.REVENGE_TRADING >= 25) {
    patterns.push({
      name: "Revenge Sequence",
      count:
        (report.biasDetails.find(
          (b) => b.type === BiasType.REVENGE_TRADING,
        )?.metrics?.revengeCandidates as number) ?? 1,
      impact: "NEGATIVE",
    });
  }
  if (report.biasScores.LOSS_AVERSION >= 25) {
    patterns.push({ name: "Loss Aversion", count: 1, impact: "NEGATIVE" });
  }
  if (report.biasScores.FOMO >= 25) {
    patterns.push({
      name: "FOMO Entries",
      count:
        (report.biasDetails.find((b) => b.type === BiasType.FOMO)?.metrics
          ?.chasingCount as number) ?? 1,
      impact: "NEGATIVE",
    });
  }
  if (report.biasScores.GREED >= 25) {
    patterns.push({
      name: "Overconfidence / Greed",
      count: 1,
      impact: "NEGATIVE",
    });
  }

  const goodCount = report.decisions.filter(
    (d) =>
      d.label === DecisionLabel.BRILLIANT ||
      d.label === DecisionLabel.EXCELLENT ||
      d.label === DecisionLabel.GOOD ||
      d.label === DecisionLabel.BOOK,
  ).length;

  if (goodCount > report.decisions.length * 0.6) {
    patterns.push({
      name: "Disciplined Majority",
      count: goodCount,
      impact: "POSITIVE",
    });
  }

  if (report.session.winRate > 0.6) {
    patterns.push({
      name: "Strong Win Rate",
      count: report.session.winCount,
      impact: "POSITIVE",
    });
  }

  return patterns;
}

// ═══════════════════════════════════════════════════════════════
//  CSV PARSER (wraps real PapaParse + Zod parser)
// ═══════════════════════════════════════════════════════════════

export function parseCSV(csv: string): Trade[] {
  const lines = csv.split("\n");
  if (lines.length === 0) return [];

  const normalizedLines = [...lines];

  // Normalize header for backward compat
  normalizedLines[0] = lines[0].replace(/\basset\b/gi, "symbol");

  // Inject default 'price' column if missing
  const headerLower = normalizedLines[0].toLowerCase();
  if (
    !headerLower.includes("price") &&
    !headerLower.includes("fill_price") &&
    !headerLower.includes("avg_price") &&
    !headerLower.includes("entry_price") &&
    !headerLower.includes("execution_price")
  ) {
    normalizedLines[0] += ",price";
    for (let i = 1; i < normalizedLines.length; i++) {
      if (normalizedLines[i].trim()) normalizedLines[i] += ",100";
    }
  }

  const result = parseCsv(normalizedLines.join("\n"));

  if (result.errors.length > 0 && result.validRows === 0) {
    console.warn("Temper CSV parse errors:", result.errors);
  }

  return result.trades.map((t) => ({
    timestamp: t.timestamp,
    asset: t.symbol,
    side: t.side === TradeSide.LONG ? ("BUY" as const) : ("SELL" as const),
    quantity: t.quantity,
    price: t.price,
    pnl: t.pnl,
  }));
}

// ═══════════════════════════════════════════════════════════════
//  EMPTY ANALYSIS FALLBACK
// ═══════════════════════════════════════════════════════════════

function emptySession(): Session {
  return {
    id: "",
    userId: "",
    date: "",
    trades: [],
    totalPnl: 0,
    maxDrawdown: 0,
    maxRunup: 0,
    tradeCount: 0,
    winCount: 0,
    lossCount: 0,
    winRate: 0,
    avgWin: 0,
    avgLoss: 0,
    profitFactor: 0,
    largestWin: 0,
    largestLoss: 0,
    avgHoldingTimeMs: 0,
    avgWinHoldingTimeMs: 0,
    avgLossHoldingTimeMs: 0,
    peakPnl: 0,
    symbols: [],
    durationMs: 0,
    avgPositionSize: 0,
  };
}

function emptyAnalysis(): SessionAnalysis {
  const emptyElo = DEFAULT_ELO_STATE;
  const emptyLabelDist = Object.fromEntries(
    Object.values(DecisionLabel).map((l) => [l, 0]),
  ) as Record<DecisionLabel, number>;

  const emptyReport: TemperReport = {
    id: "",
    sessionId: "",
    userId: "",
    date: "",
    session: emptySession(),
    biasScores: {
      OVERTRADING: 0,
      LOSS_AVERSION: 0,
      REVENGE_TRADING: 0,
      FOMO: 0,
      GREED: 0,
      aggregate: 0,
    },
    biasDetails: [],
    decisions: [],
    temperScore: {
      value: 100,
      rawScore: 100,
      biasPenalty: 0,
      tradeScoreAvg: 10,
      labelDistribution: emptyLabelDist,
    },
    eloBefore: 1200,
    eloAfter: 1200,
    eloDelta: 0,
    disciplinedReplay: {
      originalPnl: 0,
      disciplinedPnl: 0,
      tradesKept: 0,
      tradesRemoved: 0,
      removedTradeIds: [],
      removedReasons: {},
      disciplinedTrades: [],
      savings: 0,
    },
    generatedAt: new Date().toISOString(),
  };

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
      maxDrawdown: 0,
      profitFactor: 0,
      largestWin: 0,
      largestLoss: 0,
    },
    recommendations: [],
    patterns: [],
    report: emptyReport,
    eloState: emptyElo,
    coachFacts: {
      overview: {
        date: "",
        temperScore: 100,
        eloBefore: 1200,
        eloAfter: 1200,
        eloDelta: 0,
        totalTrades: 0,
        winRate: 0,
        totalPnl: 0,
        maxDrawdown: 0,
      },
      biases: [],
      labelSummary: [],
      keyEvents: [],
      tiltSequences: [],
      disciplinedReplay: {
        originalPnl: 0,
        disciplinedPnl: 0,
        tradesRemoved: 0,
        savings: 0,
      },
      streaks: {
        bestStreak: { startIndex: 0, endIndex: 0, labels: [] },
        worstStreak: { startIndex: 0, endIndex: 0, labels: [] },
      },
    },
    coachResponse: {
      daySummary: "",
      eventNarratives: [],
      positiveReinforcement: [],
      negativeReinforcement: [],
      guardrails: [],
      journalPrompts: [],
      closingMessage: "",
    },
  };
}

// ═══════════════════════════════════════════════════════════════
//  TRADER PROFILES (sample data)
// ═══════════════════════════════════════════════════════════════

export type TraderProfile =
  | "calm_trader"
  | "loss_averse_trader"
  | "overtrader"
  | "revenge_trader";

export const TRADER_PROFILES: Record<
  TraderProfile,
  { name: string; description: string; color: string }
> = {
  calm_trader: {
    name: "Calm Trader",
    description:
      "Exhibits disciplined trading behavior with proper interval between trades.",
    color: "#06D6A0",
  },
  loss_averse_trader: {
    name: "Loss Averse",
    description: "Shows fear-based patterns, reducing risk after losses.",
    color: "#8B5CF6",
  },
  overtrader: {
    name: "Overtrader",
    description: "Trades too frequently, often without clear rationale.",
    color: "#F97316",
  },
  revenge_trader: {
    name: "Revenge Trader",
    description: "Immediately re-enters after losses to recover.",
    color: "#EF476F",
  },
};
