// Copy-paste adapter for frontend wiring.
// Keep endpoint usage centralized to avoid drift.

export type ApiEnvelope<T> = {
  ok: boolean;
  job: {
    job_id: string | null;
    user_id: string | null;
    created_at: string | null;
    engine_version: string | null;
    input_sha256: string | null;
    execution_status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "TIMEOUT" | null;
  } | null;
  data: T;
  error: null | {
    code: string;
    message: string;
    details?: unknown;
  };
};

type SummaryData = {
  headline: string | null;
  delta_pnl: number | null;
  cost_of_bias: number | null;
  bias_rates: Record<string, number>;
  badge_counts: Record<string, number>;
};

type SeriesPoint = {
  timestamp: string;
  actual_equity: number;
  simulated_equity: number;
  policy_replay_equity: number;
};

type SeriesMarker = {
  timestamp: string;
  asset: string;
  trade_grade: string;
  blocked_reason: string;
  reason_label: string;
  impact_abs: number | null;
  intervention_type: string;
};

type SeriesData = {
  points: SeriesPoint[];
  markers: SeriesMarker[];
  metrics: Record<string, unknown>;
  total_points: number;
  returned_points: number;
};

type MomentsData = {
  moments: Array<Record<string, unknown>>;
};

type TradeData = {
  trade: Record<string, unknown>;
};

export class TemperApiClient {
  constructor(private readonly baseUrl: string) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, init);
    const body = await res.json();
    if (!res.ok) {
      throw new Error(`${res.status} ${JSON.stringify(body)}`);
    }
    return body as T;
  }

  async createJob(file: File, userId: string, runAsync = true): Promise<ApiEnvelope<Record<string, unknown>>> {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("user_id", userId);
    fd.append("run_async", String(runAsync));
    return this.request("/jobs", { method: "POST", body: fd });
  }

  async getJob(jobId: string): Promise<ApiEnvelope<Record<string, unknown>>> {
    return this.request(`/jobs/${jobId}`);
  }

  async getSummary(jobId: string): Promise<ApiEnvelope<SummaryData>> {
    return this.request(`/jobs/${jobId}/summary`);
  }

  async getSeries(jobId: string, maxPoints = 2000): Promise<ApiEnvelope<SeriesData>> {
    return this.request(`/jobs/${jobId}/counterfactual/series?max_points=${maxPoints}`);
  }

  async getMoments(jobId: string): Promise<ApiEnvelope<MomentsData>> {
    return this.request(`/jobs/${jobId}/moments`);
  }

  async getTrade(jobId: string, tradeId: number): Promise<ApiEnvelope<TradeData>> {
    return this.request(`/jobs/${jobId}/trade/${tradeId}`);
  }

  async generateCoach(jobId: string, force = false): Promise<ApiEnvelope<Record<string, unknown>>> {
    return this.request(`/jobs/${jobId}/coach?force=${String(force)}`, { method: "POST" });
  }

  async getCoach(jobId: string): Promise<ApiEnvelope<Record<string, unknown>>> {
    return this.request(`/jobs/${jobId}/coach`);
  }

  async getElo(jobId: string): Promise<ApiEnvelope<Record<string, unknown>>> {
    return this.request(`/jobs/${jobId}/elo`);
  }

  async getHistory(userId: string, limit = 10): Promise<ApiEnvelope<{ jobs: Array<Record<string, unknown>> }>> {
    return this.request(`/users/${userId}/jobs?limit=${limit}`);
  }
}
