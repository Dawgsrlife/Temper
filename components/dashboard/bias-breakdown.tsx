"use client";

import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

interface BiasBreakdownProps {
  scores: Record<string, number>;
}

const BIAS_LABELS: Record<string, string> = {
  OVERTRADING: "Overtrading",
  LOSS_AVERSION: "Loss Aversion",
  REVENGE_TRADING: "Revenge Trading",
  FOMO: "FOMO",
  GREED: "Greed",
};

export function BiasBreakdown({ scores }: BiasBreakdownProps) {
  const biasKeys = Object.keys(BIAS_LABELS);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 80);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="space-y-3">
      {biasKeys.map((key, i) => {
        const score = scores[key] ?? 0;
        const label = BIAS_LABELS[key];
        const isHigh = score >= 40;

        return (
          <div key={key}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span
                className={cn(
                  isHigh ? "font-medium text-negative" : "text-muted-foreground",
                )}
              >
                {label}
              </span>
              <span
                className={cn(
                  "tabular font-mono",
                  isHigh ? "text-negative" : "text-muted-foreground",
                )}
              >
                {score}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-700 ease-out",
                  score >= 70
                    ? "bg-negative"
                    : score >= 40
                      ? "bg-mistake"
                      : "bg-muted",
                )}
                style={{
                  width: mounted ? `${Math.min(score, 100)}%` : "0%",
                  transitionDelay: `${i * 60}ms`,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
