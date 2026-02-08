// ─────────────────────────────────────────────────────────────
// Temper – Decision Label Assignment
// ─────────────────────────────────────────────────────────────
// Assigns a chess-style DecisionLabel to each trade based on
// deterministic behavioral rules.
//
// Evaluation hierarchy (from worst to best):
//   BLUNDER  → 3+ violations or catastrophic discipline failure
//   MISTAKE  → 2 violations or a single major violation
//   INACCURACY → 1 minor violation
//   BOOK     → followed all rules, textbook execution
//   GOOD     → followed rules + profitable
//   EXCELLENT → followed rules + good risk management + clean exit
//   BRILLIANT → perfect execution under adverse conditions
//   MISS     → detected separately (plan said trade, user didn't)
// ─────────────────────────────────────────────────────────────

import type {
  Trade,
  Session,
  UserBaseline,
  DecisionEvent,
  ReasonCode,
} from "@/lib/types";
import {
  DecisionLabel,
  DECISION_SYMBOLS,
  DECISION_SCORE_WEIGHTS,
  DECISION_ELO_VALUES,
} from "@/lib/types";

// ── Per-trade violation flags ─────────────────────────────────

interface TradeViolations {
  isRevengeEntry: boolean; // within 5 min of a significant loss
  isOversized: boolean; // > 1.5× baseline position size
  isFomoEntry: boolean; // in last 20% of session, or chasing after drawdown
  isInCluster: boolean; // part of an overtrade cluster (3+ in 10 min)
  isTiltTrade: boolean; // trading past max daily loss
  isSizeSpike: boolean; // > 2× size after a winning streak
  isHeldTooLong: boolean; // loser held > 3× average (proxy for loss aversion)
  violationCount: number;
  positiveReasons: ReasonCode[];
  negativeReasons: ReasonCode[];
}

const REVENGE_WINDOW_MS = 5 * 60 * 1000;
const CLUSTER_WINDOW_MS = 10 * 60 * 1000;
const CLUSTER_MIN_TRADES = 3;

function evaluateViolations(
  trade: Trade,
  trades: Trade[],
  session: Session,
  _baseline: UserBaseline,
): TradeViolations {
  const reasons: { positive: ReasonCode[]; negative: ReasonCode[] } = {
    positive: [],
    negative: [],
  };

  // ── Revenge entry ────
  const isRevengeEntry = (() => {
    if (trade.index === 0) return false;
    const prev = trades[trade.index - 1];
    if (!prev || prev.isWin) return false;
    const medianLoss = computeMedianLoss(trades);
    const isPrevSignificantLoss = prev.pnl <= medianLoss;
    const isFastFollow =
      trade.timeSinceLastTradeMs !== null &&
      trade.timeSinceLastTradeMs < REVENGE_WINDOW_MS;
    return isPrevSignificantLoss && isFastFollow;
  })();
  if (isRevengeEntry) reasons.negative.push("REVENGE_AFTER_BIG_LOSS");

  // ── Oversized ────
  const isOversized = trade.sizeRelativeToBaseline > 1.5;
  if (isOversized) reasons.negative.push("SLIGHT_OVERSIZE");

  // ── FOMO entry ────
  const sessionStart = trades[0]?.timestampMs ?? 0;
  const lateThreshold = sessionStart + session.durationMs * 0.8;
  const isLateEntry = trade.timestampMs > lateThreshold && session.durationMs > 60_000;

  const isAfterConsecutiveLosses =
    trade.index >= 2 &&
    !trades[trade.index - 1].isWin &&
    !trades[trade.index - 2].isWin &&
    trade.drawdownFromPeak < 0;

  const isFomoEntry = isLateEntry || isAfterConsecutiveLosses;
  if (isLateEntry) reasons.negative.push("FOMO_LATE_ENTRY");
  if (isAfterConsecutiveLosses) reasons.negative.push("FOMO_CHASING_MOMENTUM");

  // ── Cluster (overtrading) ────
  const isInCluster = (() => {
    let count = 0;
    for (const t of trades) {
      if (
        Math.abs(t.timestampMs - trade.timestampMs) <= CLUSTER_WINDOW_MS / 2
      ) {
        count++;
      }
    }
    return count >= CLUSTER_MIN_TRADES;
  })();
  if (isInCluster) reasons.negative.push("OVERTRADE_CLUSTER");

  // ── Tilt (trading past max loss) ────
  const isTiltTrade = trade.runningPnl < -Math.abs(session.avgLoss * 5);
  if (isTiltTrade) reasons.negative.push("MAX_LOSS_BREACH");

  // ── Size spike after winning streak ────
  const isSizeSpike = (() => {
    if (trade.index < 3) return false;
    let streak = 0;
    for (let i = trade.index - 1; i >= 0; i--) {
      if (trades[i].isWin) streak++;
      else break;
    }
    return streak >= 3 && trade.sizeRelativeToBaseline > 2.0;
  })();
  if (isSizeSpike) reasons.negative.push("SIZE_SPIKE_AFTER_STREAK");

  // ── Held too long (loss aversion proxy) ────
  const isHeldTooLong = (() => {
    if (trade.index === 0 || trades[trade.index - 1].isWin) return false;
    return (
      trade.timeSinceLastTradeMs !== null &&
      session.avgHoldingTimeMs > 0 &&
      trade.timeSinceLastTradeMs > session.avgHoldingTimeMs * 3
    );
  })();
  if (isHeldTooLong) reasons.negative.push("LOSS_HELD_TOO_LONG");

  // ── Positive checks ────
  const hasNoViolations =
    !isRevengeEntry &&
    !isOversized &&
    !isFomoEntry &&
    !isInCluster &&
    !isTiltTrade &&
    !isSizeSpike &&
    !isHeldTooLong;

  if (hasNoViolations) {
    reasons.positive.push("FOLLOWED_PLAN");
    if (trade.sizeRelativeToBaseline >= 0.8 && trade.sizeRelativeToBaseline <= 1.2) {
      reasons.positive.push("CLEAN_RISK_MANAGEMENT");
    }
  }

  const violationCount = reasons.negative.length;

  return {
    isRevengeEntry,
    isOversized,
    isFomoEntry,
    isInCluster,
    isTiltTrade,
    isSizeSpike,
    isHeldTooLong,
    violationCount,
    positiveReasons: reasons.positive,
    negativeReasons: reasons.negative,
  };
}

