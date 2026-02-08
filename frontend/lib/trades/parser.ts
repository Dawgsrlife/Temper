// ─────────────────────────────────────────────────────────────
// Temper – CSV Trade Parser (Ingestion Layer)
// ─────────────────────────────────────────────────────────────
// Responsible ONLY for:
//   1. Parsing CSV text into RawTrade[]
//   2. Validating each row against the Zod schema
//   3. Sorting by timestamp
// Does NOT compute any metrics or derived fields.
// ─────────────────────────────────────────────────────────────

import Papa from "papaparse";
import { z } from "zod";
import type { RawTrade } from "@/lib/types";
import { TradeSide } from "@/lib/types";

// ── CSV row schema ────────────────────────────────────────────

const CsvRowSchema = z.object({
  timestamp: z.string().refine((s) => !isNaN(Date.parse(s)), {
    message: "Invalid ISO 8601 timestamp",
  }),
  symbol: z.string().min(1, "Symbol is required"),
  side: z
    .string()
    .transform((s) => s.toUpperCase().trim())
    .pipe(z.enum(["LONG", "SHORT", "BUY", "SELL"])),
  qty: z.coerce.number().positive("Quantity must be positive"),
  price: z.coerce.number().positive("Price must be positive"),
  pnl: z.coerce.number(), // can be negative
  tags: z
    .string()
    .optional()
    .transform((s) =>
      s
        ? s
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : [],
    ),
});

export type CsvRow = z.infer<typeof CsvRowSchema>;

export interface ParseResult {
  trades: RawTrade[];
  errors: ParseError[];
  totalRows: number;
  validRows: number;
}

export interface ParseError {
  row: number;
  field?: string;
  message: string;
}

// ── Column name normalization ─────────────────────────────────

const COLUMN_ALIASES: Record<string, string> = {
  // timestamp
  timestamp: "timestamp",
  time: "timestamp",
  date: "timestamp",
  datetime: "timestamp",
  date_time: "timestamp",
  executed_at: "timestamp",
  // symbol
  symbol: "symbol",
  ticker: "symbol",
  sym: "symbol",
  instrument: "symbol",
  asset: "symbol",
  stock: "symbol",
  // side
  side: "side",
  direction: "side",
  type: "side",
  action: "side",
  // quantity
  qty: "qty",
  quantity: "qty",
  size: "qty",
  shares: "qty",
  amount: "qty",
  // price
  price: "price",
  avg_price: "price",
  fill_price: "price",
  execution_price: "price",
  // pnl
  pnl: "pnl",
  "p/l": "pnl",
  "p&l": "pnl",
  profit: "pnl",
  profit_loss: "pnl",
  realized_pnl: "pnl",
  // tags
  tags: "tags",
  labels: "tags",
  notes: "tags",
  tag: "tags",
};

function normalizeHeaders(
  headers: string[],
): { normalized: Record<string, string>; missing: string[] } {
  const normalized: Record<string, string> = {};
  const found = new Set<string>();

  for (const raw of headers) {
    const key = raw.toLowerCase().trim().replace(/[\s\-]+/g, "_");
    const mapped = COLUMN_ALIASES[key];
    if (mapped) {
      normalized[raw] = mapped;
      found.add(mapped);
    }
  }

  const required = ["timestamp", "symbol", "side", "qty", "price", "pnl"];
  const missing = required.filter((r) => !found.has(r));

  return { normalized, missing };
}

// ── Side normalization ────────────────────────────────────────

function normalizeSide(raw: string): TradeSide {
  const upper = raw.toUpperCase().trim();
  if (upper === "BUY" || upper === "LONG") return TradeSide.LONG;
  return TradeSide.SHORT;
}

// ── Main parse function ───────────────────────────────────────

/**
 * Parse a CSV string into validated RawTrade[].
 * Pure function — no side effects, no DB access.
 */
export function parseCsv(csvText: string): ParseResult {
  const errors: ParseError[] = [];
  const trades: RawTrade[] = [];

  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  if (parsed.errors.length > 0) {
    for (const e of parsed.errors) {
      errors.push({
        row: e.row ?? 0,
        message: `CSV parse error: ${e.message}`,
      });
    }
  }

  if (!parsed.meta.fields || parsed.meta.fields.length === 0) {
    errors.push({ row: 0, message: "No headers found in CSV" });
    return { trades: [], errors, totalRows: 0, validRows: 0 };
  }

  const { normalized, missing } = normalizeHeaders(parsed.meta.fields);
  if (missing.length > 0) {
    errors.push({
      row: 0,
      message: `Missing required columns: ${missing.join(", ")}`,
    });
    return { trades: [], errors, totalRows: parsed.data.length, validRows: 0 };
  }

  for (let i = 0; i < parsed.data.length; i++) {
    const rawRow = parsed.data[i];
    // Remap columns
    const mappedRow: Record<string, string> = {};
    for (const [original, mapped] of Object.entries(normalized)) {
      mappedRow[mapped] = rawRow[original] ?? "";
    }

    const result = CsvRowSchema.safeParse(mappedRow);
    if (!result.success) {
      for (const issue of result.error.issues) {
        errors.push({
          row: i + 1,
          field: issue.path.join("."),
          message: issue.message,
        });
      }
      continue;
    }

    trades.push({
      timestamp: new Date(result.data.timestamp).toISOString(),
      symbol: result.data.symbol.toUpperCase(),
      side: normalizeSide(result.data.side),
      quantity: result.data.qty,
      price: result.data.price,
      pnl: result.data.pnl,
      tags: result.data.tags,
    });
  }

  // Sort by timestamp (deterministic)
  trades.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  return {
    trades,
    errors,
    totalRows: parsed.data.length,
    validRows: trades.length,
  };
}
