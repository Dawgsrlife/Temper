"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatCurrency } from "@/lib/utils";

const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(
  /\/$/,
  "",
);
const POLL_INTERVAL_MS = 1500;

type ApiError = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

type Envelope<TData = unknown> = {
  ok: boolean;
  job?: {
    job_id?: string | null;
    execution_status?: string | null;
    input_sha256?: string | null;
  } | null;
  data: TData;
  error?: ApiError | null;
};

type SummaryPayload = {
  headline: string | null;
  delta_pnl: number | null;
  cost_of_bias: number | null;
  bias_rates: Record<string, number | null>;
  badge_counts: Record<string, number>;
  top_moments: Array<{
    label?: string;
    timestamp?: string;
    asset?: string;
    pnl?: number | null;
    simulated_pnl?: number | null;
    impact?: number | null;
    blocked_reason?: string;
  }>;
  execution_status: string | null;
  error_type?: string | null;
  error_message?: string | null;
};

type ReviewMoment = {
  label?: string;
  trade_grade?: string;
  timestamp?: string;
  asset?: string;
  actual_pnl?: number | null;
  simulated_pnl?: number | null;
  impact?: number | null;
  blocked_reason?: string;
};

type ReviewPayload = {
  review: {
    headline?: string | null;
    top_moments?: ReviewMoment[];
  };
};

type CoachMoveReview = {
  label: string;
  timestamp: string;
  asset: string;
  explanation: string;
  metric_refs: Array<{
    name: string;
    value: number | string | boolean;
    unit: string;
  }>;
};

type CoachPayload = {
  coach: {
    headline?: string;
    plan?: Array<{ title?: string }>;
    move_review?: CoachMoveReview[];
  };
};

type HistoryPayload = {
  jobs: Array<{
    job_id: string;
    created_at: string;
    execution_status: string | null;
    outcome?: string | null;
    delta_pnl?: number | null;
    cost_of_bias?: number | null;
  }>;
};

function isTerminal(status: string | null | undefined): boolean {
  return status === "COMPLETED" || status === "FAILED" || status === "TIMEOUT";
}

function numberOrNull(value: unknown): number | null {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function formatPercent(value: number | null | undefined): string {
  if (value == null) return "n/a";
  return `${(value * 100).toFixed(2)}%`;
}

function formatMetricValue(value: number | string | boolean): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "n/a";
    return Math.abs(value) >= 1000 ? value.toFixed(0) : value.toFixed(2);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  return value;
}

async function requestEnvelope<TData>(path: string, init?: RequestInit): Promise<Envelope<TData>> {
  const response = await fetch(`${API_URL}${path}`, init);
  let payload: Envelope<TData>;
  try {
    payload = (await response.json()) as Envelope<TData>;
  } catch {
    throw new Error(`Invalid JSON from ${path}`);
  }
  if (!response.ok || !payload.ok) {
    const message = payload.error?.message || `Request failed (${response.status})`;
    throw new Error(message);
  }
  return payload;
}

