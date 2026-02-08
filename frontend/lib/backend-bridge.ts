import type { Trade } from '@/lib/biasDetector';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '');
const POLL_INTERVAL_MS = 1500;
const MAX_POLL_MS = 10 * 60 * 1000;

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

export async function createAndWaitForJob(file: File, userId?: string): Promise<string> {
  const effectiveUser = (userId || getUserId()).trim() || 'demo-user';
  const form = new FormData();
  form.append('file', file);
  form.append('user_id', effectiveUser);
  form.append('run_async', 'true');

  const created = await request<Record<string, unknown>>('/jobs', { method: 'POST', body: form });
  const jobId = created.job?.job_id;
  if (!jobId) {
    throw new Error('Backend did not return a job_id');
  }
  setLastJobId(jobId);

  const started = Date.now();
  while (Date.now() - started < MAX_POLL_MS) {
    const statusPayload = await request<JobStatusData>(`/jobs/${jobId}`);
    const status = statusPayload.job?.execution_status || statusPayload.data?.status || null;
    if (status === 'COMPLETED') {
      return jobId;
    }
    if (status === 'FAILED' || status === 'TIMEOUT') {
      throw new Error(`Backend job ended with status ${status}`);
    }
    await sleep(POLL_INTERVAL_MS);
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

export async function fetchUserJobs(userId?: string): Promise<Array<Record<string, unknown>>> {
  const effectiveUser = (userId || getUserId()).trim() || 'demo-user';
  const payload = await request<{ jobs: Array<Record<string, unknown>> }>(`/users/${encodeURIComponent(effectiveUser)}/jobs?limit=50`);
  return Array.isArray(payload.data.jobs) ? payload.data.jobs : [];
}
