// ─────────────────────────────────────────────────────────────
// Temper – Disciplined Replay Engine
// ─────────────────────────────────────────────────────────────
// Deterministically replays a session under disciplined rules.
// For each trade, checks whether it would survive the rules:
//
//   1. Max daily loss: stop if cumulative P/L breaches limit
//   2. Max trade count: stop after N trades
//   3. Revenge window: skip if < 15 min after a loss
//   4. Oversize filter: skip if > 1.5× baseline size
//   5. Late entry cutoff: skip if past the time limit
//
// Output: DisciplinedSessionResult showing what the day would
// have looked like under these simple rules.
// ─────────────────────────────────────────────────────────────

import type {
  Session,
  Trade,
  UserBaseline,
  DisciplinedReplayRules,
  DisciplinedSessionResult,
  ReasonCode,
} from "@/lib/types";
import { DEFAULT_REPLAY_RULES } from "@/lib/types";

/**
 * Replay a session under disciplined rules.
 * Pure, deterministic function.
 */
export function runDisciplinedReplay(
  session: Session,
  baseline: UserBaseline,
  rules: DisciplinedReplayRules = DEFAULT_REPLAY_RULES,
): DisciplinedSessionResult {
  const keptTrades: Trade[] = [];
  const removedTradeIds: string[] = [];
  const removedReasons: Record<string, ReasonCode> = {};

  let runningPnl = 0;
  let tradesTaken = 0;
  let lastLossTimestampMs: number | null = null;
  const sessionStartMs = session.trades[0]?.timestampMs ?? 0;

  for (const trade of session.trades) {
    // ── Rule 1: Max daily loss ────────────────────────────
    if (runningPnl <= rules.maxDailyLossAbsolute) {
      removedTradeIds.push(trade.id);
      removedReasons[trade.id] = "MAX_LOSS_BREACH";
      continue;
    }

    // ── Rule 2: Max trade count ───────────────────────────
    if (tradesTaken >= rules.maxTradesPerDay) {
      removedTradeIds.push(trade.id);
      removedReasons[trade.id] = "OVERTRADE_CLUSTER";
      continue;
    }

    // ── Rule 3: Revenge window ────────────────────────────
    if (
      lastLossTimestampMs !== null &&
      trade.timestampMs - lastLossTimestampMs < rules.revengeWindowMs
    ) {
      removedTradeIds.push(trade.id);
      removedReasons[trade.id] = "REVENGE_AFTER_BIG_LOSS";
      continue;
    }

    // ── Rule 4: Oversize filter ───────────────────────────
    if (trade.sizeRelativeToBaseline > rules.maxPositionSizeMultiple) {
      removedTradeIds.push(trade.id);
      removedReasons[trade.id] = "SIZE_SPIKE_AFTER_STREAK";
      continue;
    }

    // ── Rule 5: Late entry cutoff ─────────────────────────
    if (
      rules.noEntryAfterTimeMs !== null &&
      trade.timestampMs - sessionStartMs > rules.noEntryAfterTimeMs
    ) {
      removedTradeIds.push(trade.id);
      removedReasons[trade.id] = "FOMO_LATE_ENTRY";
      continue;
    }

    // ── Trade survives all rules ──────────────────────────
    keptTrades.push(trade);
    runningPnl += trade.pnl;
    tradesTaken++;

    // Track last loss for revenge window
    if (!trade.isWin) {
      lastLossTimestampMs = trade.timestampMs;
    }
  }

  const disciplinedPnl = keptTrades.reduce((sum, t) => sum + t.pnl, 0);

  return {
    originalPnl: session.totalPnl,
    disciplinedPnl,
    tradesKept: keptTrades.length,
    tradesRemoved: removedTradeIds.length,
    removedTradeIds,
    removedReasons,
    disciplinedTrades: keptTrades,
    savings: disciplinedPnl - session.totalPnl,
  };
}
