// ─────────────────────────────────────────────────────────────
// Temper – Bias Detection Engine
// ─────────────────────────────────────────────────────────────
// Pure, deterministic functions that compute per-session bias
// scores (0–100) for five behavioral biases.
//
// Each bias scorer:
//   1. Extracts raw metrics from Session + UserBaseline
//   2. Maps metrics to a 0–100 score via explicit thresholds
//   3. Returns BiasDetail with metrics & triggered rules
// ─────────────────────────────────────────────────────────────

import type {
  Session,
  Trade,
  UserBaseline,
  BiasScores,
  BiasDetail,
} from "@/lib/types";
import { BiasType, linearScore, clamp } from "@/lib/types";

// ═══════════════════════════════════════════════════════════════
//  OVERTRADING
// ═══════════════════════════════════════════════════════════════
//
// Metrics:
//   tradeCountRatio = session.tradeCount / baseline.avgTradesPerDay
//   clusterCount    = # of 10-min windows with ≥ 3 trades
//
// Score:
//   ratioScore   = linearScore(tradeCountRatio, 1.0, 3.0)
//   clusterScore = linearScore(clusterCount, 0, 5)
//   final        = 0.7 × ratioScore + 0.3 × clusterScore
// ═══════════════════════════════════════════════════════════════

function countTradeClusters(
  trades: Trade[],
  windowMs: number = 10 * 60 * 1000,
  minTrades: number = 3,
): number {
  let clusters = 0;
  for (let i = 0; i < trades.length; i++) {
    const windowEnd = trades[i].timestampMs + windowMs;
    let count = 0;
    for (let j = i; j < trades.length && trades[j].timestampMs <= windowEnd; j++) {
      count++;
    }
    if (count >= minTrades) {
      clusters++;
      // Skip past this cluster to avoid double-counting
      while (
        i + 1 < trades.length &&
        trades[i + 1].timestampMs <= windowEnd
      ) {
        i++;
      }
    }
  }
  return clusters;
}

export function computeOvertradingBias(
  session: Session,
  baseline: UserBaseline,
): BiasDetail {
  const tradeCountRatio =
    baseline.avgTradesPerDay > 0
      ? session.tradeCount / baseline.avgTradesPerDay
      : 1;
  const clusterCount = countTradeClusters(session.trades);

  const ratioScore = linearScore(tradeCountRatio, 1.0, 3.0);
  const clusterScore = linearScore(clusterCount, 0, 5);
  const score = clamp(0.7 * ratioScore + 0.3 * clusterScore, 0, 100);

  const triggeredRules: string[] = [];
  if (tradeCountRatio > 1.5)
    triggeredRules.push(
      `${tradeCountRatio.toFixed(1)}× your average daily trade count`,
    );
  if (clusterCount > 0)
    triggeredRules.push(
      `${clusterCount} rapid-fire cluster(s) detected (≥3 trades in 10 min)`,
    );

  return {
    type: BiasType.OVERTRADING,
    score: Math.round(score),
    metrics: { tradeCountRatio, clusterCount, ratioScore, clusterScore },
    triggeredRules,
  };
}

// ═══════════════════════════════════════════════════════════════
//  LOSS AVERSION
// ═══════════════════════════════════════════════════════════════
//
// Metrics:
//   holdingRatio = avgLossHoldingTime / avgWinHoldingTime
//   (holding losers much longer than winners indicates aversion)
//
// Score:
//   linearScore(holdingRatio, 1.2, 4.0)
//   Floor of 0 if holdingRatio <= 1.2 (slight is normal)
// ═══════════════════════════════════════════════════════════════

export function computeLossAversionBias(
  session: Session,
  _baseline: UserBaseline,
): BiasDetail {
  const avgWinHolding = session.avgWinHoldingTimeMs || 1;
  const avgLossHolding = session.avgLossHoldingTimeMs || 0;
  const holdingRatio = avgLossHolding / avgWinHolding;

  // Also check: are there any trades where a loser was held >3× the average?
  let extremeHolds = 0;
  const losses = session.trades.filter((t) => !t.isWin);
  for (let i = 1; i < session.trades.length; i++) {
    const prev = session.trades[i - 1];
    if (!prev.isWin && session.trades[i].timeSinceLastTradeMs !== null) {
      if (
        session.trades[i].timeSinceLastTradeMs! >
        session.avgHoldingTimeMs * 3
      ) {
        extremeHolds++;
      }
    }
  }

  const holdingScore = linearScore(holdingRatio, 1.2, 4.0);
  const extremeScore = linearScore(
    extremeHolds,
    0,
    Math.max(losses.length * 0.3, 2),
  );
  const score = clamp(0.75 * holdingScore + 0.25 * extremeScore, 0, 100);

  const triggeredRules: string[] = [];
  if (holdingRatio > 1.5)
    triggeredRules.push(
      `Losers held ${holdingRatio.toFixed(1)}× longer than winners on average`,
    );
  if (extremeHolds > 0)
    triggeredRules.push(
      `${extremeHolds} trade(s) held >3× average holding time`,
    );

  return {
    type: BiasType.LOSS_AVERSION,
    score: Math.round(score),
    metrics: { holdingRatio, extremeHolds, holdingScore, extremeScore },
    triggeredRules,
  };
}

