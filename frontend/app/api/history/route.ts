export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// GET /api/history?userId=...
// ─────────────────────────────────────────────────────────────
// Fetch Temper Score + ELO history for a user.
// Returns time-series data for the overview dashboard.
// ─────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/prisma";

export async function GET(request: NextRequest) {
  try {
    const userId =
      request.nextUrl.searchParams.get("userId") ?? "demo-user";

    // Fetch all reports ordered by date
    const reports = await db.temperReport.findMany({
      where: { userId },
      orderBy: { date: "asc" },
      select: {
        id: true,
        date: true,
        temperScore: true,
        eloBefore: true,
        eloAfter: true,
        eloDelta: true,
        biasScores: true,
        createdAt: true,
      },
    });

    // Fetch ELO state
    const eloState = await db.decisionElo.findUnique({
      where: { userId },
    });

    // Fetch baseline
    const baseline = await db.userBaseline.findUnique({
      where: { userId },
    });

    return NextResponse.json({
      reports: reports.map((r) => ({
        id: r.id,
        date: r.date,
        temperScore: (r.temperScore as { value: number }).value,
        eloBefore: r.eloBefore,
        eloAfter: r.eloAfter,
        eloDelta: r.eloDelta,
        biasScores: r.biasScores,
      })),
      currentElo: eloState
        ? {
            rating: eloState.rating,
            peakRating: eloState.peakRating,
            sessionsPlayed: eloState.sessionsPlayed,
          }
        : null,
      baseline: baseline
        ? {
            avgTradesPerDay: baseline.avgTradesPerDay,
            avgPositionSize: baseline.avgPositionSize,
            sessionsCount: baseline.sessionsCount,
          }
        : null,
    });
  } catch (error) {
    console.error("History fetch error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
