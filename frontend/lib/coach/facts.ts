// ─────────────────────────────────────────────────────────────
// Temper – Coach Facts Builder
// ─────────────────────────────────────────────────────────────
// Transforms raw engine output into the strict CoachFactsPayload
// that is safe for an LLM to consume.
//
// Constraints:
//   • No raw trade data (only indices, labels, aggregates)
//   • No user PII
//   • No free-text (only structured fields)
//   • LLM may ONLY reference fields that exist in this payload
// ─────────────────────────────────────────────────────────────

import type {
  TemperReport,
  CoachFactsPayload,
  DecisionEvent,
  BiasType,
} from "@/lib/types";
import {
  DecisionLabel,
  DECISION_SYMBOLS,
} from "@/lib/types";
import { formatDuration } from "@/lib/utils";

// ── Tilt sequence detection ───────────────────────────────────

interface TiltSequence {
  startIndex: number;
  endIndex: number;
  durationDescription: string;
  aggregatePnl: number;
  dominantBias: BiasType;
}

/**
 * Detect "tilt sequences" — consecutive trades that are all
 * INACCURACY, MISTAKE, or BLUNDER.
 */
function detectTiltSequences(
  report: TemperReport,
): TiltSequence[] {
  const BAD_LABELS = new Set([
    DecisionLabel.INACCURACY,
    DecisionLabel.MISTAKE,
    DecisionLabel.MISS,
    DecisionLabel.BLUNDER,
    DecisionLabel.MEGABLUNDER,
  ]);

  const sequences: TiltSequence[] = [];
  let start: number | null = null;

  for (let i = 0; i <= report.decisions.length; i++) {
    const d = report.decisions[i];
    const isBad = d && BAD_LABELS.has(d.label);

    if (isBad && start === null) {
      start = i;
    } else if (!isBad && start !== null) {
      const end = i - 1;
      // Only count as tilt if 2+ trades
      if (end - start >= 1) {
        const tiltTrades = report.session.trades.slice(start, end + 1);
        const pnl = tiltTrades.reduce((sum, t) => sum + t.pnl, 0);
        const durationMs =
          tiltTrades.length > 1
            ? tiltTrades[tiltTrades.length - 1].timestampMs -
              tiltTrades[0].timestampMs
            : 0;

        // Determine dominant bias from the tilt reasons
        const dominantBias = findDominantBias(
          report.decisions.slice(start, end + 1),
        );

        sequences.push({
          startIndex: start,
          endIndex: end,
          durationDescription: formatDuration(durationMs),
          aggregatePnl: Math.round(pnl * 100) / 100,
          dominantBias,
        });
      }
      start = null;
    }
  }

  return sequences;
}

function findDominantBias(events: DecisionEvent[]): BiasType {
  const counts: Record<string, number> = {};
  const biasReasons: Record<string, BiasType> = {
    REVENGE_AFTER_BIG_LOSS: "REVENGE_TRADING" as BiasType,
    OVERTRADE_CLUSTER: "OVERTRADING" as BiasType,
    FOMO_LATE_ENTRY: "FOMO" as BiasType,
    FOMO_CHASING_MOMENTUM: "FOMO" as BiasType,
    SIZE_SPIKE_AFTER_STREAK: "GREED" as BiasType,
    GREED_SIZE_INCREASE: "GREED" as BiasType,
    LOSS_HELD_TOO_LONG: "LOSS_AVERSION" as BiasType,
    MAX_LOSS_BREACH: "REVENGE_TRADING" as BiasType,
  };

  for (const event of events) {
    for (const reason of event.reasons) {
      const bias = biasReasons[reason];
      if (bias) {
        counts[bias] = (counts[bias] ?? 0) + 1;
      }
    }
  }

  // Default to REVENGE_TRADING if no clear dominant
  let max = 0;
  let dominant: BiasType = "REVENGE_TRADING" as BiasType;
  for (const [bias, count] of Object.entries(counts)) {
    if (count > max) {
      max = count;
      dominant = bias as BiasType;
    }
  }
  return dominant;
}

// ── Streak detection ──────────────────────────────────────────

const GOOD_LABELS = new Set([
  DecisionLabel.BRILLIANT,
  DecisionLabel.GREAT,
  DecisionLabel.BEST,
  DecisionLabel.EXCELLENT,
  DecisionLabel.GOOD,
  DecisionLabel.BOOK,
  DecisionLabel.WINNER,
]);

