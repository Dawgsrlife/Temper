export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// POST /api/upload
// ─────────────────────────────────────────────────────────────
// Accepts a CSV file, validates it has parseable trades, stores
// the raw CSV as a TradeSet with status=PENDING, and returns a
// jobId. Client then polls GET /api/jobs/[jobId] until COMPLETED.
// ─────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { parseCsv } from "@/lib/trades/parser";
import { db } from "@/lib/db/prisma";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const userId = (formData.get("userId") as string) ?? "demo-user";

    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 },
      );
    }

    if (!file.name.endsWith(".csv")) {
      return NextResponse.json(
        { error: "File must be a CSV" },
        { status: 400 },
      );
    }

    const csvText = await file.text();

    // Quick validation — fail fast if CSV is completely unparseable
    const parseResult = parseCsv(csvText);
    if (parseResult.validRows === 0) {
      return NextResponse.json(
        {
          error: "No valid trades found in CSV",
          parseErrors: parseResult.errors,
        },
        { status: 422 },
      );
    }

    // Ensure user exists (upsert for MVP — no auth)
    await db.user.upsert({
      where: { id: userId },
      create: { id: userId, email: `${userId}@temper.dev` },
      update: {},
    });

    // Store raw CSV as a PENDING job
    const tradeSet = await db.tradeSet.create({
      data: {
        userId,
        fileName: file.name,
        rawCsv: csvText,
        status: "PENDING",
      },
    });

    return NextResponse.json({
      jobId: tradeSet.id,
      status: "PENDING",
      fileName: file.name,
      totalRows: parseResult.totalRows,
      validRows: parseResult.validRows,
      parseErrors: parseResult.errors,
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
