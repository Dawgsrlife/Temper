"use client";

import { useState, useEffect } from "react";
import { TemperScoreCard } from "@/components/dashboard/temper-score-card";
import { EloChart } from "@/components/dashboard/elo-chart";
import { BiasBreakdown } from "@/components/dashboard/bias-breakdown";
import Link from "next/link";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type ReportData = {
  id: string;
  sessionId: string;
  date: string;
  temperScore: number;
  eloBefore: number;
  eloAfter: number;
  eloDelta: number;
  biasScores: Record<string, number>;
};

type EloState = {
  rating: number;
  peakRating: number;
  sessionsPlayed: number;
};

export default function OverviewPage() {
  const [reports, setReports] = useState<ReportData[]>([]);
  const [eloState, setEloState] = useState<EloState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`${API_URL}/api/history?userId=demo-user`);
        if (res.ok) {
          const data = await res.json();
          setReports(data.reports || []);
          setEloState(data.currentElo);
        }
      } catch (error) {
        console.error("Failed to fetch history:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (reports.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <p className="mb-4 text-sm text-muted-foreground">
          No sessions analyzed yet.
        </p>
        <Link
          href="/upload"
          className="rounded-lg bg-foreground px-6 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
        >
          Upload your first CSV &rarr;
        </Link>
      </div>
    );
  }

  const latestReport = reports[0];
  const temperScore = latestReport.temperScore;
  const latestDate = latestReport.date;

  const eloHistory = reports
    .slice()
    .reverse()
    .map((r) => ({
      date: r.date,
      rating: r.eloAfter,
    }));

  return (
    <div className="max-w-5xl">
      <h1 className="animate-slide-down mb-8 text-xl font-semibold">
        Overview
      </h1>

      {/* Top metrics */}
      <div className="animate-slide-up mb-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <TemperScoreCard score={temperScore} date={latestDate} />

        <div className="rounded-lg border border-border bg-surface-1 p-5">
          <div className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
            Decision ELO
          </div>
          <div className="tabular text-3xl font-semibold">
            {eloState?.rating?.toFixed(0) ?? "1200"}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Peak {eloState?.peakRating?.toFixed(0) ?? "1200"} &middot;{" "}
            {eloState?.sessionsPlayed ?? 0} sessions
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface-1 p-5">
          <div className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
            Last Session
          </div>
          <div
            className={`tabular text-3xl font-semibold ${latestReport.eloDelta >= 0
                ? "text-positive"
                : "text-negative"
              }`}
          >
            {latestReport.eloDelta >= 0 ? "+" : ""}
            {latestReport.eloDelta.toFixed(1)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            ELO delta &middot; {latestDate}
          </div>
        </div>
      </div>

      {/* ELO chart */}
      <section className="animate-slide-up delay-2 mb-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          ELO History
        </h2>
        <EloChart data={eloHistory} />
      </section>

      {/* Bias breakdown */}
      <section className="animate-slide-up delay-3 mb-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Bias Breakdown &mdash; {latestDate}
        </h2>
        <BiasBreakdown scores={latestReport.biasScores} />
      </section>

      {/* Recent sessions */}
      <section className="animate-slide-up delay-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Recent Sessions
        </h2>
        <div className="space-y-1">
          {reports.map((r) => (
            <Link
              key={r.id}
              href={`/sessions/${r.sessionId}`}
              className="flex items-center justify-between rounded-md border border-border bg-surface-1 px-4 py-3 text-sm transition-colors hover:bg-surface-2"
            >
              <span className="font-medium">{r.date}</span>
              <div className="flex items-center gap-5 text-xs">
                <span className="tabular text-muted-foreground">
                  Score {r.temperScore}
                </span>
                <span
                  className={`tabular font-medium ${r.eloDelta >= 0 ? "text-positive" : "text-negative"
                    }`}
                >
                  {r.eloDelta >= 0 ? "+" : ""}
                  {r.eloDelta.toFixed(1)} ELO
                </span>
                <span className="text-muted-foreground">&rarr;</span>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
