import type { Trade } from '@/lib/biasDetector';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '');
const DEFAULT_POLL_INTERVAL_MS = 1500;
const DEFAULT_MAX_POLL_MS = 10 * 60 * 1000;

export const BACKEND_KEYS = {
  USER_ID: 'temper.evidence.user_id',
  LAST_JOB_ID: 'temper.evidence.last_job_id',
  LEGACY_LAST_JOB_ID: 'temper_last_job_id',
} as const;

type Envelope<T> = {
  ok: boolean;
  job?: { job_id?: string | null; execution_status?: string | null } | null;
  data: T;
  error?: { code?: string; message?: string } | null;
};

type JobStatusData = { status?: string };

type CounterfactualData = {
  offset: number;
  limit: number;
  total_rows: number;
  rows: Array<Record<string, unknown>>;
};

export type JobSummaryData = {
  headline?: string | null;
  delta_pnl?: number | null;
  cost_of_bias?: number | null;
  bias_rates?: Record<string, number | null>;
  badge_counts?: Record<string, number>;
  top_moments?: Array<Record<string, unknown>>;
  data_quality_flags?: Array<Record<string, unknown>>;
  execution_status?: string | null;
  error_type?: string | null;
  error_message?: string | null;
};

export type SeriesData = {
  points: Array<{
    timestamp: string;
    actual_equity: number;
    simulated_equity: number;
    policy_replay_equity?: number;
  }>;
  markers: Array<Record<string, unknown>>;
  total_points: number;
  returned_points: number;
  max_points: number;
  metrics?: Record<string, unknown>;
};

export type MomentsData = {
  moments: Array<Record<string, unknown>>;
  source?: string;
};

export type TradeInspectorData = {
  trade: Record<string, unknown> | null;
};

export type EloData = {
  status?: string;
  outcome?: string | null;
  delta_pnl?: number | null;
  badge_counts?: Record<string, number>;
  elo?: {
    base: number;
    delta: number;
    projected: number;
    formula?: string;
  } | null;
};

export type CoachData = {
  coach?: Record<string, unknown>;
  coach_error?: Record<string, unknown>;
};

export type TradeCoachData = {
  trade_coach?: Record<string, unknown>;
  trade_coach_error?: Record<string, unknown>;
};

export type TradeVoiceData = {
  voice?: {
    provider?: string;
    mime_type?: string;
    artifact?: string;
    trade_id?: number;
    generated_at?: string;
  };
  voice_error?: Record<string, unknown>;
};

export type JournalTranscriptionData = {
  transcript?: string;
  provider?: string;
  artifact?: string;
  mime_type?: string;
};

