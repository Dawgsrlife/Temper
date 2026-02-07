export const dynamic = "force-dynamic";

import { db } from "@/lib/db/prisma";
import { notFound } from "next/navigation";
import { TradeTimeline } from "@/components/review/trade-timeline";
import { BiasBreakdown } from "@/components/dashboard/bias-breakdown";
import type {
  DecisionEvent,
  Trade,
  CoachFactsPayload,
  DisciplinedSessionResult,
} from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

export default async function SessionReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await db.session.findUnique({
    where: { id },
    include: { report: true },
  });

  if (!session || !session.report) {
    notFound();
  }

  const report = session.report;
  const trades = session.tradesJson as unknown as Trade[];
  const decisions = report.decisions as unknown as DecisionEvent[];
  const temperScore = report.temperScore as unknown as {
    value: number;
    rawScore: number;
    biasPenalty: number;
    labelDistribution: Record<string, number>;
  };
  const biasScores = report.biasScores as Record<string, number>;
  const coachFacts = report.coachFacts as unknown as CoachFactsPayload;
  const replay = report.replayResult as unknown as DisciplinedSessionResult;

  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);

  return (
    <div className="mx-auto max-w-5xl space-y-10 py-6">
      {/* ── Header ─────────────────────── */}
      <header className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Session Review
          </p>
          <h1 className="mt-1 text-xl font-semibold">{session.date}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {trades.length} trades &middot;{" "}
            <span className={totalPnl >= 0 ? "text-positive" : "text-negative"}>
              {formatCurrency(totalPnl)}
            </span>
          </p>
        </div>
        <div className="text-right">
          <div className="tabular text-4xl font-bold">{temperScore.value}</div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Temper Score
          </p>
          <p
            className={`tabular mt-1 text-sm font-medium ${
              report.eloDelta >= 0 ? "text-positive" : "text-negative"
            }`}
          >
            {report.eloDelta >= 0 ? "+" : ""}
            {report.eloDelta.toFixed(1)} ELO
          </p>
        </div>
      </header>

      {/* ── Label distribution ─────────── */}
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(temperScore.labelDistribution)
          .filter(([, count]) => (count as number) > 0)
          .map(([label, count]) => (
            <span
              key={label}
              className="rounded-full border border-border bg-surface-1 px-2.5 py-0.5 text-xs font-mono text-muted-foreground"
            >
              {label}: {count as number}
            </span>
          ))}
      </div>

      {/* ── Trade timeline ─────────────── */}
      <section>
        <SectionHeader>Trade Timeline</SectionHeader>
        <TradeTimeline trades={trades} decisions={decisions} replay={replay} />
      </section>

      {/* ── Bias breakdown ─────────────── */}
      <section>
        <SectionHeader>Bias Breakdown</SectionHeader>
        <div className="rounded-xl border border-border bg-surface-1 p-5">
          <BiasBreakdown scores={biasScores} />
        </div>
      </section>

      {/* ── Disciplined Replay ─────────── */}
      <section>
        <SectionHeader>Disciplined Replay</SectionHeader>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Original P/L" value={formatCurrency(replay.originalPnl)} />
          <Stat
            label="Disciplined P/L"
            value={formatCurrency(replay.disciplinedPnl)}
            positive
          />
          <Stat label="Trades Removed" value={String(replay.tradesRemoved)} />
          <Stat
            label="Savings"
            value={formatCurrency(replay.savings)}
            positive={replay.savings > 0}
          />
        </div>
      </section>

      {/* ── Tilt sequences ─────────────── */}
      {coachFacts.tiltSequences.length > 0 && (
        <section>
          <SectionHeader>Tilt Sequences</SectionHeader>
          <div className="space-y-2">
            {coachFacts.tiltSequences.map((seq, i) => (
              <div
                key={i}
                className="rounded-lg border border-negative/20 bg-negative/5 px-4 py-2.5 text-sm"
              >
                Trades #{seq.startIndex + 1}–#{seq.endIndex + 1} &middot;{" "}
                {seq.durationDescription} &middot;{" "}
                <span className="text-negative">{formatCurrency(seq.aggregatePnl)}</span>{" "}
                &middot; {seq.dominantBias}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 text-xs uppercase tracking-widest text-muted-foreground">
      {children}
    </h2>
  );
}

function Stat({
  label,
  value,
  positive = false,
}: {
  label: string;
  value: string;
  positive?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-1 p-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={`tabular mt-1 text-lg font-semibold ${positive ? "text-positive" : ""}`}>
        {value}
      </p>
    </div>
  );
}
