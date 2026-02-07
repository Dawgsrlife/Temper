"use client";

import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

interface TemperScoreCardProps {
  score: number;
  date: string;
}

export function TemperScoreCard({ score, date }: TemperScoreCardProps) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const duration = 600;
    const steps = 20;
    const stepTime = duration / steps;
    let current = 0;
    const interval = setInterval(() => {
      current += score / steps;
      if (current >= score) {
        setDisplay(score);
        clearInterval(interval);
      } else {
        setDisplay(Math.round(current));
      }
    }, stepTime);
    return () => clearInterval(interval);
  }, [score]);

  const colorClass =
    score >= 80
      ? "text-positive"
      : score >= 50
        ? "text-inaccuracy"
        : "text-negative";

  return (
    <div className="rounded-lg border border-border bg-surface-1 p-5">
      <div className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
        Temper Score
      </div>
      <div className={cn("tabular text-4xl font-semibold", colorClass)}>
        {display}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{date}</div>
    </div>
  );
}
