export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// GET /api/jobs/[id]
// ─────────────────────────────────────────────────────────────
// Poll endpoint for async job status.
// Client polls every 2s until status is COMPLETED or FAILED.
//
// Response:
//   { status, jobId, error?, sessionIds?, reportIds? }
// ─────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/prisma";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const job = await db.tradeSet.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        error: true,
        fileName: true,
        createdAt: true,
        updatedAt: true,
        sessions: {
          select: {
            id: true,
            date: true,
            report: {
              select: { id: true },
            },
          },
        },
      },
    });

    if (!job) {
      return NextResponse.json(
        { error: "Job not found" },
        { status: 404 },
      );
    }

    const response: Record<string, unknown> = {
      jobId: job.id,
      status: job.status,
      fileName: job.fileName,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };

    if (job.status === "FAILED") {
      response.error = job.error;
    }

    if (job.status === "COMPLETED") {
      response.sessionIds = job.sessions.map((s) => s.id);
      response.reportIds = job.sessions
        .map((s) => s.report?.id)
        .filter(Boolean);
      response.sessions = job.sessions.map((s) => ({
        id: s.id,
        date: s.date,
        reportId: s.report?.id ?? null,
      }));
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error("Job status error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
