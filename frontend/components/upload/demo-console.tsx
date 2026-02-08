"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { formatCurrency } from "@/lib/utils";

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");
const POLL_INTERVAL_MS = 1500;
const USER_ID_KEY = "temper.evidence.user_id";
const LAST_JOB_ID_KEY = "temper.evidence.last_job_id";

type ApiError = {
  code?: string;
  message?: string;
  details?: Record<string, unknown>;
};

type Envelope<T> = {
  ok: boolean;
  job?: {
    job_id?: string | null;
    execution_status?: string | null;
    input_sha256?: string | null;
  } | null;
  data: T;
  error?: ApiError | null;
};

type JobStatusData = {
  status?: string;
  outcome?: string | null;
};

type SummaryData = {
  headline?: string | null;
  delta_pnl?: number | null;
  cost_of_bias?: number | null;
  bias_rates?: {
    revenge_rate?: number | null;
    overtrading_rate?: number | null;
    loss_aversion_rate?: number | null;
    any_bias_rate?: number | null;
  } | null;
  data_quality_flags?: Array<{
    code?: string;
    count?: number;
    message?: string;
    details?: Record<string, unknown>;
  }> | null;
};

type SeriesPoint = {
  timestamp: string;
  actual_equity: number;
  simulated_equity: number;
  policy_replay_equity?: number;
};

type SeriesMarker = {
  timestamp: string;
  asset: string;
  trade_grade: string;
  blocked_reason: string;
  reason_label?: string;
  impact_abs?: number | null;
  intervention_type?: string;
};

type SeriesData = {
  points: SeriesPoint[];
  markers: SeriesMarker[];
  total_points: number;
  returned_points: number;
  max_points: number;
  metrics?: {
    return_actual: number;
    return_policy_replay: number;
    max_drawdown_actual: number;
    max_drawdown_policy_replay: number;
    worst_day_actual: number;
    worst_day_policy_replay: number;
    trade_volatility_actual: number;
    trade_volatility_policy_replay: number;
    pct_trades_modified: number;
    top_bias_by_impact: {
      bias: string;
      impact_abs_total: number;
      by_bias: Record<string, number>;
    };
  };
};

type MomentMetricRef = {
  name: string;
  value: string | number | boolean;
  unit: string;
};

type MomentData = {
  timestamp: string;
  asset: string;
  trade_grade: string;
  bias_category?: string | null;
  pnl: number | null;
  simulated_pnl: number | null;
  policy_replay_pnl?: number | null;
  impact_abs: number | null;
  impact_pct_balance?: number | null;
  blocked_reason: string | null;
  reason_label?: string | null;
  is_revenge: boolean | null;
  is_overtrading: boolean | null;
  is_loss_aversion: boolean | null;
  thresholds_referenced: Record<string, number | null>;
  explanation_human: string;
  thesis?: {
    trigger: string;
    behavior: string;
    intervention: string;
    outcome: string;
  };
  lesson?: string;
  counterfactual_mechanics?: {
    mechanism?: string;
    scale_factor?: number | null;
    size_usd_before?: number | null;
    size_usd_after?: number | null;
    quantity_before?: number | null;
    quantity_after?: number | null;
    cap_used?: number | null;
  };
  trace_trade_id?: number | null;
  decision?: string | null;
  reason?: string | null;
  intervention_type?: string | null;
  triggering_prior_trade?: Record<string, unknown> | null;
  rule_hits?: Array<Record<string, unknown>> | null;
  evidence: {
    rule_signature: string | null;
    metric_refs: MomentMetricRef[];
    rule_hits?: Array<Record<string, unknown>> | null;
  };
  error_notes: string[];
};

type MomentsEnvelopeData = {
  moments: MomentData[];
  source?: string;
};

type TradeInspectorData = {
  trade: {
    trade_id: number;
    raw_input_row: Record<string, unknown> | null;
    derived_flags: {
      is_revenge: boolean | null;
      is_overtrading: boolean | null;
      is_loss_aversion: boolean | null;
    };
    decision: {
      decision: string | null;
      reason: string | null;
      reason_label?: string | null;
      intervention_type?: string | null;
      triggering_rule_id: string | null;
      triggering_prior_trade: Record<string, unknown> | null;
      blocked_reason: string | null;
    };
    counterfactual: {
      actual_pnl: number | null;
      simulated_pnl: number | null;
      policy_replay_pnl?: number | null;
      delta_pnl: number | null;
      impact_pct_balance?: number | null;
    };
    counterfactual_mechanics?: {
      mechanism?: string;
      scale_factor?: number | null;
      size_usd_before?: number | null;
      size_usd_after?: number | null;
      quantity_before?: number | null;
      quantity_after?: number | null;
      cap_used?: number | null;
    };
    explanation_plain_english: string | null;
    thesis?: {
      trigger: string;
      behavior: string;
      intervention: string;
      outcome: string;
    };
    lesson?: string;
    evidence: {
      timestamp: string | null;
      asset: string | null;
      side: string | null;
      size_usd: number | null;
      rule_hits: Array<Record<string, unknown>>;
      trace: Record<string, unknown>;
    };
  };
};

type ApiFailure = {
  status: number;
  code: string;
  message: string;
  details: unknown;
};

class RequestError extends Error {
  status: number;
  code: string;
  details: unknown;

  constructor(status: number, code: string, message: string, details: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function terminal(status: string | null | undefined): boolean {
  return status === "COMPLETED" || status === "FAILED" || status === "TIMEOUT";
}

async function request<T>(path: string, init?: RequestInit): Promise<Envelope<T>> {
  const response = await fetch(`${API_BASE}${path}`, init);
  let payload: Envelope<T>;
  try {
    payload = (await response.json()) as Envelope<T>;
  } catch {
    throw new RequestError(response.status, "INVALID_JSON", `Invalid JSON from ${path}`, null);
  }
  if (!payload.ok || !response.ok) {
    throw new RequestError(
      response.status,
      payload.error?.code || "API_ERROR",
      payload.error?.message || `Request failed (${response.status})`,
      payload.error?.details || payload.data || null,
    );
  }
  return payload;
}

function toFailure(error: unknown): ApiFailure {
  if (error instanceof RequestError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }
  if (error instanceof Error) {
    return { status: 0, code: "UNEXPECTED_ERROR", message: error.message, details: null };
  }
  return { status: 0, code: "UNEXPECTED_ERROR", message: "Unknown error", details: null };
}

function fmtMaybeCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value) || !Number.isFinite(value)) return "n/a";
  return formatCurrency(value);
}

function fmtMaybeMagnitudeCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value) || !Number.isFinite(value)) return "n/a";
  return `$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtMaybePercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value) || !Number.isFinite(value)) return "n/a";
  return `${value.toFixed(2)}%`;
}

function fmtMaybeScale(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value) || !Number.isFinite(value)) return "n/a";
  return `${value.toFixed(8)}x`;
}

function fmtMaybeNumber(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value) || !Number.isFinite(value)) return "n/a";
  return value.toFixed(digits);
}

function fmtMaybeBool(value: boolean | null | undefined): string {
  if (value === true) return "true";
  if (value === false) return "false";
  return "null";
}

function prettyOutcome(value: string | null): string {
  if (!value) return "—";
  if (value === "WINNER" || value === "DRAW" || value === "RESIGN" || value === "CHECKMATED" || value === "ABANDON" || value === "TIMEOUT") {
    return "Run completed";
  }
  return value;
}

function interventionPillTone(value: string | null | undefined): string {
  const text = (value || "").toLowerCase();
  if (text.includes("blocked")) return "bg-negative/15 text-negative border-negative/30";
  if (text.includes("deferred")) return "bg-warning/15 text-warning border-warning/30";
  if (text.includes("rescaled") || text.includes("loss-capped")) return "bg-accent/15 text-accent border-accent/30";
  return "bg-surface-2 text-muted-foreground border-border";
}

function markerColor(grade: string): string {
  if (grade.includes("BLUNDER") || grade === "MISTAKE") return "#ef4444";
  if (grade === "MISS" || grade === "INACCURACY") return "#f59e0b";
  if (grade === "BRILLIANT" || grade === "GREAT" || grade === "BEST" || grade === "EXCELLENT") return "#22c55e";
  return "#94a3b8";
}

function isMeaningfullyModified(interventionType: string | null | undefined, deltaPnl: number | null | undefined): boolean {
  if ((interventionType || "").toLowerCase().includes("keep (no change)")) {
    return false;
  }
  if (deltaPnl == null || !Number.isFinite(deltaPnl)) return false;
  return Math.abs(deltaPnl) > 1e-9;
}

function formatPercentFromRatio(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return `${(value * 100).toFixed(1)}%`;
}

function firedRules(
  ruleHits: Array<Record<string, unknown>> | null | undefined,
): Array<Record<string, unknown>> {
  if (!Array.isArray(ruleHits)) return [];
  return ruleHits.filter((hit) => hit && typeof hit === "object" && Boolean(hit.fired));
}

function preferredRuleIdsForReason(reason: string | null | undefined): string[] {
  const r = (reason || "").toUpperCase();
  if (r.includes("OVERTRADING")) {
    return ["OVERTRADING_COOLDOWN_SKIP_REPLAY", "OVERTRADING_DEFERRED_REPLAY", "OVERTRADING_HOURLY_CAP"];
  }
  if (r.includes("REVENGE")) {
    return ["REVENGE_SIZE_RESCALE_REPLAY", "REVENGE_AFTER_LOSS"];
  }
  if (r.includes("LOSS_AVERSION")) {
    return ["LOSS_AVERSION_CAP_REPLAY", "LOSS_AVERSION_PAYOFF_PROXY"];
  }
  if (r.includes("DAILY_MAX_LOSS")) {
    return ["DAILY_MAX_LOSS_STOP"];
  }
  return [];
}

function resolvePrimaryRule(
  ruleHits: Array<Record<string, unknown>> | null | undefined,
  reason: string | null | undefined,
): Record<string, unknown> | null {
  const fired = firedRules(ruleHits);
  if (!fired.length) return null;
  const preferred = preferredRuleIdsForReason(reason);
  for (const ruleId of preferred) {
    const matched = fired.find((hit) => String(hit.rule_id || "").toUpperCase() === ruleId);
    if (matched) return matched;
  }
  return fired[0] || null;
}

function resolveSecondaryRules(
  ruleHits: Array<Record<string, unknown>> | null | undefined,
  reason: string | null | undefined,
): Array<Record<string, unknown>> {
  const fired = firedRules(ruleHits);
  const primary = resolvePrimaryRule(ruleHits, reason);
  if (!primary) return fired;
  const primaryId = String(primary.rule_id || "");
  return fired.filter((hit) => String(hit.rule_id || "") !== primaryId);
}

export function DemoConsole() {
  const searchParams = useSearchParams();
  const [userId, setUserId] = useState("demo-user");
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [inputSha, setInputSha] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [globalError, setGlobalError] = useState<ApiFailure | null>(null);
  const [seriesError, setSeriesError] = useState<ApiFailure | null>(null);
  const [momentsError, setMomentsError] = useState<ApiFailure | null>(null);
  const [inspectorError, setInspectorError] = useState<ApiFailure | null>(null);
  const [summaryError, setSummaryError] = useState<ApiFailure | null>(null);

  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [series, setSeries] = useState<SeriesData | null>(null);
  const [moments, setMoments] = useState<MomentData[]>([]);
  const [momentsSource, setMomentsSource] = useState<string | null>(null);
  const [inspectorTradeId, setInspectorTradeId] = useState<string>("0");
  const [inspector, setInspector] = useState<TradeInspectorData["trade"] | null>(null);
  const [activeView, setActiveView] = useState<"overview" | "moments" | "inspector">("overview");

  const loadTradeInspector = useCallback(async (id: string, tradeId: number) => {
    setInspectorError(null);
    const payload = await request<TradeInspectorData>(`/jobs/${id}/trade/${tradeId}`);
    setInspector(payload.data.trade);
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem(USER_ID_KEY);
    if (saved && saved.trim()) setUserId(saved.trim());
  }, []);

  useEffect(() => {
    if (!userId.trim()) return;
    window.localStorage.setItem(USER_ID_KEY, userId.trim());
  }, [userId]);

  const loadEvidence = useCallback(async (id: string) => {
    setSummaryError(null);
    setSeriesError(null);
    setMomentsError(null);
    const [summaryResult, seriesResult, momentsResult] = await Promise.allSettled([
      request<SummaryData>(`/jobs/${id}/summary`),
      request<SeriesData>(`/jobs/${id}/counterfactual/series?max_points=2000`),
      request<MomentsEnvelopeData>(`/jobs/${id}/moments`),
    ]);

    if (summaryResult.status === "fulfilled") {
      setSummary(summaryResult.value.data);
    } else {
      setSummary(null);
      setSummaryError(toFailure(summaryResult.reason));
    }

    if (seriesResult.status === "fulfilled") {
      setSeries(seriesResult.value.data);
    } else {
      setSeries(null);
      setSeriesError(toFailure(seriesResult.reason));
    }

    if (momentsResult.status === "fulfilled") {
      const resolvedMoments = momentsResult.value.data.moments || [];
      setMoments(resolvedMoments);
      setMomentsSource(momentsResult.value.data.source || null);
      const nonOvertradingMoment = resolvedMoments.find(
        (row) => row.is_revenge === true || row.is_loss_aversion === true,
      );
      const highestImpactMoment = resolvedMoments
        .filter((row) => typeof row.impact_abs === "number")
        .sort((left, right) => (right.impact_abs || 0) - (left.impact_abs || 0))[0];
      const preferredMoment = nonOvertradingMoment || highestImpactMoment || resolvedMoments[0];
      const selectedTradeId = typeof preferredMoment?.trace_trade_id === "number" ? preferredMoment.trace_trade_id : 0;
      setInspectorTradeId(String(selectedTradeId));
      try {
        await loadTradeInspector(id, selectedTradeId);
      } catch (error: unknown) {
        setInspector(null);
        setInspectorError(toFailure(error));
      }
    } else {
      setMoments([]);
      setMomentsSource(null);
      setMomentsError(toFailure(momentsResult.reason));
      setInspector(null);
      setInspectorError(null);
    }
  }, [loadTradeInspector]);

  const pollJob = useCallback(
    async (id: string) => {
      const payload = await request<JobStatusData>(`/jobs/${id}`);
      const s = payload.job?.execution_status || payload.data.status || null;
      setStatus(s);
      setOutcome(payload.data.outcome || null);
      if (terminal(s) && s === "COMPLETED") {
        await loadEvidence(id);
      }
      return s;
    },
    [loadEvidence],
  );

  useEffect(() => {
    if (!jobId || !status || terminal(status)) return undefined;
    let active = true;
    const handle = window.setInterval(() => {
      if (!active) return;
      void pollJob(jobId).catch((error: unknown) => {
        if (!active) return;
        setGlobalError(toFailure(error));
      });
    }, POLL_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(handle);
    };
  }, [jobId, pollJob, status]);

  const hydrateExistingJob = useCallback(
    async (id: string) => {
      setGlobalError(null);
      setSummaryError(null);
      setSeriesError(null);
      setMomentsError(null);
      setInspectorError(null);
      setJobId(id);
      window.localStorage.setItem(LAST_JOB_ID_KEY, id);
      const payload = await request<JobStatusData>(`/jobs/${id}`);
      const currentStatus = payload.job?.execution_status || payload.data.status || null;
      setStatus(currentStatus);
      setOutcome(payload.data.outcome || null);
      setInputSha(payload.job?.input_sha256 || null);
      if (currentStatus === "COMPLETED") {
        await loadEvidence(id);
      }
    },
    [loadEvidence],
  );

  useEffect(() => {
    const fromQuery = searchParams.get("jobId");
    const fromStorage = window.localStorage.getItem(LAST_JOB_ID_KEY);
    const candidate = (fromQuery && fromQuery.trim()) || (fromStorage && fromStorage.trim()) || null;
    if (!candidate) return;
    if (jobId === candidate) return;
    void hydrateExistingJob(candidate).catch((error: unknown) => {
      setGlobalError(toFailure(error));
    });
  }, [hydrateExistingJob, jobId, searchParams]);

  const submit = useCallback(async () => {
    if (!file) {
      setGlobalError({ status: 0, code: "MISSING_FILE", message: "Select a CSV file first.", details: null });
      return;
    }
    if (!userId.trim()) {
      setGlobalError({ status: 0, code: "MISSING_USER_ID", message: "Enter a user_id.", details: null });
      return;
    }
    setUploading(true);
    setGlobalError(null);
    setSeriesError(null);
    setMomentsError(null);
    setInspectorError(null);
    setSummaryError(null);
    setSummary(null);
    setSeries(null);
    setMoments([]);
    setMomentsSource(null);
    setInspector(null);
    setInspectorTradeId("0");
    setActiveView("overview");
    setStatus("PENDING");
    setOutcome(null);

    try {
      const form = new FormData();
      form.append("file", file);
      form.append("user_id", userId.trim());
      form.append("run_async", "true");
      const created = await request<{ status_url?: string }>("/jobs", { method: "POST", body: form });
      const id = created.job?.job_id;
      if (!id) {
        throw new RequestError(0, "MISSING_JOB_ID", "Job ID missing in response.", created);
      }
      setJobId(id);
      window.localStorage.setItem(LAST_JOB_ID_KEY, id);
      setInputSha(created.job?.input_sha256 || null);
      setStatus(created.job?.execution_status || "PENDING");
      await pollJob(id);
    } catch (error: unknown) {
      setGlobalError(toFailure(error));
      setStatus("FAILED");
    } finally {
      setUploading(false);
    }
  }, [file, pollJob, userId]);

  const chart = useMemo(() => {
    if (!series || series.points.length === 0) return null;
    const width = 1000;
    const height = 300;
    const padding = 24;
    const values = series.points.flatMap((point) => [
      point.actual_equity,
      point.policy_replay_equity ?? point.simulated_equity,
    ]);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const range = Math.max(1e-9, maxValue - minValue);

    const x = (index: number) =>
      series.points.length <= 1
        ? width / 2
        : padding + (index * (width - padding * 2)) / (series.points.length - 1);
    const y = (value: number) =>
      height - padding - ((value - minValue) / range) * (height - padding * 2);

    const actual = series.points.map((point, index) => `${x(index)},${y(point.actual_equity)}`).join(" ");
    const simulated = series.points
      .map((point, index) => `${x(index)},${y(point.policy_replay_equity ?? point.simulated_equity)}`)
      .join(" ");

    const markerNodes = series.markers
      .map((marker, idx) => {
        const pointIndex = series.points.findIndex((point) => point.timestamp === marker.timestamp);
        if (pointIndex < 0) return null;
        const impactText = fmtMaybeCurrency(marker.impact_abs ?? null);
        return {
          key: `${marker.timestamp}-${marker.asset}-${idx}`,
          cx: x(pointIndex),
          cy: y(series.points[pointIndex].actual_equity),
          title: `${marker.trade_grade} • ${marker.asset} • ${marker.reason_label || marker.blocked_reason} • impact ${impactText}`,
          color: markerColor(marker.trade_grade),
          reasonLabel: marker.reason_label || "No intervention",
          blockedReason: marker.blocked_reason,
          interventionType: marker.intervention_type || "KEEP (no change)",
          impactAbs: marker.impact_abs ?? null,
        };
      })
      .filter(Boolean) as Array<{
        key: string;
        cx: number;
        cy: number;
        title: string;
        color: string;
        reasonLabel: string;
        blockedReason: string;
        interventionType: string;
        impactAbs: number | null;
      }>;

    return { width, height, padding, actual, simulated, markerNodes };
  }, [series]);

  const loadInspectorFromInput = useCallback(async () => {
    if (!jobId) {
      setInspectorError({ status: 0, code: "MISSING_JOB_ID", message: "Run a job first.", details: null });
      return;
    }
    const parsed = Number(inspectorTradeId);
    if (!Number.isInteger(parsed) || parsed < 0) {
      setInspectorError({
        status: 0,
        code: "INVALID_TRADE_ID",
        message: "trade_id must be an integer >= 0.",
        details: { trade_id: inspectorTradeId },
      });
      return;
    }
    try {
      await loadTradeInspector(jobId, parsed);
    } catch (error: unknown) {
      setInspector(null);
      setInspectorError(toFailure(error));
    }
  }, [inspectorTradeId, jobId, loadTradeInspector]);

  const sortedMoments = useMemo(
    () =>
      [...moments].sort(
        (left, right) => (right.impact_abs || 0) - (left.impact_abs || 0),
      ),
    [moments],
  );

  const modifiedMomentsCount = useMemo(
    () =>
      sortedMoments.filter((moment) =>
        isMeaningfullyModified(moment.intervention_type, moment.impact_abs),
      ).length,
    [sortedMoments],
  );

  const inspectorRule = useMemo(
    () => resolvePrimaryRule(inspector?.evidence.rule_hits, inspector?.decision.reason),
    [inspector],
  );
  const inspectorSecondaryRules = useMemo(
    () => resolveSecondaryRules(inspector?.evidence.rule_hits, inspector?.decision.reason),
    [inspector],
  );

  const inspectorIntervention = inspector?.decision.intervention_type || "KEEP (no change)";
  const inspectorDelta = inspector?.counterfactual.delta_pnl ?? null;
  const inspectorImpactPct = inspector?.counterfactual.impact_pct_balance ?? null;
  const policyChanged = isMeaningfullyModified(inspectorIntervention, inspectorDelta);
  const biasImpactRows = useMemo(() => {
    const byBias = series?.metrics?.top_bias_by_impact?.by_bias;
    if (!byBias) return [] as Array<{ bias: string; impact: number }>;
    return Object.entries(byBias)
      .map(([bias, impact]) => ({
        bias,
        impact: typeof impact === "number" && Number.isFinite(impact) ? impact : 0,
      }))
      .sort((left, right) => right.impact - left.impact);
  }, [series]);

  const recommendations = useMemo(() => {
    const rows: Array<{ title: string; detail: string }> = [];
    const revengeMoment = sortedMoments.find((moment) => moment.is_revenge === true);
    const lossAversionMoment = sortedMoments.find((moment) => moment.is_loss_aversion === true);
    const overtradingMoment = sortedMoments.find((moment) => moment.is_overtrading === true);
    const rates = summary?.bias_rates;

    if (revengeMoment) {
      rows.push({
        title: "Revenge guardrail",
        detail: `After a significant loss, cap the next trade to median size for 30 minutes. In this run: impact ${fmtMaybePercent(revengeMoment.impact_pct_balance)} of balance at ${revengeMoment.timestamp}.`,
      });
    }
    if (lossAversionMoment) {
      rows.push({
        title: "Loss cap discipline",
        detail: `Your outsized-loss profile triggered loss aversion checks (rate ${formatPercentFromRatio(rates?.loss_aversion_rate)}). Start with a fixed stop aligned to your historical loss threshold.`,
      });
    }
    if (overtradingMoment) {
      rows.push({
        title: "Cooldown policy",
        detail: `Trade bursts drive avoidable variance (overtrading rate ${formatPercentFromRatio(rates?.overtrading_rate)}). Add cooldown between entries during high-frequency windows.`,
      });
    }
    if (rows.length === 0) {
      rows.push({
        title: "No major intervention pattern",
        detail: "Most trades were unchanged in replay. Focus on consistency and monitor bias rates as new sessions accumulate.",
      });
    }
    return rows.slice(0, 3);
  }, [sortedMoments, summary]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="rounded-xl border border-border bg-surface-1 p-5">
        <h1 className="text-xl font-semibold text-foreground">Evidence Console (Single Run)</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Objective: inspect deterministic disciplined replay decisions with verifiable receipts.
        </p>
        <div className="mt-4 text-xs text-muted-foreground">
          API base: <span className="tabular text-foreground">{API_BASE}</span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[220px_1fr_auto]">
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
            onClick={() => void submit()}
            disabled={uploading}
            className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
          >
            {uploading ? "Uploading..." : "Run"}
          </button>
        </div>
        <div className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-4">
          <div>Job: <span className="tabular text-foreground">{jobId || "—"}</span></div>
          <div>Status: <span className="tabular text-foreground">{status || "—"}</span></div>
          <div>Outcome: <span className="tabular text-foreground">{prettyOutcome(outcome)}</span></div>
          <div>SHA: <span className="tabular text-foreground">{inputSha ? `${inputSha.slice(0, 12)}...` : "—"}</span></div>
        </div>
        {globalError && (
          <ErrorBox title="Run error" failure={globalError} />
        )}
      </section>

      <section className="rounded-xl border border-border bg-surface-1 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Review Focus
        </h2>
        <p className="mt-2 text-xs text-muted-foreground">
          Fast path: answer 3 questions for one trade and session rollup.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <NavPill active={activeView === "overview"} onClick={() => setActiveView("overview")}>
            Overview
          </NavPill>
          <NavPill active={activeView === "moments"} onClick={() => setActiveView("moments")}>
            Moments
          </NavPill>
          <NavPill active={activeView === "inspector"} onClick={() => setActiveView("inspector")}>
            Trade Inspector
          </NavPill>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-surface-1 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Three Questions
        </h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <QuestionCard
            title="1) Did policy change this trade?"
            highlight={policyChanged ? "YES" : "NO"}
            detail={
              inspector
                ? `${inspectorIntervention} · delta ${fmtMaybeCurrency(inspectorDelta)}`
                : "Inspect a trade to answer this."
            }
            tone={policyChanged ? "warning" : "neutral"}
          />
          <QuestionCard
            title="2) Why?"
            highlight={inspector?.decision.reason_label || "n/a"}
            detail={
              inspectorRule
                ? `${String(inspectorRule.rule_id)} · ${inspector?.thesis?.trigger || "trigger not available"}`
                : inspector?.thesis?.trigger || "No fired rule for this trade."
            }
            tone={inspectorRule ? "accent" : "neutral"}
          />
          <QuestionCard
            title="3) So what?"
            highlight={
              inspector
                ? `Impact ${fmtMaybePercent(inspectorImpactPct)} of balance`
                : "n/a"
            }
            detail={
              series?.metrics
                ? `% modified ${fmtMaybePercent(series.metrics.pct_trades_modified)} · top bias ${series.metrics.top_bias_by_impact.bias}`
                : "Run a completed job to load session rollups."
            }
            tone={policyChanged ? "positive" : "neutral"}
          />
        </div>
      </section>

      {activeView === "overview" ? (
        <section className="rounded-xl border border-border bg-surface-1 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Overview
          </h2>
          <div className="mt-3 rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-foreground">
            <span className="font-semibold">What this shows:</span> your actual trades versus the same trades replayed
            with behavioral safeguards (sizing/cooldown/loss caps). Price path, timing, and signals are unchanged.
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Disciplined replay follows deterministic constraints. It does not invent alternative entries.
          </p>
          <div className="mt-3 rounded-md border border-border-subtle bg-surface-2 p-3 text-xs text-muted-foreground">
            <div className="font-semibold text-foreground">Intervention semantics</div>
            <div className="mt-1">Trade kept, risk reduced: same trade with smaller size exposure.</div>
            <div className="mt-1">Trade kept, downside capped: same trade with capped loss.</div>
            <div className="mt-1">Trade skipped (cooldown): no replacement trade assumed, replay pnl = 0.</div>
          </div>
          {series?.metrics ? (
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <MetricCard
                title="Return"
                primary={`Actual ${fmtMaybeCurrency(series.metrics.return_actual)}`}
                secondary={`Disciplined ${fmtMaybeCurrency(series.metrics.return_policy_replay)}`}
              />
              <MetricCard
                title="Max Drawdown"
                primary={`Actual ${fmtMaybeCurrency(series.metrics.max_drawdown_actual)}`}
                secondary={`Disciplined ${fmtMaybeCurrency(series.metrics.max_drawdown_policy_replay)}`}
              />
              <MetricCard
                title="Worst Day"
                primary={`Actual ${fmtMaybeCurrency(series.metrics.worst_day_actual)}`}
                secondary={`Disciplined ${fmtMaybeCurrency(series.metrics.worst_day_policy_replay)}`}
              />
              <MetricCard
                title="Trade Volatility"
                primary={`Actual ${fmtMaybeNumber(series.metrics.trade_volatility_actual)}`}
                secondary={`Disciplined ${fmtMaybeNumber(series.metrics.trade_volatility_policy_replay)}`}
              />
              <MetricCard
                title="% Trades Modified"
                primary={fmtMaybePercent(series.metrics.pct_trades_modified)}
                secondary={`${modifiedMomentsCount}/${sortedMoments.length} highlighted moments changed`}
              />
              <MetricCard
                title="Top Bias by Impact"
                primary={`${series.metrics.top_bias_by_impact.bias} (${fmtMaybeCurrency(series.metrics.top_bias_by_impact.impact_abs_total)})`}
                secondary={`R:${fmtMaybeCurrency(series.metrics.top_bias_by_impact.by_bias["REVENGE_TRADING"])} · O:${fmtMaybeCurrency(series.metrics.top_bias_by_impact.by_bias["OVERTRADING"])} · L:${fmtMaybeCurrency(series.metrics.top_bias_by_impact.by_bias["LOSS_AVERSION"])}`}
              />
            </div>
          ) : null}
          {summaryError && <ErrorBox title="Summary fetch failed" failure={summaryError} />}
          {summary?.data_quality_flags && summary.data_quality_flags.length > 0 ? (
            <div className="mt-4 rounded-md border border-warning/30 bg-warning/10 p-3 text-xs">
              <div className="font-semibold text-foreground">Data anomalies detected</div>
              <div className="mt-2 space-y-2">
                {summary.data_quality_flags.map((flag, index) => (
                  <div key={`${flag.code || "flag"}-${index}`}>
                    <div className="text-foreground">
                      {flag.code || "FLAG"} ({flag.count ?? 0})
                    </div>
                    <div className="text-muted-foreground">{flag.message || "Data quality warning."}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {biasImpactRows.length > 0 ? (
            <div className="mt-4 rounded-md border border-border-subtle bg-surface-2 p-3 text-xs">
              <div className="font-semibold text-foreground">Top Bias by Impact (Leaderboard)</div>
              <div className="mt-2 space-y-1">
                {biasImpactRows.map((row) => (
                  <div key={row.bias} className="flex items-center justify-between">
                    <span className="text-muted-foreground">{row.bias}</span>
                    <span className="tabular text-foreground">{fmtMaybeCurrency(row.impact)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div className="mt-4 rounded-md border border-border-subtle bg-surface-2 p-3 text-xs">
            <div className="font-semibold text-foreground">Actionable Recommendations (from your data)</div>
            <div className="mt-2 space-y-2">
              {recommendations.map((item, idx) => (
                <div key={`${item.title}-${idx}`}>
                  <div className="font-medium text-foreground">{item.title}</div>
                  <div className="text-muted-foreground">{item.detail}</div>
                </div>
              ))}
            </div>
          </div>
          {seriesError && <ErrorBox title="Timeline fetch failed" failure={seriesError} />}
          {series && (
            <div className="mt-3 text-xs text-muted-foreground">
              showing <span className="tabular text-foreground">{series.returned_points}</span> downsampled points from{" "}
              <span className="tabular text-foreground">{series.total_points}</span> total trades (max_points=
              {series.max_points})
            </div>
          )}
          {chart ? (
            <div className="mt-4 rounded-md border border-border-subtle bg-surface-2 p-2">
              <div className="mb-2 flex gap-4 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-accent" />
                  actual equity
                </span>
                <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-muted-foreground" />
                  disciplined replay equity
                </span>
              </div>
              <svg viewBox={`0 0 ${chart.width} ${chart.height}`} className="h-72 w-full">
                <line
                  x1={chart.padding}
                  y1={chart.height - chart.padding}
                  x2={chart.width - chart.padding}
                  y2={chart.height - chart.padding}
                  className="stroke-border"
                />
                <line
                  x1={chart.padding}
                  y1={chart.padding}
                  x2={chart.padding}
                  y2={chart.height - chart.padding}
                  className="stroke-border"
                />
                <polyline points={chart.actual} fill="none" className="stroke-accent" strokeWidth="2" />
                <polyline points={chart.simulated} fill="none" className="stroke-muted-foreground" strokeWidth="2" strokeDasharray="6 5" />
                {chart.markerNodes.map((node) => (
                  <g key={node.key}>
                    <circle cx={node.cx} cy={node.cy} r="4" fill={node.color} />
                    <title>{node.title}</title>
                  </g>
                ))}
              </svg>
              <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                {chart.markerNodes.map((node) => (
                  <div key={`${node.key}-note`}>
                    marker: <span className="text-foreground">{node.reasonLabel}</span> · {node.interventionType} · impact{" "}
                    <span className="tabular text-foreground">{fmtMaybeCurrency(node.impactAbs)}</span> · blocked_reason=
                    {node.blockedReason}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">No timeline points yet.</p>
          )}
        </section>
      ) : null}

      {activeView === "moments" ? (
        <section className="rounded-xl border border-border bg-surface-1 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Moments
          </h2>
          <p className="mt-2 text-xs text-muted-foreground">
            Sorted by impact. Click a card to open Trade Inspector on that trade.
          </p>
          {momentsSource && (
            <p className="mt-1 text-xs text-muted-foreground">source: {momentsSource}</p>
          )}
          {momentsError && <ErrorBox title="Moments fetch failed" failure={momentsError} />}
          <div className="mt-4 space-y-3">
            {sortedMoments.map((moment, index) => {
              const momentRuleHits = moment.evidence.rule_hits || moment.rule_hits || null;
              const momentRule = resolvePrimaryRule(momentRuleHits, moment.reason);
              const momentSecondaryRules = resolveSecondaryRules(momentRuleHits, moment.reason);
              const momentChanged = isMeaningfullyModified(moment.intervention_type, moment.impact_abs);
              return (
                <article
                  key={`${moment.timestamp}-${moment.asset}-${index}`}
                  className={`rounded-md border border-border-subtle bg-surface-2 p-3 ${momentChanged ? "" : "opacity-70"}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-foreground">
                        {moment.trade_grade} · {moment.asset}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">{moment.timestamp}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (!jobId || typeof moment.trace_trade_id !== "number") return;
                        setInspectorTradeId(String(moment.trace_trade_id));
                        setActiveView("inspector");
                        void loadTradeInspector(jobId, moment.trace_trade_id).catch((error: unknown) => {
                          setInspector(null);
                          setInspectorError(toFailure(error));
                        });
                      }}
                      className="rounded border border-border bg-surface-1 px-2 py-1 text-xs text-foreground hover:bg-surface-2 disabled:opacity-60"
                      disabled={!jobId || typeof moment.trace_trade_id !== "number"}
                    >
                      Open Trade Inspector
                    </button>
                  </div>
                  {moment.bias_category ? (
                    <div className="mt-1 text-xs text-muted-foreground">category: {moment.bias_category}</div>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className={`rounded border px-2 py-0.5 text-[11px] ${interventionPillTone(moment.intervention_type)}`}>
                      {moment.intervention_type || "KEEP (no change)"}
                    </span>
                    <span className="rounded border border-border bg-surface-1 px-2 py-0.5 text-[11px] text-foreground">
                      {moment.reason_label || "No intervention"}
                    </span>
                    {!momentChanged ? (
                      <span className="rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                        unchanged
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-2 text-xs tabular text-foreground">
                    actual {fmtMaybeCurrency(moment.pnl)} | disciplined {fmtMaybeCurrency(moment.policy_replay_pnl ?? moment.simulated_pnl)} | impact {fmtMaybePercent(moment.impact_pct_balance)} of balance
                  </div>
                  <div className="mt-1 text-xs tabular text-muted-foreground">
                    impact_usd {fmtMaybeCurrency(moment.impact_abs)}
                  </div>
                  <p className="mt-2 text-sm text-foreground">{moment.explanation_human}</p>
                  {moment.thesis ? (
                    <div className="mt-2 rounded border border-border px-2 py-1 text-xs text-muted-foreground">
                      <div>Trigger: {moment.thesis.trigger}</div>
                      <div>Behavior: {moment.thesis.behavior}</div>
                      <div>Intervention: {moment.thesis.intervention}</div>
                      <div>Outcome: {moment.thesis.outcome}</div>
                    </div>
                  ) : null}
                  {moment.counterfactual_mechanics ? (
                    <div className="mt-2 rounded border border-border px-2 py-1 text-xs text-muted-foreground">
                      <div className="font-semibold text-foreground">Counterfactual mechanics</div>
                      <div>Mechanism: {moment.counterfactual_mechanics.mechanism || "n/a"}</div>
                      <div>Scale factor: {fmtMaybeScale(moment.counterfactual_mechanics.scale_factor)}</div>
                      <div>
                        Size USD: {fmtMaybeMagnitudeCurrency(moment.counterfactual_mechanics.size_usd_before)}{" "}
                        -&gt; {fmtMaybeMagnitudeCurrency(moment.counterfactual_mechanics.size_usd_after)}
                      </div>
                      <div>Cap used: {fmtMaybeCurrency(moment.counterfactual_mechanics.cap_used ?? null)}</div>
                    </div>
                  ) : null}
                  {momentRule ? (
                    <div className="mt-2 rounded border border-border px-2 py-1 text-xs text-muted-foreground">
                      primary_rule={String(momentRule.rule_id)} · fired={String(Boolean(momentRule.fired))}
                      {momentSecondaryRules.length > 0 ? (
                        <span> · also_triggered={momentSecondaryRules.map((hit) => String(hit.rule_id || "UNKNOWN")).join(",")}</span>
                      ) : null}
                    </div>
                  ) : null}
                  <details className="mt-2 rounded border border-border px-2 py-1 text-xs text-muted-foreground">
                    <summary className="cursor-pointer select-none">Evidence (inputs / thresholds / comparisons)</summary>
                    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-[11px] text-foreground">
                      {JSON.stringify(
                        {
                          thresholds_referenced: moment.thresholds_referenced,
                          evidence: moment.evidence,
                          error_notes: moment.error_notes,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </article>
              );
            })}
            {sortedMoments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No moments returned.</p>
            ) : null}
          </div>
        </section>
      ) : null}

      {activeView === "inspector" ? (
        <section className="rounded-xl border border-border bg-surface-1 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Trade Inspector (<code>/trade/{"{trade_id}"}</code>)
          </h2>
          <p className="mt-2 text-xs text-muted-foreground">
            Raw row, derived flags, rule receipts, and disciplined replay result for a single trade.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <input
              value={inspectorTradeId}
              onChange={(event) => setInspectorTradeId(event.target.value)}
              placeholder="trade_id"
              className="w-32 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm outline-none ring-accent/30 focus:ring-2"
            />
            <button
              type="button"
              onClick={() => void loadInspectorFromInput()}
              className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm font-medium text-foreground"
              disabled={!jobId}
            >
              Inspect Trade
            </button>
          </div>
          {inspectorError && <ErrorBox title="Trade inspector error" failure={inspectorError} />}
          {inspector ? (
            <div className="mt-4 space-y-3">
              <div className="rounded-md border border-border-subtle bg-surface-2 p-3 text-sm">
                <div className="font-semibold text-foreground">Trade #{inspector.trade_id}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {inspector.evidence.timestamp} · {inspector.evidence.asset} · side={inspector.evidence.side} · size={fmtMaybeMagnitudeCurrency(inspector.evidence.size_usd)}
                </div>
                <p className="mt-2 text-sm text-foreground">{inspector.explanation_plain_english || "n/a"}</p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-md border border-border-subtle bg-surface-2 p-3 text-xs">
                  <div className="font-semibold text-foreground">Derived Flags</div>
                  <div className="mt-1 text-muted-foreground">
                    revenge={fmtMaybeBool(inspector.derived_flags.is_revenge)} | overtrading={fmtMaybeBool(inspector.derived_flags.is_overtrading)} | loss_aversion={fmtMaybeBool(inspector.derived_flags.is_loss_aversion)}
                  </div>
                </div>
                <div className="rounded-md border border-border-subtle bg-surface-2 p-3 text-xs">
                  <div className="font-semibold text-foreground">Decision</div>
                  <div className="mt-1 text-muted-foreground">
                    decision={inspector.decision.decision} | reason={inspector.decision.reason} | blocked_reason={inspector.decision.blocked_reason}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className={`rounded border px-2 py-0.5 text-[11px] ${interventionPillTone(inspector.decision.intervention_type)}`}>
                      {inspector.decision.intervention_type || "KEEP (no change)"}
                    </span>
                    <span className="rounded border border-border bg-surface-1 px-2 py-0.5 text-[11px] text-foreground">
                      {inspector.decision.reason_label || "No intervention"}
                    </span>
                  </div>
                </div>
                <div className="rounded-md border border-border-subtle bg-surface-2 p-3 text-xs md:col-span-2">
                  <div className="font-semibold text-foreground">Counterfactual</div>
                  <div className="mt-1 text-muted-foreground">
                    actual={fmtMaybeCurrency(inspector.counterfactual.actual_pnl)} | disciplined={fmtMaybeCurrency(inspector.counterfactual.policy_replay_pnl ?? inspector.counterfactual.simulated_pnl)} | impact={fmtMaybePercent(inspector.counterfactual.impact_pct_balance)} of balance
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    impact_usd={fmtMaybeCurrency(inspector.counterfactual.delta_pnl)}
                  </div>
                </div>
              </div>
              {inspector.thesis ? (
                <div className="rounded-md border border-border-subtle bg-surface-2 p-3 text-xs">
                  <div className="font-semibold text-foreground">Trade Thesis</div>
                  <div className="mt-1 text-muted-foreground">Trigger: {inspector.thesis.trigger}</div>
                  <div className="mt-1 text-muted-foreground">Behavior: {inspector.thesis.behavior}</div>
                  <div className="mt-1 text-muted-foreground">Intervention: {inspector.thesis.intervention}</div>
                  <div className="mt-1 text-muted-foreground">Outcome: {inspector.thesis.outcome}</div>
                </div>
              ) : null}
              {inspector.counterfactual_mechanics ? (
                <div className="rounded-md border border-border-subtle bg-surface-2 p-3 text-xs text-muted-foreground">
                  <div className="font-semibold text-foreground">Counterfactual mechanics</div>
                  <div>Mechanism: {inspector.counterfactual_mechanics.mechanism || "n/a"}</div>
                  <div>Scale factor: {fmtMaybeScale(inspector.counterfactual_mechanics.scale_factor)}</div>
                  <div>
                    Quantity: {fmtMaybeNumber(inspector.counterfactual_mechanics.quantity_before, 6)} -&gt;{" "}
                    {fmtMaybeNumber(inspector.counterfactual_mechanics.quantity_after, 6)}
                  </div>
                  <div>
                    Size USD: {fmtMaybeMagnitudeCurrency(inspector.counterfactual_mechanics.size_usd_before)} -&gt;{" "}
                    {fmtMaybeMagnitudeCurrency(inspector.counterfactual_mechanics.size_usd_after)}
                  </div>
                  <div>Cap used: {fmtMaybeCurrency(inspector.counterfactual_mechanics.cap_used ?? null)}</div>
                </div>
              ) : null}
              {inspector.lesson ? (
                <div className="rounded-md border border-border-subtle bg-surface-2 p-3 text-xs text-foreground">
                  {inspector.lesson}
                </div>
              ) : null}
              {inspectorRule ? (
                <div className="rounded border border-border px-2 py-1 text-xs text-muted-foreground">
                  primary_rule={String(inspectorRule.rule_id)} · fired={String(Boolean(inspectorRule.fired))}
                  {inspectorSecondaryRules.length > 0 ? (
                    <span> · also_triggered={inspectorSecondaryRules.map((hit) => String(hit.rule_id || "UNKNOWN")).join(",")}</span>
                  ) : null}
                </div>
              ) : null}

              <details className="rounded border border-border px-2 py-1 text-xs text-muted-foreground">
                <summary className="cursor-pointer select-none">Triggering Prior Trade</summary>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-[11px] text-foreground">
                  {JSON.stringify(inspector.decision.triggering_prior_trade, null, 2)}
                </pre>
              </details>
              <details className="rounded border border-border px-2 py-1 text-xs text-muted-foreground">
                <summary className="cursor-pointer select-none">Raw Input Row</summary>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-[11px] text-foreground">
                  {JSON.stringify(inspector.raw_input_row, null, 2)}
                </pre>
              </details>
              <details className="rounded border border-border px-2 py-1 text-xs text-muted-foreground">
                <summary className="cursor-pointer select-none">Rule Hits (inputs / thresholds / comparisons)</summary>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-[11px] text-foreground">
                  {JSON.stringify(inspector.evidence.rule_hits, null, 2)}
                </pre>
              </details>
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">No trade selected.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}

function MetricCard({ title, primary, secondary }: { title: string; primary: string; secondary: string }) {
  return (
    <div className="rounded-md border border-border-subtle bg-surface-2 p-3 text-xs">
      <div className="font-semibold text-foreground">{title}</div>
      <div className="mt-1 tabular text-foreground">{primary}</div>
      <div className="mt-1 text-muted-foreground">{secondary}</div>
    </div>
  );
}

function NavPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-3 py-1.5 text-xs font-medium ${active
        ? "border-foreground bg-foreground text-background"
        : "border-border bg-surface-2 text-foreground hover:bg-surface-1"
        }`}
    >
      {children}
    </button>
  );
}

function QuestionCard({
  title,
  highlight,
  detail,
  tone,
}: {
  title: string;
  highlight: string;
  detail: string;
  tone: "neutral" | "warning" | "positive" | "accent";
}) {
  const toneClass =
    tone === "warning"
      ? "border-warning/40 bg-warning/10"
      : tone === "positive"
        ? "border-positive/40 bg-positive/10"
        : tone === "accent"
          ? "border-accent/40 bg-accent/10"
          : "border-border-subtle bg-surface-2";
  return (
    <div className={`rounded-md border p-3 text-xs ${toneClass}`}>
      <div className="font-semibold text-foreground">{title}</div>
      <div className="mt-1 text-sm font-semibold text-foreground">{highlight}</div>
      <div className="mt-1 text-muted-foreground">{detail}</div>
    </div>
  );
}

function ErrorBox({ title, failure }: { title: string; failure: ApiFailure }) {
  return (
    <div className="mt-3 rounded-md border border-negative/30 bg-negative/10 px-3 py-2 text-xs text-negative">
      <div className="font-semibold">{title}</div>
      <div className="tabular">status={failure.status} code={failure.code}</div>
      <div>{failure.message}</div>
      {failure.details ? (
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-[11px]">
          {JSON.stringify(failure.details, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}
