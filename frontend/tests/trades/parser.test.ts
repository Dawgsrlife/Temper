// ─────────────────────────────────────────────────────────────
// Tests — CSV Trade Parser
// ─────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { parseCsv } from "@/lib/trades/parser";
import { TradeSide } from "@/lib/types";

const VALID_CSV = `timestamp,symbol,side,qty,price,pnl,tags
2026-02-06T09:31:00Z,AAPL,LONG,100,188.50,150.00,"scalp,morning"
2026-02-06T09:45:00Z,NVDA,SHORT,50,920.00,-75.00,"reversal"
2026-02-06T10:02:00Z,AAPL,BUY,200,189.00,320.00,""
`;

const BAD_CSV = `timestamp,symbol,side,qty,price,pnl
not-a-date,AAPL,LONG,100,188.50,150.00
2026-02-06T09:45:00Z,,SHORT,50,920.00,-75.00
2026-02-06T10:00:00Z,TSLA,LONG,-10,245.00,50.00
`;

describe("parseCsv", () => {
  it("parses valid CSV into RawTrade[]", () => {
    const result = parseCsv(VALID_CSV);
    expect(result.validRows).toBe(3);
    expect(result.errors).toHaveLength(0);
    expect(result.trades).toHaveLength(3);

    // Check first trade
    expect(result.trades[0].symbol).toBe("AAPL");
    expect(result.trades[0].side).toBe(TradeSide.LONG);
    expect(result.trades[0].quantity).toBe(100);
    expect(result.trades[0].pnl).toBe(150);

    // Check BUY → LONG normalization
    expect(result.trades[2].side).toBe(TradeSide.LONG);
  });

  it("sorts trades by timestamp ascending", () => {
    const result = parseCsv(VALID_CSV);
    for (let i = 1; i < result.trades.length; i++) {
      expect(
        new Date(result.trades[i].timestamp).getTime(),
      ).toBeGreaterThanOrEqual(
        new Date(result.trades[i - 1].timestamp).getTime(),
      );
    }
  });

  it("parses tags correctly", () => {
    const result = parseCsv(VALID_CSV);
    expect(result.trades[0].tags).toEqual(["scalp", "morning"]);
    expect(result.trades[1].tags).toEqual(["reversal"]);
  });

  it("reports errors for invalid rows", () => {
    const result = parseCsv(BAD_CSV);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.validRows).toBeLessThan(result.totalRows);
  });

  it("rejects CSV with missing columns", () => {
    const result = parseCsv("foo,bar\n1,2");
    expect(result.validRows).toBe(0);
    expect(result.errors[0].message).toContain("Missing required columns");
  });

  it("handles empty CSV gracefully", () => {
    const result = parseCsv("");
    expect(result.trades).toHaveLength(0);
  });

  it("normalizes column aliases (ticker → symbol)", () => {
    const csv = `timestamp,ticker,direction,shares,price,profit
2026-02-06T09:31:00Z,AAPL,BUY,100,188.50,150.00`;
    const result = parseCsv(csv);
    expect(result.validRows).toBe(1);
    expect(result.trades[0].symbol).toBe("AAPL");
  });
});
