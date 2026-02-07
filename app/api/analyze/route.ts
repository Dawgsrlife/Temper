export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// POST /api/analyze
// ─────────────────────────────────────────────────────────────
// Triggers the full analysis pipeline for a TradeSet:
//   parse → sessions → behavior engine → ELO → store reports
// Returns the generated TemperReport IDs.
// ─────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/prisma";
import { parseCsv } from "@/lib/trades/parser";
import { reconstructSessions } from "@/lib/trades/session";
import { analyzeSession } from "@/lib/behavior/engine";
import { buildCoachFacts } from "@/lib/coach/facts";
import { DEFAULT_ELO_STATE } from "@/lib/ratings/elo";
import type { UserBaseline, DecisionEloState } from "@/lib/types";
import { DEFAULT_BASELINE } from "@/lib/types";

const AnalyzeRequestSchema = z.object({
  tradeSetId: z.string().min(1),
  userId: z.string().default("demo-user"),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tradeSetId, userId } = AnalyzeRequestSchema.parse(body);

    // Fetch the trade set
    const tradeSet = await db.tradeSet.findUnique({
      where: { id: tradeSetId },
    });

    if (!tradeSet) {
      return NextResponse.json(
        { error: "Trade set not found" },
        { status: 404 },
      );
    }

    // Parse CSV
    const parseResult = parseCsv(tradeSet.rawCsv);
    if (parseResult.validRows === 0) {
      return NextResponse.json(
        { error: "No valid trades in trade set" },
        { status: 422 },
      );
    }

    // Load user baseline (or use defaults)
    const userBaseline = await db.userBaseline.findUnique({
      where: { userId },
    });
    const baseline: UserBaseline = userBaseline
      ? {
          avgTradesPerDay: userBaseline.avgTradesPerDay,
          avgPositionSize: userBaseline.avgPositionSize,
          avgDailyPnl: userBaseline.avgDailyPnl,
          avgWinRate: userBaseline.avgWinRate,
          avgHoldingTimeMs: userBaseline.avgHoldingTimeMs,
          avgWinHoldingTimeMs: userBaseline.avgWinHoldingTimeMs,
          avgLossHoldingTimeMs: userBaseline.avgLossHoldingTimeMs,
          sessionsCount: userBaseline.sessionsCount,
        }
      : DEFAULT_BASELINE;

    // Load current ELO state
    const eloRecord = await db.decisionElo.findUnique({
      where: { userId },
    });
    let currentElo: DecisionEloState = eloRecord
      ? {
          rating: eloRecord.rating,
          peakRating: eloRecord.peakRating,
          sessionsPlayed: eloRecord.sessionsPlayed,
          kFactor: Math.max(16, 40 - eloRecord.sessionsPlayed * 0.8),
          lastSessionDelta: 0,
          lastSessionPerformance: 0,
          lastSessionExpected: 0,
          history: eloRecord.history as unknown as DecisionEloState["history"],
        }
      : DEFAULT_ELO_STATE;

    // Reconstruct sessions
    const sessions = reconstructSessions(userId, parseResult.trades, baseline);

    const reportIds: string[] = [];

    // Analyze each session
    for (const session of sessions) {
      // Store session
      const dbSession = await db.session.create({
        data: {
          id: session.id,
          tradeSetId,
          userId,
          date: session.date,
          tradesJson: JSON.parse(JSON.stringify(session.trades)),
          aggregates: JSON.parse(
            JSON.stringify({
              totalPnl: session.totalPnl,
              maxDrawdown: session.maxDrawdown,
              tradeCount: session.tradeCount,
              winRate: session.winRate,
              avgWin: session.avgWin,
              avgLoss: session.avgLoss,
              profitFactor: session.profitFactor,
              symbols: session.symbols,
            }),
          ),
        },
      });

      // Run behavior engine
      const { report, newElo } = analyzeSession({
        session,
        baseline,
        previousElo: currentElo,
      });

      // Build coach facts
      const coachFacts = buildCoachFacts(report);

      // Store report
      await db.temperReport.create({
        data: {
          id: report.id,
          sessionId: dbSession.id,
          userId,
          date: report.date,
          biasScores: JSON.parse(JSON.stringify(report.biasScores)),
          biasDetails: JSON.parse(JSON.stringify(report.biasDetails)),
          decisions: JSON.parse(JSON.stringify(report.decisions)),
          temperScore: JSON.parse(JSON.stringify(report.temperScore)),
          eloBefore: report.eloBefore,
          eloAfter: report.eloAfter,
          eloDelta: report.eloDelta,
          replayResult: JSON.parse(
            JSON.stringify(report.disciplinedReplay),
          ),
          coachFacts: JSON.parse(JSON.stringify(coachFacts)),
        },
      });

      // Update ELO state for next session
      currentElo = newElo;
      reportIds.push(report.id);
    }

    // Persist final ELO state
    await db.decisionElo.upsert({
      where: { userId },
      create: {
        userId,
        rating: currentElo.rating,
        peakRating: currentElo.peakRating,
        sessionsPlayed: currentElo.sessionsPlayed,
        history: JSON.parse(JSON.stringify(currentElo.history)),
      },
      update: {
        rating: currentElo.rating,
        peakRating: currentElo.peakRating,
        sessionsPlayed: currentElo.sessionsPlayed,
        history: JSON.parse(JSON.stringify(currentElo.history)),
      },
    });

    // Update user baseline (rolling average)
    await updateBaseline(userId, sessions, baseline);

    return NextResponse.json({
      reportIds,
      sessionsAnalyzed: sessions.length,
      finalElo: currentElo.rating,
    });
  } catch (error) {
    console.error("Analysis error:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request", details: error.issues },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// ── Update rolling baseline ───────────────────────────────────

async function updateBaseline(
  userId: string,
  sessions: { tradeCount: number; avgPositionSize: number; totalPnl: number; winRate: number; avgHoldingTimeMs: number; avgWinHoldingTimeMs: number; avgLossHoldingTimeMs: number }[],
  previous: UserBaseline,
) {
  const n = previous.sessionsCount;
  const newCount = n + sessions.length;

  // Exponential moving average with alpha = 2 / (n + 1), capped at 0.3
  const alpha = Math.min(0.3, 2 / (n + 1));

  const latestSession = sessions[sessions.length - 1];
  if (!latestSession) return;

  await db.userBaseline.upsert({
    where: { userId },
    create: {
      userId,
      avgTradesPerDay: latestSession.tradeCount,
      avgPositionSize: latestSession.avgPositionSize,
      avgDailyPnl: latestSession.totalPnl,
      avgWinRate: latestSession.winRate,
      avgHoldingTimeMs: latestSession.avgHoldingTimeMs,
      avgWinHoldingTimeMs: latestSession.avgWinHoldingTimeMs,
      avgLossHoldingTimeMs: latestSession.avgLossHoldingTimeMs,
      sessionsCount: sessions.length,
    },
    update: {
      avgTradesPerDay:
        previous.avgTradesPerDay * (1 - alpha) +
        latestSession.tradeCount * alpha,
      avgPositionSize:
        previous.avgPositionSize * (1 - alpha) +
        latestSession.avgPositionSize * alpha,
      avgDailyPnl:
        previous.avgDailyPnl * (1 - alpha) +
        latestSession.totalPnl * alpha,
      avgWinRate:
        previous.avgWinRate * (1 - alpha) +
        latestSession.winRate * alpha,
      avgHoldingTimeMs:
        previous.avgHoldingTimeMs * (1 - alpha) +
        latestSession.avgHoldingTimeMs * alpha,
      avgWinHoldingTimeMs:
        previous.avgWinHoldingTimeMs * (1 - alpha) +
        latestSession.avgWinHoldingTimeMs * alpha,
      avgLossHoldingTimeMs:
        previous.avgLossHoldingTimeMs * (1 - alpha) +
        latestSession.avgLossHoldingTimeMs * alpha,
      sessionsCount: newCount,
    },
  });
}
