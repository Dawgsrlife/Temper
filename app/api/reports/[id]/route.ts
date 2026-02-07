export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// GET /api/reports/[id]
// ─────────────────────────────────────────────────────────────
// Fetch a single TemperReport by ID, including coach facts.
// ─────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/prisma";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const report = await db.temperReport.findUnique({
      where: { id },
      include: {
        session: true,
      },
    });

    if (!report) {
      return NextResponse.json(
        { error: "Report not found" },
        { status: 404 },
      );
    }

    return NextResponse.json(report);
  } catch (error) {
    console.error("Report fetch error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
