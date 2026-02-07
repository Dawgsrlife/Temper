export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// POST /api/analyze
// ─────────────────────────────────────────────────────────────
// Accepts a jobId and transitions the TradeSet through:
//   PENDING → PROCESSING → (pipeline) → COMPLETED | FAILED
//
// Pipeline: parse → sessions → behavior engine → ELO → reports
// Client polls GET /api/jobs/[jobId] for status updates.
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
  jobId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { jobId } = AnalyzeRequestSchema.parse(body);

    // ── Load job ──────────────────────────────────────────────
    const tradeSet = await db.tradeSet.findUnique({
      where: { id: jobId },
    });

    if (!tradeSet) {
      return NextResponse.json(
        { error: "Job not found" },
        { status: 404 },
      );
    }

    if (tradeSet.status !== "PENDING") {
      return NextResponse.json(
        { error: `Job is already ${tradeSet.status}` },
        { status: 409 },
      );
    }

    // ── Transition → PROCESSING ──────────────────────────────
    await db.tradeSet.update({
      where: { id: jobId },
      data: { status: "PROCESSING" },
    });

    try {
      // ── Concurrent: parse CSV + fetch baseline + fetch ELO ─
      const [parseResult, userBaseline, eloRecord] = await Promise.all([
        Promise.resolve(parseCsv(tradeSet.rawCsv)),
        db.userBaseline.findUnique({ where: { userId: tradeSet.userId } }),
        db.decisionElo.findUnique({ where: { userId: tradeSet.userId } }),
      ]);

      if (parseResult.validRows === 0) {
        await db.tradeSet.update({
          where: { id: jobId },
          data: { status: "FAILED", error: "No valid trades in CSV" },
        });
        return NextResponse.json(
          { error: "No valid trades in CSV" },
          { status: 422 },
        );
      }

      // ── Baseline ───────────────────────────────────────────
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

      // ── ELO state ──────────────────────────────────────────
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

      // ── Reconstruct sessions ───────────────────────────────
      const sessions = reconstructSessions(
        tradeSet.userId,
        parseResult.trades,
        baseline,
      );

      const reportIds: string[] = [];
      const sessionIds: string[] = [];

      // ── Analyze each session ───────────────────────────────
      for (const session of sessions) {
        const dbSession = await db.session.create({
          data: {
            id: session.id,
            tradeSetId: jobId,
            userId: tradeSet.userId,
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

        sessionIds.push(dbSession.id);

        const { report, newElo } = analyzeSession({
          session,
          baseline,
          previousElo: currentElo,
        });

        const coachFacts = buildCoachFacts(report);

        await db.temperReport.create({
          data: {
            id: report.id,
            sessionId: dbSession.id,
            userId: tradeSet.userId,
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

        currentElo = newElo;
        reportIds.push(report.id);
      }

      // ── Persist ELO ────────────────────────────────────────
      await db.decisionElo.upsert({
        where: { userId: tradeSet.userId },
        create: {
          userId: tradeSet.userId,
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

      // ── Update rolling baseline ────────────────────────────
      await updateBaseline(tradeSet.userId, sessions, baseline);

      // ── Transition → COMPLETED ─────────────────────────────
      await db.tradeSet.update({
        where: { id: jobId },
        data: { status: "COMPLETED" },
      });

      return NextResponse.json({
        jobId,
        status: "COMPLETED",
        reportIds,
        sessionIds,
        sessionsAnalyzed: sessions.length,
        finalElo: currentElo.rating,
      });
    } catch (pipelineError) {
      // ── Transition → FAILED ────────────────────────────────
      const errorMessage =
        pipelineError instanceof Error
          ? pipelineError.message
          : "Unknown pipeline error";

      await db.tradeSet.update({
        where: { id: jobId },
        data: { status: "FAILED", error: errorMessage },
      });

      throw pipelineError;
    }
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
  sessions: {
    tradeCount: number;
    avgPositionSize: number;
    totalPnl: number;
    winRate: number;
    avgHoldingTimeMs: number;
    avgWinHoldingTimeMs: number;
    avgLossHoldingTimeMs: number;
  }[],
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
        previous.avgWinRate * (1 - alpha) + latestSession.winRate * alpha,
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
