// ─────────────────────────────────────────────────────────────
// Temper – Temper Score Calculator
// ─────────────────────────────────────────────────────────────
// Computes the day-level discipline score (0–100).
//
// Formula:
//   tradeScoreAvg = mean(DECISION_SCORE_WEIGHTS[label]) → 0–10
//   rawScore      = tradeScoreAvg × 10                  → 0–100
//   biasPenalty   = (sum(biasScores) / 500) × 20        → 0–20
//   value         = clamp(rawScore − biasPenalty, 0, 100)
//
// Deterministic for a given set of labels and bias scores.
// ─────────────────────────────────────────────────────────────

import type {
  DecisionEvent,
  BiasScores,
  TemperScore,
} from "@/lib/types";
import { DecisionLabel, clamp } from "@/lib/types";

/**
 * Compute the Temper Score for a session given its decision
 * events and bias scores.
 */
export function computeTemperScore(
  decisions: DecisionEvent[],
  biasScores: BiasScores,
): TemperScore {
  // ── Label distribution ──────────────────────────────────
  const labelDistribution = Object.fromEntries(
    Object.values(DecisionLabel).map((l) => [l, 0]),
  ) as Record<DecisionLabel, number>;

  for (const d of decisions) {
    labelDistribution[d.label]++;
  }

  // ── Raw score from trade labels ─────────────────────────
  const tradeScoreAvg =
    decisions.length > 0
      ? decisions.reduce((sum, d) => sum + d.scoreContribution, 0) /
        decisions.length
      : 5; // neutral default

  const rawScore = tradeScoreAvg * 10; // scale to 0–100

  // ── Bias penalty ────────────────────────────────────────
  // Sum of all 5 bias scores (each 0–100) → max 500
  // Penalty = (sum / 500) × 20 → max 20 points off
  const biasSum =
    biasScores.OVERTRADING +
    biasScores.LOSS_AVERSION +
    biasScores.REVENGE_TRADING +
    biasScores.FOMO +
    biasScores.GREED;
  const biasPenalty = (biasSum / 500) * 20;

  const value = clamp(Math.round(rawScore - biasPenalty), 0, 100);

  return {
    value,
    rawScore: Math.round(rawScore * 10) / 10,
    biasPenalty: Math.round(biasPenalty * 10) / 10,
    tradeScoreAvg: Math.round(tradeScoreAvg * 100) / 100,
    labelDistribution,
  };
}
