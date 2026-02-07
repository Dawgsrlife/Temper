import type { Trade, DecisionEvent } from "@/lib/types";
import { DecisionBadge } from "./decision-badge";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils";

interface TradeCardProps {
  trade: Trade;
  decision: DecisionEvent;
  isActive: boolean;
  onClick: () => void;
}

export function TradeCard({
  trade,
  decision,
  isActive,
  onClick,
}: TradeCardProps) {
  const time = new Date(trade.timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full rounded-md border px-3 py-2.5 text-left text-sm transition-colors",
        isActive
          ? "border-accent/40 bg-accent/5"
          : "border-border bg-surface-1 hover:bg-surface-2",
      )}
    >
      {/* Top row */}
      <div className="mb-1.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="tabular text-[11px] text-muted-foreground">
            {time}
          </span>
          <span className="font-medium">{trade.symbol}</span>
          <span
            className={cn(
              "rounded px-1 py-0.5 text-[10px] font-medium",
              trade.side === "LONG"
                ? "bg-positive/10 text-positive"
                : "bg-negative/10 text-negative",
            )}
          >
            {trade.side}
          </span>
        </div>
        <DecisionBadge label={decision.label} />
      </div>

      {/* Stats */}
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span>Qty {trade.quantity}</span>
        <span>@ ${trade.price.toFixed(2)}</span>
        <span
          className={cn(
            "tabular font-medium",
            trade.pnl >= 0 ? "text-positive" : "text-negative",
          )}
        >
          {formatCurrency(trade.pnl)}
        </span>
        <span className="tabular">Running: {formatCurrency(trade.runningPnl)}</span>
      </div>

      {/* Explanation (active only) */}
      {isActive && (
        <div className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
          {decision.explanation}
          {decision.reasons.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {decision.reasons.map((reason) => (
                <span
                  key={reason}
                  className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px]"
                >
                  {reason}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </button>
  );
}