function findBestAndWorstStreaks(decisions: DecisionEvent[]) {
  let bestStreak = { startIndex: 0, endIndex: 0, labels: [] as DecisionLabel[] };
  let worstStreak = { startIndex: 0, endIndex: 0, labels: [] as DecisionLabel[] };

  let currentGoodStart = 0;
  let currentGoodLabels: DecisionLabel[] = [];
  let currentBadStart = 0;
  let currentBadLabels: DecisionLabel[] = [];

  for (let i = 0; i < decisions.length; i++) {
    const isGood = GOOD_LABELS.has(decisions[i].label);

    if (isGood) {
      currentGoodLabels.push(decisions[i].label);
      if (currentGoodLabels.length > bestStreak.labels.length) {
        bestStreak = {
          startIndex: currentGoodStart,
          endIndex: i,
          labels: [...currentGoodLabels],
        };
      }
      // Reset bad streak
      currentBadLabels = [];
      currentBadStart = i + 1;
    } else {
      currentBadLabels.push(decisions[i].label);
      if (currentBadLabels.length > worstStreak.labels.length) {
        worstStreak = {
          startIndex: currentBadStart,
          endIndex: i,
          labels: [...currentBadLabels],
        };
      }
      // Reset good streak
      currentGoodLabels = [];
      currentGoodStart = i + 1;
    }
  }

  return { bestStreak, worstStreak };
}

// ═══════════════════════════════════════════════════════════════
//  MAIN EXPORT
// ═══════════════════════════════════════════════════════════════

/**
 * Build the CoachFactsPayload from a completed TemperReport.
 * This is the ONLY interface between the engine and the LLM.
 */
export function buildCoachFacts(report: TemperReport): CoachFactsPayload {
  // ── Overview ────────────────────────────────────────────
  const overview = {
    date: report.date,
    temperScore: report.temperScore.value,
    eloBefore: report.eloBefore,
    eloAfter: report.eloAfter,
    eloDelta: report.eloDelta,
    totalTrades: report.session.tradeCount,
    winRate: Math.round(report.session.winRate * 1000) / 1000,
    totalPnl: Math.round(report.session.totalPnl * 100) / 100,
    maxDrawdown: Math.round(report.session.maxDrawdown * 100) / 100,
  };

  // ── Biases ──────────────────────────────────────────────
  const biases = report.biasDetails.map((bd) => ({
    type: bd.type,
    score: bd.score,
    isTriggered: bd.score >= 40,
    topMetric:
      bd.triggeredRules[0] ?? `Score: ${bd.score}/100`,
  }));

  // ── Label summary ───────────────────────────────────────
  const dist = report.temperScore.labelDistribution;
  const totalDecisions = report.decisions.length;
  const labelSummary = Object.values(DecisionLabel)
    .filter((l) => dist[l] > 0)
    .map((l) => ({
      label: l,
      symbol: DECISION_SYMBOLS[l],
      count: dist[l],
      percentage:
        totalDecisions > 0
          ? Math.round((dist[l] / totalDecisions) * 1000) / 10
          : 0,
    }));

  // ── Key events (top 5 by severity) ──────────────────────
  const severity: Record<DecisionLabel, number> = {
    [DecisionLabel.MEGABLUNDER]: 12,
    [DecisionLabel.BLUNDER]: 10,
    [DecisionLabel.CHECKMATED]: 9,
    [DecisionLabel.MISTAKE]: 8,
    [DecisionLabel.BRILLIANT]: 7,
    [DecisionLabel.RESIGN]: 6,
    [DecisionLabel.INACCURACY]: 5,
    [DecisionLabel.MISS]: 4.5,
    [DecisionLabel.EXCELLENT]: 4,
    [DecisionLabel.GREAT]: 3.5,
    [DecisionLabel.BEST]: 3,
    [DecisionLabel.WINNER]: 2.5,
    [DecisionLabel.GOOD]: 2,
    [DecisionLabel.INTERESTING]: 1.5,
    [DecisionLabel.BOOK]: 1,
    [DecisionLabel.FORCED]: 0.5,
    [DecisionLabel.DRAW]: 0,
  };

  const keyEvents = [...report.decisions]
    .sort((a, b) => severity[b.label] - severity[a.label])
    .slice(0, 8)
    .map((d) => {
      const trade = report.session.trades[d.tradeIndex];
      return {
        tradeIndex: d.tradeIndex,
        timestamp: trade?.timestamp ?? "",
        label: d.label,
        symbol: d.symbol,
        reasons: d.reasons,
        pnl: Math.round((trade?.pnl ?? 0) * 100) / 100,
        explanation: d.explanation,
      };
    });

  // ── Tilt sequences ──────────────────────────────────────
  const tiltSequences = detectTiltSequences(report);

  // ── Disciplined replay ──────────────────────────────────
  const disciplinedReplay = {
    originalPnl: Math.round(report.disciplinedReplay.originalPnl * 100) / 100,
    disciplinedPnl:
      Math.round(report.disciplinedReplay.disciplinedPnl * 100) / 100,
    tradesRemoved: report.disciplinedReplay.tradesRemoved,
    savings: Math.round(report.disciplinedReplay.savings * 100) / 100,
  };

  // ── Streaks ─────────────────────────────────────────────
  const streaks = findBestAndWorstStreaks(report.decisions);

  return {
    overview,
    biases,
    labelSummary,
    keyEvents,
    tiltSequences,
    disciplinedReplay,
    streaks,
  };
}
