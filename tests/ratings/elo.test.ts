// ─────────────────────────────────────────────────────────────
// Tests — Decision ELO Rating System
// ─────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  DEFAULT_ELO_STATE,
  updateDecisionElo,
  computeKFactor,
  computeExpectedPerformance,
  computeSessionPerformance,
  getRatingBracket,
} from "@/lib/ratings/elo";
import type { DecisionEvent } from "@/lib/types";
import { DecisionLabel, DECISION_SYMBOLS, DECISION_SCORE_WEIGHTS, DECISION_ELO_VALUES } from "@/lib/types";

// Helper to make a quick decision event
function makeDecision(label: DecisionLabel): DecisionEvent {
  return {
    tradeId: "test",
    tradeIndex: 0,
    label,
    symbol: DECISION_SYMBOLS[label],
    reasons: [],
    scoreContribution: DECISION_SCORE_WEIGHTS[label],
    eloValue: DECISION_ELO_VALUES[label],
    explanation: "",
  };
}

describe("computeKFactor", () => {
  it("starts at 40 for new users", () => {
    expect(computeKFactor(0)).toBe(40);
  });

  it("decays towards 16", () => {
    expect(computeKFactor(30)).toBe(16);
    expect(computeKFactor(50)).toBe(16); // floored at 16
  });

  it("is monotonically decreasing", () => {
    for (let i = 0; i < 40; i++) {
      expect(computeKFactor(i + 1)).toBeLessThanOrEqual(computeKFactor(i));
    }
  });
});

describe("computeExpectedPerformance", () => {
  it("returns 0.5 at anchor rating (1500)", () => {
    const E = computeExpectedPerformance(1500);
    expect(E).toBeCloseTo(0.5, 4);
  });

  it("returns < 0.5 for ratings below anchor", () => {
    expect(computeExpectedPerformance(1200)).toBeLessThan(0.5);
  });

  it("returns > 0.5 for ratings above anchor", () => {
    expect(computeExpectedPerformance(1800)).toBeGreaterThan(0.5);
  });
});

describe("computeSessionPerformance", () => {
  it("returns 1.0 for all BRILLIANT session", () => {
    const decisions = Array(5).fill(null).map(() => makeDecision(DecisionLabel.BRILLIANT));
    expect(computeSessionPerformance(decisions)).toBe(1.0);
  });

  it("returns 0.0 for all BLUNDER session", () => {
    const decisions = Array(5).fill(null).map(() => makeDecision(DecisionLabel.BLUNDER));
    expect(computeSessionPerformance(decisions)).toBe(0.0);
  });

  it("returns 0.5 for empty session", () => {
    expect(computeSessionPerformance([])).toBe(0.5);
  });
});

describe("updateDecisionElo", () => {
  it("increases rating for a great session", () => {
    const decisions = Array(10).fill(null).map(() => makeDecision(DecisionLabel.EXCELLENT));
    const newElo = updateDecisionElo(DEFAULT_ELO_STATE, decisions, "2026-02-06");
    expect(newElo.rating).toBeGreaterThan(DEFAULT_ELO_STATE.rating);
    expect(newElo.lastSessionDelta).toBeGreaterThan(0);
  });

  it("decreases rating for a terrible session", () => {
    const decisions = Array(10).fill(null).map(() => makeDecision(DecisionLabel.BLUNDER));
    const newElo = updateDecisionElo(DEFAULT_ELO_STATE, decisions, "2026-02-06");
    expect(newElo.rating).toBeLessThan(DEFAULT_ELO_STATE.rating);
    expect(newElo.lastSessionDelta).toBeLessThan(0);
  });

  it("increments sessionsPlayed", () => {
    const decisions = [makeDecision(DecisionLabel.GOOD)];
    const newElo = updateDecisionElo(DEFAULT_ELO_STATE, decisions, "2026-02-06");
    expect(newElo.sessionsPlayed).toBe(1);
  });

  it("tracks peak rating", () => {
    const decisions = Array(10).fill(null).map(() => makeDecision(DecisionLabel.BRILLIANT));
    const elo1 = updateDecisionElo(DEFAULT_ELO_STATE, decisions, "2026-02-06");
    const bad = Array(10).fill(null).map(() => makeDecision(DecisionLabel.BLUNDER));
    const elo2 = updateDecisionElo(elo1, bad, "2026-02-07");
    expect(elo2.peakRating).toBe(elo1.rating);
    expect(elo2.rating).toBeLessThan(elo2.peakRating);
  });

  it("appends to history", () => {
    const decisions = [makeDecision(DecisionLabel.BOOK)];
    const elo1 = updateDecisionElo(DEFAULT_ELO_STATE, decisions, "2026-02-06");
    const elo2 = updateDecisionElo(elo1, decisions, "2026-02-07");
    expect(elo2.history).toHaveLength(2);
    expect(elo2.history[0].date).toBe("2026-02-06");
    expect(elo2.history[1].date).toBe("2026-02-07");
  });

  it("is deterministic — same inputs produce same output", () => {
    const decisions = [
      makeDecision(DecisionLabel.GOOD),
      makeDecision(DecisionLabel.MISTAKE),
      makeDecision(DecisionLabel.EXCELLENT),
    ];
    const r1 = updateDecisionElo(DEFAULT_ELO_STATE, decisions, "2026-02-06");
    const r2 = updateDecisionElo(DEFAULT_ELO_STATE, decisions, "2026-02-06");
    expect(r1.rating).toBe(r2.rating);
    expect(r1.lastSessionDelta).toBe(r2.lastSessionDelta);
  });
});

describe("getRatingBracket", () => {
  it("returns correct brackets", () => {
    expect(getRatingBracket(700)).toBe("Beginner");
    expect(getRatingBracket(1100)).toBe("Developing");
    expect(getRatingBracket(1200)).toBe("Intermediate");
    expect(getRatingBracket(1800)).toBe("Expert");
    expect(getRatingBracket(2200)).toBe("Grandmaster");
  });
});