export function DemoConsole() {
  const [userId, setUserId] = useState("demo-user");
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [inputSha, setInputSha] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummaryPayload | null>(null);
  const [review, setReview] = useState<ReviewPayload["review"] | null>(null);
  const [coach, setCoach] = useState<CoachPayload["coach"] | null>(null);
  const [history, setHistory] = useState<HistoryPayload["jobs"]>([]);

  const loadHistory = useCallback(async () => {
    if (!userId.trim()) return;
    try {
      const payload = await requestEnvelope<HistoryPayload>(`/users/${encodeURIComponent(userId)}/jobs?limit=10`);
      setHistory(payload.data.jobs || []);
    } catch {
      setHistory([]);
    }
  }, [userId]);

  const loadSummaryAndReview = useCallback(async (id: string) => {
    const [summaryEnvelope, reviewEnvelope] = await Promise.all([
      requestEnvelope<SummaryPayload>(`/jobs/${id}/summary`),
      requestEnvelope<ReviewPayload>(`/jobs/${id}/review`),
    ]);
    setSummary(summaryEnvelope.data);
    setReview(reviewEnvelope.data.review || null);
  }, []);

  const generateAndFetchCoach = useCallback(async (id: string) => {
    await requestEnvelope<CoachPayload>(`/jobs/${id}/coach`, { method: "POST" });
    const coachEnvelope = await requestEnvelope<CoachPayload>(`/jobs/${id}/coach`);
    setCoach(coachEnvelope.data.coach || null);
  }, []);

  const pollJob = useCallback(
    async (id: string) => {
      const payload = await requestEnvelope<{ status?: string }>(`/jobs/${id}`);
      const currentStatus = payload.job?.execution_status || payload.data.status || null;
      setStatus(currentStatus);
      if (isTerminal(currentStatus)) {
        await loadSummaryAndReview(id);
        if (currentStatus === "COMPLETED") {
          await generateAndFetchCoach(id);
        }
        await loadHistory();
      }
      return currentStatus;
    },
    [generateAndFetchCoach, loadHistory, loadSummaryAndReview],
  );

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (!jobId || !status || isTerminal(status)) return;

    let active = true;
    const timer = setInterval(() => {
      if (!active) return;
      void pollJob(jobId).catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Polling failed.");
        setStatus("FAILED");
      });
    }, POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [jobId, pollJob, status]);

  const onUpload = useCallback(async () => {
    if (!file) {
      setError("Select a CSV file first.");
      return;
    }
    if (!userId.trim()) {
      setError("Enter a user_id.");
      return;
    }

    setLoading(true);
    setError(null);
    setSummary(null);
    setReview(null);
    setCoach(null);
    setStatus("PENDING");

    try {
      const form = new FormData();
      form.append("file", file);
      form.append("user_id", userId.trim());
      form.append("run_async", "true");

      const created = await requestEnvelope<{ status_url: string }>("/jobs", {
        method: "POST",
        body: form,
      });
      const id = created.job?.job_id;
      if (!id) throw new Error("Job ID missing from response.");
      setJobId(id);
      setInputSha(created.job?.input_sha256 || null);
      setStatus(created.job?.execution_status || "PENDING");
      await loadHistory();
      await pollJob(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
      setStatus("FAILED");
    } finally {
      setLoading(false);
    }
  }, [file, loadHistory, pollJob, userId]);

  const badgeEntries = useMemo(
    () =>
      Object.entries(summary?.badge_counts || {})
        .filter(([, value]) => value > 0)
        .sort((a, b) => b[1] - a[1]),
    [summary?.badge_counts],
  );

  const topMoments = useMemo(() => (review?.top_moments || []).slice(0, 3), [review?.top_moments]);
  const moveReview = useMemo(() => (coach?.move_review || []).slice(0, 3), [coach?.move_review]);
  const planTitles = useMemo(
    () => (coach?.plan || []).map((item) => item.title).filter((title): title is string => Boolean(title)),
    [coach?.plan],
  );

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <section className="rounded-xl border border-border bg-surface-1 p-5">
        <h1 className="text-xl font-semibold text-foreground">Demo Console</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload &rarr; poll &rarr; summary &rarr; review &rarr; coach &rarr; history
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-[220px_1fr_auto]">
          <input
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            placeholder="user_id"
            className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm outline-none ring-accent/30 focus:ring-2"
          />
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
            className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => void onUpload()}
            disabled={loading}
            className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
          >
            {loading ? "Uploading..." : "Run Analysis"}
          </button>
        </div>
        <div className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
          <div>Job ID: <span className="tabular text-foreground">{jobId || "—"}</span></div>
          <div>Status: <span className="tabular text-foreground">{status || "—"}</span></div>
          <div>Input SHA: <span className="tabular text-foreground">{inputSha ? `${inputSha.slice(0, 12)}...` : "—"}</span></div>
        </div>
        {error && (
          <div className="mt-4 rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">
            {error}
          </div>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Card title="Headline" value={summary?.headline || "—"} />
        <Card title="Delta PnL" value={summary?.delta_pnl != null ? formatCurrency(summary.delta_pnl) : "—"} />
        <Card
          title="Cost of Bias"
          value={summary?.cost_of_bias != null ? formatCurrency(summary.cost_of_bias) : "—"}
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface-1 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Bias Rates</h2>
          <div className="mt-4 space-y-3">
            {Object.entries(summary?.bias_rates || {}).map(([key, value]) => (
              <div key={key}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="uppercase tracking-wide text-muted-foreground">{key}</span>
                  <span className="tabular text-foreground">{formatPercent(numberOrNull(value))}</span>
                </div>
                <div className="h-2 rounded-full bg-surface-2">
                  <div
                    className="h-2 rounded-full bg-accent"
                    style={{ width: `${Math.max(0, Math.min(100, (numberOrNull(value) || 0) * 100))}%` }}
                  />
                </div>
              </div>
            ))}
            {!summary && <p className="text-sm text-muted-foreground">No summary loaded yet.</p>}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface-1 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Badge Counts</h2>
          <div className="mt-4 space-y-2">
            {badgeEntries.map(([label, value]) => (
              <div key={label} className="flex items-center justify-between rounded-md bg-surface-2 px-3 py-2 text-sm">
                <span>{label}</span>
                <span className="tabular">{value}</span>
              </div>
            ))}
            {badgeEntries.length === 0 && (
              <p className="text-sm text-muted-foreground">No non-zero badge counts available.</p>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface-1 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Top 3 Moments (Review)</h2>
          <div className="mt-4 space-y-3">
            {topMoments.map((moment, index) => (
              <div key={`${moment.timestamp || "ts"}-${index}`} className="rounded-md border border-border-subtle bg-surface-2 p-3">
                <div className="text-sm font-medium">
                  {(moment.label || moment.trade_grade || "UNKNOWN")} &middot; {moment.asset || "N/A"}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{moment.timestamp || "N/A"}</div>
                <div className="mt-2 text-xs tabular text-foreground">
                  actual {moment.actual_pnl != null ? formatCurrency(moment.actual_pnl) : "n/a"} | simulated{" "}
                  {moment.simulated_pnl != null ? formatCurrency(moment.simulated_pnl) : "n/a"}
                </div>
              </div>
            ))}
            {topMoments.length === 0 && <p className="text-sm text-muted-foreground">No review moments yet.</p>}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface-1 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Coach Plan + Move Review</h2>
          <div className="mt-4 space-y-3">
            {planTitles.map((title, index) => (
              <div key={`${title}-${index}`} className="rounded-md bg-surface-2 px-3 py-2 text-sm">
                {title}
              </div>
            ))}
            {moveReview.map((move, index) => (
              <div key={`${move.timestamp}-${move.asset}-${index}`} className="rounded-md border border-border-subtle bg-surface-2 p-3">
                <div className="text-sm font-medium">
                  {move.label} &middot; {move.asset}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{move.timestamp}</div>
                <p className="mt-2 text-xs text-foreground">{move.explanation}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {move.metric_refs.map((metric, metricIndex) => (
                    <span
                      key={`${metric.name}-${metricIndex}`}
                      className="rounded border border-border px-2 py-1 text-[11px] tabular text-muted-foreground"
                    >
                      {metric.name}: {formatMetricValue(metric.value)} {metric.unit}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {planTitles.length === 0 && moveReview.length === 0 && (
              <p className="text-sm text-muted-foreground">Coach output will appear after job completion.</p>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-surface-1 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">History</h2>
        <div className="mt-4 space-y-2">
          {history.map((row) => (
            <div
              key={row.job_id}
              className="grid grid-cols-1 gap-2 rounded-md border border-border-subtle bg-surface-2 px-3 py-2 text-xs sm:grid-cols-5"
            >
              <span className="tabular text-foreground">{row.job_id}</span>
              <span>{row.execution_status || "—"}</span>
              <span>{row.outcome || "—"}</span>
              <span className="tabular">{row.delta_pnl != null ? formatCurrency(row.delta_pnl) : "—"}</span>
              <span className="tabular">{row.cost_of_bias != null ? formatCurrency(row.cost_of_bias) : "—"}</span>
            </div>
          ))}
          {history.length === 0 && (
            <p className="text-sm text-muted-foreground">No history rows yet for this user.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function Card({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface-1 p-5">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="mt-2 text-2xl font-semibold tabular text-foreground">{value}</div>
    </div>
  );
}