// ── Helpers ───────────────────────────────────────────────────

function computeMedianLoss(trades: Trade[]): number {
  const losses = trades.filter((t) => !t.isWin).map((t) => t.pnl);
  if (losses.length === 0) return 0;
  losses.sort((a, b) => a - b);
  return losses[Math.floor(losses.length / 2)];
}

// ── Label assignment ──────────────────────────────────────────

function assignLabel(v: TradeViolations, trade: Trade): DecisionLabel {
  // Catastrophic: 3+ violations or trading past max loss
  if (v.violationCount >= 3 || (v.isTiltTrade && v.isRevengeEntry)) {
    return DecisionLabel.BLUNDER;
  }

  // Major: 2 violations or revenge + oversized
  if (
    v.violationCount >= 2 ||
    (v.isRevengeEntry && v.isOversized) ||
    v.isSizeSpike
  ) {
    return DecisionLabel.MISTAKE;
  }

  // Minor: 1 violation
  if (v.violationCount === 1) {
    return DecisionLabel.INACCURACY;
  }

  // No violations from here on ──────────────────────────────

  // BRILLIANT: clean trade + positive P/L + under pressure (in drawdown)
  // + tight sizing
  if (
    trade.isWin &&
    trade.drawdownFromPeak < 0 &&
    trade.sizeRelativeToBaseline >= 0.8 &&
    trade.sizeRelativeToBaseline <= 1.2 &&
    v.positiveReasons.includes("CLEAN_RISK_MANAGEMENT")
  ) {
    return DecisionLabel.BRILLIANT;
  }

  // EXCELLENT: clean + profitable + good risk management
  if (
    trade.isWin &&
    v.positiveReasons.includes("CLEAN_RISK_MANAGEMENT")
  ) {
    return DecisionLabel.EXCELLENT;
  }

  // GOOD: clean + profitable
  if (trade.isWin) {
    return DecisionLabel.GOOD;
  }

  // BOOK: followed plan, but trade was a loss (disciplined loss)
  return DecisionLabel.BOOK;
}

// ── Build explanation string ──────────────────────────────────

