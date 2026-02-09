// ─────────────────────────────────────────────────────────────
// Temper – Session Reconstruction Layer
// ─────────────────────────────────────────────────────────────
// Groups RawTrade[] into Sessions, enriches each trade with
// derived fields (running P/L, drawdown, relative size, etc.).
// Pure functions — no side effects.
// ─────────────────────────────────────────────────────────────

import { v5 as uuidv5 } from "uuid";
import type {
  RawTrade,
  Trade,
  Session,
  UserBaseline,
} from "@/lib/types";
import { DEFAULT_BASELINE } from "@/lib/types";

// Deterministic UUID namespace for trade IDs
const TRADE_UUID_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

// ── Group trades by day ───────────────────────────────────────

/**
 * Group RawTrade[] into day buckets (YYYY-MM-DD).
 * Assumes trades are already sorted by timestamp.
 */
export function groupTradesByDay(
  trades: RawTrade[],
): Map<string, RawTrade[]> {
  const groups = new Map<string, RawTrade[]>();

  for (const trade of trades) {
    const date = trade.timestamp.slice(0, 10); // YYYY-MM-DD
    const existing = groups.get(date) ?? [];
    existing.push(trade);
    groups.set(date, existing);
  }

  return groups;
}

// ── Enrich trades ─────────────────────────────────────────────

/**
 * Enrich a sorted array of RawTrade[] into Trade[] with
 * derived fields. Deterministic for a given input and baseline.
 */
export function enrichTrades(
  rawTrades: RawTrade[],
  baseline: UserBaseline = DEFAULT_BASELINE,
): Trade[] {
  let runningPnl = 0;
  let peakPnl = 0;

  return rawTrades.map((raw, index) => {
    runningPnl += raw.pnl;
    peakPnl = Math.max(peakPnl, runningPnl);
    const drawdownFromPeak = runningPnl - peakPnl; // <= 0

    const timestampMs = new Date(raw.timestamp).getTime();
    const prevTimestampMs =
      index > 0
        ? new Date(rawTrades[index - 1].timestamp).getTime()
        : null;

    // Deterministic trade ID from session date + index
    const tradeId = uuidv5(`${raw.timestamp}-${index}`, TRADE_UUID_NAMESPACE);

    return {
      ...raw,
      id: tradeId,
      index,
      timestampMs,
      runningPnl,
      runningTradeCount: index + 1,
      drawdownFromPeak,
      peakPnlAtTrade: peakPnl,
      timeSinceLastTradeMs:
        prevTimestampMs !== null ? timestampMs - prevTimestampMs : null,
      sizeRelativeToBaseline:
        baseline.avgPositionSize > 0
          ? raw.quantity / baseline.avgPositionSize
          : 1,
      isWin: raw.pnl > 0,
      rMultiple: null, // computed later if risk-per-trade is known
    };
  });
}

// ── Build session ─────────────────────────────────────────────

/**
 * Build a Session object from enriched trades for a single day.
 * Pure function — all aggregates computed deterministically.
 */
export function buildSession(
  userId: string,
  date: string,
  trades: Trade[],
): Session {
  const sessionId = uuidv5(`${userId}-${date}`, TRADE_UUID_NAMESPACE);

  const wins = trades.filter((t) => t.isWin);
  const losses = trades.filter((t) => !t.isWin);

  const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
  const grossWins = wins.reduce((sum, t) => sum + t.pnl, 0);
  const grossLosses = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));

  let maxDrawdown = 0;
  for (const t of trades) {
    if (t.drawdownFromPeak < maxDrawdown) maxDrawdown = t.drawdownFromPeak;
  }

  // Max runup: biggest positive move from a trough
  let minPnl = 0;
  let maxRunup = 0;
  for (const t of trades) {
    minPnl = Math.min(minPnl, t.runningPnl);
    maxRunup = Math.max(maxRunup, t.runningPnl - minPnl);
  }

  let peakPnl = 0;
  for (const t of trades) {
    if (t.peakPnlAtTrade > peakPnl) peakPnl = t.peakPnlAtTrade;
  }

  // Holding times: approximate via time between consecutive trades
  // In a real system, we'd track open/close pairs. For MVP, we use
  // timeSinceLastTrade as a proxy for the previous trade's duration.
  const holdingTimes = trades
    .filter((t) => t.timeSinceLastTradeMs !== null)
    .map((t) => t.timeSinceLastTradeMs as number);

  const winHoldingTimes = trades
    .filter(
      (t, i) =>
        i > 0 && trades[i - 1].isWin && t.timeSinceLastTradeMs !== null,
    )
    .map((t) => t.timeSinceLastTradeMs as number);

  const lossHoldingTimes = trades
    .filter(
      (t, i) =>
        i > 0 && !trades[i - 1].isWin && t.timeSinceLastTradeMs !== null,
    )
    .map((t) => t.timeSinceLastTradeMs as number);

  const avg = (arr: number[]) =>
    arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  const firstTs = trades[0]?.timestampMs ?? 0;
  const lastTs = trades[trades.length - 1]?.timestampMs ?? 0;

  return {
    id: sessionId,
    userId,
    date,
    trades,
    totalPnl,
    maxDrawdown,
    maxRunup,
    tradeCount: trades.length,
    winCount: wins.length,
    lossCount: losses.length,
    winRate: trades.length > 0 ? wins.length / trades.length : 0,
    avgWin: wins.length > 0 ? grossWins / wins.length : 0,
    avgLoss: losses.length > 0 ? -(grossLosses / losses.length) : 0,
    profitFactor: grossLosses > 0 ? grossWins / grossLosses : Infinity,
    largestWin: wins.length > 0 ? wins.reduce((best, t) => (t.pnl > best ? t.pnl : best), wins[0].pnl) : 0,
    largestLoss:
      losses.length > 0 ? losses.reduce((worst, t) => (t.pnl < worst ? t.pnl : worst), losses[0].pnl) : 0,
    avgHoldingTimeMs: avg(holdingTimes),
    avgWinHoldingTimeMs: avg(winHoldingTimes),
    avgLossHoldingTimeMs: avg(lossHoldingTimes),
    peakPnl,
    symbols: [...new Set(trades.map((t) => t.symbol))],
    durationMs: lastTs - firstTs,
    avgPositionSize:
      trades.length > 0
        ? trades.reduce((sum, t) => sum + t.quantity, 0) / trades.length
        : 0,
  };
}

// ── Full pipeline: RawTrade[] → Session[] ─────────────────────

/**
 * Reconstruct all sessions from raw trades.
 * Returns sessions sorted by date ascending.
 */
export function reconstructSessions(
  userId: string,
  rawTrades: RawTrade[],
  baseline: UserBaseline = DEFAULT_BASELINE,
): Session[] {
  const dayGroups = groupTradesByDay(rawTrades);
  const sessions: Session[] = [];

  for (const [date, dayTrades] of dayGroups) {
    const enriched = enrichTrades(dayTrades, baseline);
    const session = buildSession(userId, date, enriched);
    sessions.push(session);
  }

  return sessions.sort((a, b) => a.date.localeCompare(b.date));
}
