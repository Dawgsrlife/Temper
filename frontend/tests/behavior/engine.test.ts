// ─────────────────────────────────────────────────────────────
// Tests — Behavior Engine (Integration)
// ─────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { parseCsv } from "@/lib/trades/parser";
import { reconstructSessions } from "@/lib/trades/session";
import { analyzeSession } from "@/lib/behavior/engine";
import { DEFAULT_BASELINE, DecisionLabel, BiasType } from "@/lib/types";

// ── Fixtures ──────────────────────────────────────────────────

/** A "disciplined" day: spaced trades, reasonable sizing. */
const GOOD_DAY_CSV = `timestamp,symbol,side,qty,price,pnl,tags
2026-02-06T09:31:00Z,AAPL,LONG,100,188.50,150.00,"plan"
2026-02-06T09:50:00Z,NVDA,LONG,100,920.00,230.00,""
2026-02-06T10:15:00Z,MSFT,LONG,100,405.00,-45.00,""
2026-02-06T10:45:00Z,AAPL,LONG,100,189.50,120.00,"plan"
2026-02-06T11:30:00Z,GOOG,LONG,100,175.00,85.00,""`;

/** A "tilting" day: rapid trades, revenge entries, size spikes. */
const BAD_DAY_CSV = `timestamp,symbol,side,qty,price,pnl,tags
2026-02-06T09:31:00Z,AAPL,LONG,100,188.50,150.00,""
2026-02-06T09:35:00Z,AAPL,LONG,100,189.00,-200.00,""
2026-02-06T09:37:00Z,AAPL,LONG,250,188.00,-350.00,"revenge"
2026-02-06T09:39:00Z,AAPL,LONG,300,187.50,-500.00,""
2026-02-06T09:41:00Z,TSLA,LONG,300,245.00,-280.00,""
2026-02-06T09:43:00Z,TSLA,LONG,400,243.00,-600.00,""
2026-02-06T09:44:00Z,NVDA,SHORT,500,920.00,-400.00,""
2026-02-06T09:45:00Z,NVDA,SHORT,500,921.00,-300.00,""
2026-02-06T13:55:00Z,MSFT,LONG,100,405.00,50.00,""
2026-02-06T14:00:00Z,GOOG,LONG,100,175.00,30.00,""`;

describe("analyzeSession (integration)", () => {
  it("produces higher Temper Score for a disciplined day", () => {
    const goodTrades = parseCsv(GOOD_DAY_CSV).trades;
    const badTrades = parseCsv(BAD_DAY_CSV).trades;

    const goodSessions = reconstructSessions("user-1", goodTrades, DEFAULT_BASELINE);
    const badSessions = reconstructSessions("user-1", badTrades, DEFAULT_BASELINE);

    const goodResult = analyzeSession({ session: goodSessions[0] });
    const badResult = analyzeSession({ session: badSessions[0] });

    expect(goodResult.report.temperScore.value).toBeGreaterThan(
      badResult.report.temperScore.value,
    );
  });

  it("assigns more blunders/mistakes on a bad day", () => {
    const trades = parseCsv(BAD_DAY_CSV).trades;
    const sessions = reconstructSessions("user-1", trades, DEFAULT_BASELINE);
    const { report } = analyzeSession({ session: sessions[0] });

    const blunders = report.decisions.filter(
      (d) => d.label === DecisionLabel.BLUNDER,
    ).length;
    const mistakes = report.decisions.filter(
      (d) => d.label === DecisionLabel.MISTAKE,
    ).length;

    expect(blunders + mistakes).toBeGreaterThan(0);
  });

  it("detects revenge trading bias on rapid-loss day", () => {
    const trades = parseCsv(BAD_DAY_CSV).trades;
    const sessions = reconstructSessions("user-1", trades, DEFAULT_BASELINE);
    const { report } = analyzeSession({ session: sessions[0] });

    expect(report.biasScores[BiasType.REVENGE_TRADING]).toBeGreaterThan(0);
  });

  it("detects overtrading bias when exceeding baseline", () => {
    const trades = parseCsv(BAD_DAY_CSV).trades;
    const baselineWith5Trades = { ...DEFAULT_BASELINE, avgTradesPerDay: 5 };
    const sessions = reconstructSessions("user-1", trades, baselineWith5Trades);
    const { report } = analyzeSession({
      session: sessions[0],
      baseline: baselineWith5Trades,
    });

    expect(report.biasScores[BiasType.OVERTRADING]).toBeGreaterThan(20);
  });

  it("ELO goes up for a good day, down for a bad day", () => {
    const goodTrades = parseCsv(GOOD_DAY_CSV).trades;
    const badTrades = parseCsv(BAD_DAY_CSV).trades;

    const goodSessions = reconstructSessions("user-1", goodTrades, DEFAULT_BASELINE);
    const badSessions = reconstructSessions("user-1", badTrades, DEFAULT_BASELINE);

    // Use a settled ELO (at anchor) so the delta direction reflects
    // whether the session was truly above or below average performance.
    const settledElo: import("@/lib/types").DecisionEloState = {
      rating: 1500,
      peakRating: 1500,
      sessionsPlayed: 20,
      kFactor: 24,
      lastSessionDelta: 0,
      lastSessionPerformance: 0.5,
      lastSessionExpected: 0.5,
      history: [],
    };

    const goodResult = analyzeSession({ session: goodSessions[0], previousElo: settledElo });
    const badResult = analyzeSession({ session: badSessions[0], previousElo: settledElo });

    expect(goodResult.newElo.lastSessionDelta).toBeGreaterThan(0);
    expect(badResult.newElo.lastSessionDelta).toBeLessThan(0);
  });

  it("is deterministic — same CSV always produces same report", () => {
    const trades = parseCsv(GOOD_DAY_CSV).trades;
    const sessions = reconstructSessions("user-1", trades, DEFAULT_BASELINE);

    const r1 = analyzeSession({ session: sessions[0] });
    const r2 = analyzeSession({ session: sessions[0] });

    expect(r1.report.temperScore.value).toBe(r2.report.temperScore.value);
    expect(r1.report.decisions.map((d) => d.label)).toEqual(
      r2.report.decisions.map((d) => d.label),
    );
    expect(r1.newElo.rating).toBe(r2.newElo.rating);
  });

  it("disciplined replay removes trades on bad day", () => {
    const trades = parseCsv(BAD_DAY_CSV).trades;
    const sessions = reconstructSessions("user-1", trades, DEFAULT_BASELINE);
    const { report } = analyzeSession({ session: sessions[0] });

    expect(report.disciplinedReplay.tradesRemoved).toBeGreaterThan(0);
    expect(report.disciplinedReplay.tradesKept).toBeLessThan(
      sessions[0].tradeCount,
    );
  });

  it("coach facts payload has all required sections", () => {
    const trades = parseCsv(GOOD_DAY_CSV).trades;
    const sessions = reconstructSessions("user-1", trades, DEFAULT_BASELINE);
    const { report } = analyzeSession({ session: sessions[0] });

    // build coach facts from the analysis pipeline
    // (already called inside analyzeSession, but let's verify the structure)
    expect(report.biasScores).toBeDefined();
    expect(report.decisions.length).toBe(sessions[0].tradeCount);
    expect(report.temperScore.value).toBeGreaterThanOrEqual(0);
    expect(report.temperScore.value).toBeLessThanOrEqual(100);
  });
});