function buildExplanation(
  label: DecisionLabel,
  v: TradeViolations,
  trade: Trade,
): string {
  const parts: string[] = [];

  switch (label) {
    case DecisionLabel.BRILLIANT:
      parts.push("Perfect execution under pressure.");
      if (trade.drawdownFromPeak < 0)
        parts.push(
          `Traded cleanly while ${Math.abs(trade.drawdownFromPeak).toFixed(2)} below peak.`,
        );
      parts.push("Position sized correctly. Strong discipline.");
      break;
    case DecisionLabel.GREAT:
      parts.push("Excellent execution with strong risk awareness.");
      parts.push("Well-timed entry with solid follow-through.");
      break;
    case DecisionLabel.BEST:
      parts.push("Optimal trade given market conditions.");
      parts.push("Near-perfect discipline and timing.");
      break;
    case DecisionLabel.EXCELLENT:
      parts.push("Clean execution with good risk management.");
      parts.push("All rules followed, profitable outcome.");
      break;
    case DecisionLabel.GOOD:
      parts.push("Disciplined trade with a positive result.");
      break;
    case DecisionLabel.BOOK:
      parts.push("Textbook execution — followed all rules.");
      parts.push("The loss was within normal parameters.");
      break;
    case DecisionLabel.FORCED:
      parts.push("Forced action — no viable alternative.");
      break;
    case DecisionLabel.INTERESTING:
      parts.push("Unconventional but noteworthy decision.");
      break;
    case DecisionLabel.INACCURACY:
      parts.push("Minor discipline deviation detected.");
      for (const r of v.negativeReasons) {
        parts.push(reasonToText(r, trade));
      }
      break;
    case DecisionLabel.MISTAKE:
      parts.push("Clear rule violation.");
      for (const r of v.negativeReasons) {
        parts.push(reasonToText(r, trade));
      }
      break;
    case DecisionLabel.MISS:
      parts.push("An opportunity was identified but not taken.");
      break;
    case DecisionLabel.BLUNDER:
      parts.push("Severe discipline failure.");
      for (const r of v.negativeReasons) {
        parts.push(reasonToText(r, trade));
      }
      break;
    case DecisionLabel.MEGABLUNDER:
      parts.push("Catastrophic discipline breakdown.");
      for (const r of v.negativeReasons) {
        parts.push(reasonToText(r, trade));
      }
      break;
    case DecisionLabel.CHECKMATED:
      parts.push("Session ended in total loss.");
      break;
    case DecisionLabel.WINNER:
      parts.push("Session ended in victory — excellent result.");
      break;
    case DecisionLabel.DRAW:
      parts.push("Session ended in a draw — breakeven outcome.");
      break;
    case DecisionLabel.RESIGN:
      parts.push("Exited the session early.");
      break;
  }

  return parts.join(" ");
}

function reasonToText(reason: ReasonCode, trade: Trade): string {
  switch (reason) {
    case "REVENGE_AFTER_BIG_LOSS":
      return `Entered within ${trade.timeSinceLastTradeMs ? (trade.timeSinceLastTradeMs / 1000).toFixed(0) : "?"}s of a significant loss.`;
    case "SLIGHT_OVERSIZE":
      return `Position size was ${trade.sizeRelativeToBaseline.toFixed(1)}× baseline.`;
    case "FOMO_LATE_ENTRY":
      return "Entered in the final stretch of the session.";
    case "FOMO_CHASING_MOMENTUM":
      return "Chased entry after consecutive losses while in drawdown.";
    case "OVERTRADE_CLUSTER":
      return "Part of a rapid-fire trade cluster.";
    case "MAX_LOSS_BREACH":
      return `Continued trading at $${trade.runningPnl.toFixed(2)} running P/L — well past max loss.`;
    case "SIZE_SPIKE_AFTER_STREAK":
      return `Position size spiked to ${trade.sizeRelativeToBaseline.toFixed(1)}× after a winning streak.`;
    case "LOSS_HELD_TOO_LONG":
      return "Previous losing trade was held far longer than average.";
    default:
      return "";
  }
}

// ═══════════════════════════════════════════════════════════════
//  MAIN EXPORT: Label all trades in a session
// ═══════════════════════════════════════════════════════════════

/**
 * Assign a DecisionLabel to every trade in a session.
 * Pure, deterministic — same session + baseline = same output.
 */
export function labelTrades(
  session: Session,
  baseline: UserBaseline,
): DecisionEvent[] {
  return session.trades.map((trade) => {
    const violations = evaluateViolations(
      trade,
      session.trades,
      session,
      baseline,
    );
    const label = assignLabel(violations, trade);

    return {
      tradeId: trade.id,
      tradeIndex: trade.index,
      label,
      symbol: DECISION_SYMBOLS[label],
      reasons: [
        ...violations.negativeReasons,
        ...violations.positiveReasons,
      ],
      scoreContribution: DECISION_SCORE_WEIGHTS[label],
      eloValue: DECISION_ELO_VALUES[label],
      explanation: buildExplanation(label, violations, trade),
    };
  });
}