// ═══════════════════════════════════════════════════════════════
//  REVENGE TRADING
// ═══════════════════════════════════════════════════════════════
//
// Metrics:
//   For each trade following a "significant loss" (pnl < median loss):
//     If timeSinceLastTrade < 5 minutes → revenge candidate
//   revengeRatio = revenge_candidates / trades_after_sig_losses
//
// Score:
//   linearScore(revengeRatio, 0.0, 0.5)
// ═══════════════════════════════════════════════════════════════

const REVENGE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export function computeRevengeTradingBias(
  session: Session,
  _baseline: UserBaseline,
): BiasDetail {
  const trades = session.trades;
  if (trades.length < 2) {
    return {
      type: BiasType.REVENGE_TRADING,
      score: 0,
      metrics: { revengeRatio: 0, revengeCandidates: 0, tradesAfterLosses: 0 },
      triggeredRules: [],
    };
  }

  // Compute median loss magnitude
  const losses = trades.filter((t) => !t.isWin).map((t) => t.pnl);
  const medianLoss =
    losses.length > 0
      ? losses.sort((a, b) => a - b)[Math.floor(losses.length / 2)]
      : 0;

  let revengeCandidates = 0;
  let tradesAfterLosses = 0;

  for (let i = 1; i < trades.length; i++) {
    const prev = trades[i - 1];
    const curr = trades[i];

    // Previous trade was a significant loss
    if (prev.pnl < 0 && prev.pnl <= medianLoss) {
      tradesAfterLosses++;
      if (
        curr.timeSinceLastTradeMs !== null &&
        curr.timeSinceLastTradeMs < REVENGE_WINDOW_MS
      ) {
        revengeCandidates++;
      }
    }
  }

  const revengeRatio =
    tradesAfterLosses > 0 ? revengeCandidates / tradesAfterLosses : 0;
  const score = linearScore(revengeRatio, 0.0, 0.5);

  const triggeredRules: string[] = [];
  if (revengeCandidates > 0)
    triggeredRules.push(
      `${revengeCandidates} trade(s) entered within 5 min of a significant loss`,
    );
  if (revengeRatio > 0.3)
    triggeredRules.push(
      `${(revengeRatio * 100).toFixed(0)}% of post-loss trades were revenge entries`,
    );

  return {
    type: BiasType.REVENGE_TRADING,
    score: Math.round(score),
    metrics: { revengeRatio, revengeCandidates, tradesAfterLosses },
    triggeredRules,
  };
}

// ═══════════════════════════════════════════════════════════════
//  FOMO (Fear Of Missing Out)
// ═══════════════════════════════════════════════════════════════
//
// Metrics:
//   lateTradeRatio  = trades in last 20% of session / total trades
//   chasingScore    = trades entered when runningPnl is near
//                     session low and recent trades are losses
//                     (chasing to "get back" after missing an up move)
//
// Score:
//   fomoLate    = linearScore(lateTradeRatio, 0.15, 0.5)
//   fomoChasing = linearScore(chasingRatio, 0.1, 0.4)
//   final       = 0.4 × fomoLate + 0.6 × fomoChasing
// ═══════════════════════════════════════════════════════════════