type CreateJobOptions = {
  runAsync?: boolean;
  dailyMaxLoss?: number;
  kRepeat?: number;
  maxSeconds?: number;
  pollIntervalMs?: number;
  timeoutMs?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function normalizeSide(value: unknown): 'BUY' | 'SELL' {
  const text = String(value ?? '').toUpperCase();
  if (text.includes('SELL') || text.includes('SHORT')) return 'SELL';
  return 'BUY';
}

function rowToTrade(row: Record<string, unknown>): Trade | null {
  const timestamp = String(row.timestamp ?? row.time ?? '').trim();
  const asset = String(row.asset ?? row.symbol ?? '').trim() || 'UNKNOWN';
  const side = normalizeSide(row.side);
  const quantity =
    parseNumber(row.quantity) ??
    parseNumber(row.qty) ??
    parseNumber(row.size) ??
    1;
  const pnl = parseNumber(row.pnl) ?? 0;
  const price = parseNumber(row.price) ?? parseNumber(row.entry_price);

  if (!timestamp) return null;

  return {
    timestamp,
    asset,
    side,
    quantity,
    pnl,
    price,
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<Envelope<T>> {
  const response = await fetch(`${API_BASE}${path}`, init);
  const payload = (await response.json()) as Envelope<T>;
  if (!response.ok || !payload.ok) {
    const message = payload?.error?.message || `Request failed (${response.status})`;
    throw new Error(message);
  }
  return payload;
}

export function getUserId(): string {
  if (typeof window === 'undefined') return 'demo-user';
  const saved = window.localStorage.getItem(BACKEND_KEYS.USER_ID);
  return saved && saved.trim() ? saved.trim() : 'demo-user';
}

export function setLastJobId(jobId: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(BACKEND_KEYS.LAST_JOB_ID, jobId);
  window.localStorage.setItem(BACKEND_KEYS.LEGACY_LAST_JOB_ID, jobId);
}

export function getLastJobId(): string | null {
  if (typeof window === 'undefined') return null;
  return (
    window.localStorage.getItem(BACKEND_KEYS.LAST_JOB_ID) ||
    window.localStorage.getItem(BACKEND_KEYS.LEGACY_LAST_JOB_ID)
  );
}

export async function fetchJobStatus(jobId: string): Promise<{ status: string | null }> {
  const payload = await request<JobStatusData>(`/jobs/${jobId}`);
  const status = payload.job?.execution_status || payload.data?.status || null;
  return { status };
}

export async function createAndWaitForJob(file: File, userId?: string, opts?: CreateJobOptions): Promise<string> {
  const effectiveUser = (userId || getUserId()).trim() || 'demo-user';
  const form = new FormData();
  form.append('file', file);
  form.append('user_id', effectiveUser);
  form.append('run_async', String(opts?.runAsync ?? true));
  form.append('k_repeat', String(opts?.kRepeat ?? 1));
  form.append('max_seconds', String(opts?.maxSeconds ?? 600));
  if (typeof opts?.dailyMaxLoss === 'number') {
    form.append('daily_max_loss', String(opts.dailyMaxLoss));
  }

  const created = await request<Record<string, unknown>>('/jobs', { method: 'POST', body: form });
  const jobId = created.job?.job_id;
  if (!jobId) {
    throw new Error('Backend did not return a job_id');
  }
  setLastJobId(jobId);

  const pollIntervalMs = opts?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_MAX_POLL_MS;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const statusPayload = await request<JobStatusData>(`/jobs/${jobId}`);
    const status = statusPayload.job?.execution_status || statusPayload.data?.status || null;
    if (status === 'COMPLETED') {
      return jobId;
    }
    if (status === 'FAILED' || status === 'TIMEOUT') {
      throw new Error(`Backend job ended with status ${status}`);
    }
    await sleep(pollIntervalMs);
  }

  throw new Error('Timed out waiting for backend job completion');
}

export async function fetchTradesFromJob(jobId: string): Promise<Trade[]> {
  const pageSize = 2000;
  let offset = 0;
  let totalRows = Number.POSITIVE_INFINITY;
  const rows: Array<Record<string, unknown>> = [];

  while (offset < totalRows) {
    const payload = await request<CounterfactualData>(`/jobs/${jobId}/counterfactual?offset=${offset}&limit=${pageSize}`);
    const data = payload.data;
    totalRows = Number(data.total_rows || 0);
    const pageRows = Array.isArray(data.rows) ? data.rows : [];
    rows.push(...pageRows);
    if (pageRows.length === 0) break;
    offset += pageRows.length;
  }

  return rows
    .map((row) => rowToTrade(row))
    .filter((trade): trade is Trade => Boolean(trade));
}

export async function fetchJobSummary(jobId: string): Promise<JobSummaryData> {
  const payload = await request<JobSummaryData>(`/jobs/${jobId}/summary`);
  return payload.data || {};
}

export async function fetchJobSeries(jobId: string, maxPoints = 2000): Promise<SeriesData> {
  const payload = await request<SeriesData>(`/jobs/${jobId}/counterfactual/series?max_points=${maxPoints}`);
  return payload.data;
}

export async function fetchJobMoments(jobId: string): Promise<MomentsData> {
  const payload = await request<MomentsData>(`/jobs/${jobId}/moments`);
  return payload.data;
}

export async function fetchTradeInspector(jobId: string, tradeId: number): Promise<TradeInspectorData> {
  const payload = await request<TradeInspectorData>(`/jobs/${jobId}/trade/${tradeId}`);
  return payload.data;
}

export async function fetchJobElo(jobId: string): Promise<EloData> {
  const payload = await request<EloData>(`/jobs/${jobId}/elo`);
  return payload.data;
}

export async function fetchJobCoach(jobId: string): Promise<CoachData> {
  const payload = await request<CoachData>(`/jobs/${jobId}/coach`);
  return payload.data;
}

export async function generateJobCoach(jobId: string, force = false): Promise<CoachData> {
  const payload = await request<CoachData>(`/jobs/${jobId}/coach?force=${force ? 'true' : 'false'}`, {
    method: 'POST',
  });
  return payload.data;
}

export async function fetchTradeCoach(jobId: string, tradeId: number): Promise<TradeCoachData> {
  const payload = await request<TradeCoachData>(`/jobs/${jobId}/trade/${tradeId}/coach`);
  return payload.data;
}

export async function generateTradeCoach(jobId: string, tradeId: number, force = false): Promise<TradeCoachData> {
  const payload = await request<TradeCoachData>(
    `/jobs/${jobId}/trade/${tradeId}/coach?force=${force ? 'true' : 'false'}`,
    { method: 'POST' },
  );
  return payload.data;
}

export async function generateTradeVoice(
  jobId: string,
  tradeId: number,
  provider: 'auto' | 'elevenlabs' | 'gradium' = 'auto',
  force = false,
): Promise<TradeVoiceData> {
  const payload = await request<TradeVoiceData>(
    `/jobs/${jobId}/trade/${tradeId}/voice?provider=${encodeURIComponent(provider)}&force=${force ? 'true' : 'false'}`,
    { method: 'POST' },
  );
  return payload.data;
}

export function getTradeVoiceUrl(jobId: string, tradeId: number): string {
  return `${API_BASE}/jobs/${jobId}/trade/${tradeId}/voice`;
}

export async function transcribeJournalAudio(jobId: string, file: File): Promise<JournalTranscriptionData> {
  const form = new FormData();
  form.append('audio', file);
  const payload = await request<JournalTranscriptionData>(`/jobs/${jobId}/journal/transcribe`, {
    method: 'POST',
    body: form,
  });
  return payload.data;
}

export async function fetchUserJobs(userId?: string): Promise<Array<Record<string, unknown>>> {
  const effectiveUser = (userId || getUserId()).trim() || 'demo-user';
  const payload = await request<{ jobs: Array<Record<string, unknown>> }>(`/users/${encodeURIComponent(effectiveUser)}/jobs?limit=50`);
  return Array.isArray(payload.data.jobs) ? payload.data.jobs : [];
}

export async function fetchUserHistory(userId?: string, limit = 20): Promise<Record<string, unknown>> {
  const effectiveUser = (userId || getUserId()).trim() || 'demo-user';
  const payload = await fetch(`${API_BASE}/api/history?userId=${encodeURIComponent(effectiveUser)}&limit=${limit}`);
  const data = await payload.json() as Record<string, unknown>;
  if (!payload.ok) {
    const message = (data?.error as string) || `History request failed (${payload.status})`;
    throw new Error(message);
  }
  return data;
}
