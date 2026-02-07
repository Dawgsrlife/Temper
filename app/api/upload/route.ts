export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// POST /api/upload
// ─────────────────────────────────────────────────────────────
// Accepts a CSV file upload, parses it, and stores the TradeSet.
// Returns parse result with validation errors if any.
// ─────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { parseCsv } from "@/lib/trades/parser";
import { db } from "@/lib/db/prisma";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    // For hackathon MVP: use a fixed user ID (no auth yet)
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

    // Ensure user exists (upsert for MVP)
    await db.user.upsert({
      where: { id: userId },
      create: { id: userId, email: `${userId}@temper.dev` },
      update: {},
    });

    // Store the trade set
    const tradeSet = await db.tradeSet.create({
      data: {
        userId,
        fileName: file.name,
        rawCsv: csvText,
      },
    });

    return NextResponse.json({
      tradeSetId: tradeSet.id,
      fileName: file.name,
      totalRows: parseResult.totalRows,
      validRows: parseResult.validRows,
      errors: parseResult.errors,
      trades: parseResult.trades,
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