export function computeFomoBias(
  session: Session,
  _baseline: UserBaseline,
): BiasDetail {
  const trades = session.trades;
  if (trades.length < 3 || session.durationMs < 60_000) {
    return {
      type: BiasType.FOMO,
      score: 0,
      metrics: { lateTradeRatio: 0, chasingRatio: 0 },
      triggeredRules: [],
    };
  }

  const sessionStart = trades[0].timestampMs;
  const lateThreshold = sessionStart + session.durationMs * 0.8;

  // Late trades
  const lateTrades = trades.filter((t) => t.timestampMs > lateThreshold);
  const lateTradeRatio = lateTrades.length / trades.length;

  // Chasing: trades entered while in drawdown after 2+ consecutive losses
  let chasingCount = 0;
  for (let i = 2; i < trades.length; i++) {
    const isInDrawdown = trades[i].drawdownFromPeak < 0;
    const hadConsecutiveLosses =
      !trades[i - 1].isWin && !trades[i - 2].isWin;
    if (isInDrawdown && hadConsecutiveLosses) {
      chasingCount++;
    }
  }
  const chasingRatio = chasingCount / trades.length;

  const fomoLate = linearScore(lateTradeRatio, 0.15, 0.5);
  const fomoChasing = linearScore(chasingRatio, 0.1, 0.4);
  const score = clamp(0.4 * fomoLate + 0.6 * fomoChasing, 0, 100);

  const triggeredRules: string[] = [];
  if (lateTradeRatio > 0.2)
    triggeredRules.push(
      `${lateTrades.length} trade(s) (${(lateTradeRatio * 100).toFixed(0)}%) entered in the last 20% of the session`,
    );
  if (chasingCount > 0)
    triggeredRules.push(
      `${chasingCount} trade(s) entered while in drawdown after consecutive losses`,
    );

  return {
    type: BiasType.FOMO,
    score: Math.round(score),
    metrics: {
      lateTradeRatio,
      chasingRatio,
      fomoLate,
      fomoChasing,
      lateTrades: lateTrades.length,
      chasingCount,
    },
    triggeredRules,
  };
}

// ═══════════════════════════════════════════════════════════════
//  GREED / OVERCONFIDENCE
// ═══════════════════════════════════════════════════════════════
//
// Metrics:
//   sizeIncreaseAfterWins = avg size of trades after 3+ win streak
//                           / baseline avg size
//   profitGiveBack        = (peakPnl - totalPnl) / peakPnl
//                           (how much of peak profit was given back)
//
// Score:
//   sizeScore    = linearScore(sizeIncrease, 1.0, 3.0)
//   givebackScore = linearScore(profitGiveBack, 0.1, 0.6)
//   final        = 0.5 × sizeScore + 0.5 × givebackScore
// ═══════════════════════════════════════════════════════════════

export function computeGreedBias(
  session: Session,
  _baseline: UserBaseline,
): BiasDetail {
  const trades = session.trades;

  // Size increase after winning streaks
  const postStreakSizes: number[] = [];
  let winStreak = 0;
  for (const trade of trades) {
    if (trade.isWin) {
      winStreak++;
    } else {
      if (winStreak >= 3) {
        postStreakSizes.push(trade.sizeRelativeToBaseline);
      }
      winStreak = 0;
    }
  }

  const avgPostStreakSize =
    postStreakSizes.length > 0
      ? postStreakSizes.reduce((a, b) => a + b, 0) / postStreakSizes.length
      : 1;

  // Profit giveback
  const profitGiveBack =
    session.peakPnl > 0
      ? (session.peakPnl - session.totalPnl) / session.peakPnl
      : 0;

  const sizeScore = linearScore(avgPostStreakSize, 1.0, 3.0);
  const givebackScore = linearScore(profitGiveBack, 0.1, 0.6);
  const score = clamp(0.5 * sizeScore + 0.5 * givebackScore, 0, 100);

  const triggeredRules: string[] = [];
  if (avgPostStreakSize > 1.3)
    triggeredRules.push(
      `Position size increased to ${avgPostStreakSize.toFixed(1)}× baseline after winning streaks`,
    );
  if (profitGiveBack > 0.2)
    triggeredRules.push(
      `Gave back ${(profitGiveBack * 100).toFixed(0)}% of peak session profit`,
    );

  return {
    type: BiasType.GREED,
    score: Math.round(score),
    metrics: {
      avgPostStreakSize,
      profitGiveBack,
      postStreakCount: postStreakSizes.length,
      sizeScore,
      givebackScore,
    },
    triggeredRules,
  };
}

// ═══════════════════════════════════════════════════════════════
//  AGGREGATE ALL BIASES
// ═══════════════════════════════════════════════════════════════

/**
 * Compute all five bias scores for a session.
 * Returns both the aggregate BiasScores and detailed BiasDetail[].
 */
export function computeAllBiases(
  session: Session,
  baseline: UserBaseline,
): { scores: BiasScores; details: BiasDetail[] } {
  const details = [
    computeOvertradingBias(session, baseline),
    computeLossAversionBias(session, baseline),
    computeRevengeTradingBias(session, baseline),
    computeFomoBias(session, baseline),
    computeGreedBias(session, baseline),
  ];

  // Weighted average: equal weights for aggregate
  const sumScores = details.reduce((sum, d) => sum + d.score, 0);
  const aggregate = Math.round(sumScores / details.length);

  const scores: BiasScores = {
    [BiasType.OVERTRADING]: details[0].score,
    [BiasType.LOSS_AVERSION]: details[1].score,
    [BiasType.REVENGE_TRADING]: details[2].score,
    [BiasType.FOMO]: details[3].score,
    [BiasType.GREED]: details[4].score,
    aggregate,
  };

  return { scores, details };
}
