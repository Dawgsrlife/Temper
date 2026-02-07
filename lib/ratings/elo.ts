// ─────────────────────────────────────────────────────────────
// Temper – Decision ELO Rating System
// ─────────────────────────────────────────────────────────────
// An ELO-like rating for decision quality over time.
// NOT based on P/L — based on behavioral discipline.
//
// ┌──────────────────────────────────────────────────────────┐
// │  Starting rating:  1200                                  │
// │  K-factor:         max(16, 40 − sessionsPlayed × 0.8)   │
// │                    → decays from 40 → 16 over ~30 games  │
// │  Anchor:           1500 (average-day reference)          │
// │  Expected perf:    E = 1 / (1 + 10^((1500 − R) / 400)) │
// │  Actual perf:      S = mean(eloValue for each trade)     │
// │  Update:           R' = R + K × (S − E)                 │
// └──────────────────────────────────────────────────────────┘
//
// Properties:
//   • Deterministic for a given input sequence
//   • Monotonic: good sessions → rating up, bad → down
//   • K-factor ensures new users move quickly, settled users
//     change slowly (like real ELO)
//   • Rating is unbounded but typically 800–2000
// ─────────────────────────────────────────────────────────────

import type { DecisionEloState, DecisionEvent, EloHistoryEntry } from "@/lib/types";

// ── Constants ─────────────────────────────────────────────────

const INITIAL_RATING = 1200;
const ANCHOR_RATING = 1500; // neutral "expected" reference
const K_FACTOR_MAX = 40;
const K_FACTOR_MIN = 16;
const K_DECAY_RATE = 0.8; // K decreases by this per session

/** Default ELO state for a brand-new user. */
export const DEFAULT_ELO_STATE: DecisionEloState = {
  rating: INITIAL_RATING,
  peakRating: INITIAL_RATING,
  sessionsPlayed: 0,
  kFactor: K_FACTOR_MAX,
  lastSessionDelta: 0,
  lastSessionPerformance: 0,
  lastSessionExpected: 0,
  history: [],
};

// ── Core functions ────────────────────────────────────────────

/**
 * Compute K-factor based on number of sessions played.
 * Decays linearly from 40 → 16 over ~30 sessions.
 */
export function computeKFactor(sessionsPlayed: number): number {
  return Math.max(K_FACTOR_MIN, K_FACTOR_MAX - sessionsPlayed * K_DECAY_RATE);
}

/**
 * Compute expected performance E for a given rating.
 *
 *   E = 1 / (1 + 10^((anchor − rating) / 400))
 *
 * When rating = anchor (1500), E = 0.5 (average).
 * When rating < anchor, E < 0.5 (expected to do worse).
 * When rating > anchor, E > 0.5 (expected to do better).
 */
export function computeExpectedPerformance(rating: number): number {
  return 1 / (1 + Math.pow(10, (ANCHOR_RATING - rating) / 400));
}

/**
 * Compute actual session performance S from decision events.
 *
 *   S = mean(eloValue for each trade)
 *
 * Each eloValue is 0.0 (BLUNDER) to 1.0 (BRILLIANT).
 * A perfectly average day yields S ≈ 0.5.
 */
export function computeSessionPerformance(
  decisions: DecisionEvent[],
): number {
  if (decisions.length === 0) return 0.5;
  const sum = decisions.reduce((acc, d) => acc + d.eloValue, 0);
  return sum / decisions.length;
}

/**
 * Update the decision ELO after a session.
 *
 *   newRating = oldRating + K × (S − E)
 *
 * Returns a new DecisionEloState (immutable — does not mutate input).
 */
export function updateDecisionElo(
  previous: DecisionEloState,
  decisions: DecisionEvent[],
  date: string,
): DecisionEloState {
  const K = computeKFactor(previous.sessionsPlayed);
  const E = computeExpectedPerformance(previous.rating);
  const S = computeSessionPerformance(decisions);
  const delta = K * (S - E);
  const newRating = previous.rating + delta;
  const peakRating = Math.max(previous.peakRating, newRating);

  const historyEntry: EloHistoryEntry = {
    date,
    rating: Math.round(newRating * 10) / 10,
    delta: Math.round(delta * 10) / 10,
  };

  return {
    rating: Math.round(newRating * 10) / 10,
    peakRating: Math.round(peakRating * 10) / 10,
    sessionsPlayed: previous.sessionsPlayed + 1,
    kFactor: Math.round(K * 10) / 10,
    lastSessionDelta: Math.round(delta * 10) / 10,
    lastSessionPerformance: Math.round(S * 1000) / 1000,
    lastSessionExpected: Math.round(E * 1000) / 1000,
    history: [...previous.history, historyEntry],
  };
}

// ── Rating bracket labels (for UI) ───────────────────────────

export type RatingBracket =
  | "Beginner"
  | "Novice"
  | "Developing"
  | "Intermediate"
  | "Proficient"
  | "Advanced"
  | "Expert"
  | "Master"
  | "Grandmaster";

export function getRatingBracket(rating: number): RatingBracket {
  if (rating < 800) return "Beginner";
  if (rating < 1000) return "Novice";
  if (rating < 1200) return "Developing";
  if (rating < 1400) return "Intermediate";
  if (rating < 1600) return "Proficient";
  if (rating < 1800) return "Advanced";
  if (rating < 2000) return "Expert";
  if (rating < 2200) return "Master";
  return "Grandmaster";
}
