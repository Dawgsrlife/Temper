import {
  DecisionLabel,
  DECISION_SYMBOLS,
  DECISION_COLORS,
  DECISION_BG_COLORS,
} from "@/lib/types";
import { cn } from "@/lib/utils";

interface DecisionBadgeProps {
  label: DecisionLabel;
  size?: "sm" | "md";
  showLabel?: boolean;
}

export function DecisionBadge({
  label,
  size = "md",
  showLabel = false,
}: DecisionBadgeProps) {
  const symbol = DECISION_SYMBOLS[label];
  const colorClass = DECISION_COLORS[label];
  const bgClass = DECISION_BG_COLORS[label];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded font-mono font-semibold",
        colorClass,
        bgClass,
        size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs",
      )}
      title={label}
    >
      {symbol}
      {showLabel && (
        <span className="font-sans text-[0.85em] capitalize">
          {label.toLowerCase().replace("_", " ")}
        </span>
      )}
    </span>
  );
}

export function DecisionLegend() {
  return (
    <div className="flex flex-wrap gap-1.5">
      {Object.values(DecisionLabel).map((label) => (
        <DecisionBadge key={label} label={label} size="sm" showLabel />
      ))}
    </div>
  );
}
