# Temper Frontend → Backend Integration Guide

**Version:** 1.0  
**Status:** Production-ready integration roadmap  
**Audience:** Frontend engineers migrating from localStorage to Temper backend API

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture Comparison](#2-architecture-comparison)
3. [API Client Setup](#3-api-client-setup)
4. [Authentication Flow](#4-authentication-flow)
5. [Data Flow: Upload → Analysis → Display](#5-data-flow-upload--analysis--display)
6. [Page-by-Page Integration](#6-page-by-page-integration)
7. [Type System Alignment](#7-type-system-alignment)
8. [Error Handling Patterns](#8-error-handling-patterns)
9. [Real-Time Updates & Polling](#9-real-time-updates--polling)
10. [Migration Checklist](#10-migration-checklist)

---

## 1. Overview

### Current State (localStorage)
- **Client-side only**: CSV upload → parse → analyze → store in `localStorage`
- **Persistence keys**: `temper_current_session` (Trade[]), `temper_journal_entries` (JournalEntry[])
- **No backend**: All analysis runs in browser using `lib/biasDetector.ts` adapter
- **11 pages** using localStorage: upload, dashboard, analyze, explorer, journal, sessions, settings, etc.

### Target State (Backend API)
- **Job-based architecture**: CSV upload creates async job → poll status → fetch results
- **Server-side analysis**: Backend runs deterministic engine, frontend displays results
- **Persistent storage**: PostgreSQL/MongoDB stores sessions, journals, ELO state per user
- **API endpoints**: RESTful JSON API documented in `backend/API_CONTRACT.md`
- **Authentication**: OAuth login → JWT tokens → user-scoped data

### Why Migrate?
1. **Scalability**: Handle large CSVs (10K+ trades) without blocking UI
2. **Persistence**: User data survives browser refresh, accessible across devices
3. **Advanced features**: Coach AI, counterfactual pagination, job history
4. **Security**: User isolation, audit trails, rate limiting

---

## 2. Architecture Comparison

### 2.1 Current Flow (localStorage)

```
┌─────────────┐
│   Upload    │
│   Page      │
└──────┬──────┘
       │ CSV file
       ▼
┌─────────────────────────┐
│  lib/biasDetector.ts    │
│  ┌──────────────────┐   │
│  │ parseCsv()       │   │
│  │ enrichTrades()   │   │
│  │ analyzeSession() │   │
│  └──────────────────┘   │
└──────┬──────────────────┘
       │ TemperReport
       ▼
┌─────────────────────────┐
│  localStorage           │
│  - temper_current_      │
│    session: Trade[]     │
│  - temper_journal_      │
│    entries: Entry[]     │
└──────┬──────────────────┘
       │
       ▼
┌─────────────────────────┐
│  Dashboard, Analyze,    │
│  Explorer, Journal, etc.│
└─────────────────────────┘
```

### 2.2 Target Flow (Backend API)

```
┌─────────────┐
│   Upload    │
│   Page      │
└──────┬──────┘
       │ multipart/form-data
       ▼
┌───────────────────────────┐
│  POST /jobs               │
│  ┌─────────────────────┐  │
│  │ Backend Engine      │  │
│  │ - parseCsv()        │  │
│  │ - enrichTrades()    │  │
│  │ - analyzeSession()  │  │
│  │ - writePersistence()│  │
│  └─────────────────────┘  │
└──────┬────────────────────┘
       │ 202 Accepted
       │ { job_id, status_url }
       ▼
┌───────────────────────────┐
│  Poll: GET /jobs/{job_id} │
│  Status: PENDING →        │
│           RUNNING →       │
│           COMPLETED       │
└──────┬────────────────────┘
       │ execution_status: COMPLETED
       ▼
┌──────────────────────────────────┐
│  GET /jobs/{job_id}/summary      │
│  GET /jobs/{job_id}/review       │
│  GET /jobs/{job_id}/counterfactual│
│  GET /jobs/{job_id}/coach        │
└──────┬───────────────────────────┘
       │ TemperReport data
       ▼
┌─────────────────────────┐
│  React State (Zustand)  │
│  - currentSession       │
│  - journalEntries       │
│  - eloState             │
└──────┬──────────────────┘
       │
       ▼
┌─────────────────────────┐
│  Dashboard, Analyze,    │
│  Explorer, Journal, etc.│
└─────────────────────────┘
```

### 2.3 Key Differences

| Aspect | localStorage | Backend API |
|--------|-------------|-------------|
| **Processing** | Client-side sync | Server-side async |
| **State** | Session-scoped | User-scoped + persistent |
| **Large files** | Blocks UI | Non-blocking |
| **Multi-device** | ❌ No sync | ✅ Cloud sync |
| **Job history** | ❌ Lost on refresh | ✅ Persistent |
| **Coach AI** | ❌ Client-only mock | ✅ Vertex AI Gemini |
| **Pagination** | ❌ All in memory | ✅ Server-side cursor |

---

## 3. API Client Setup

### 3.1 Environment Configuration

Create `frontend/.env.local`:

```bash
# Backend API
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
NEXT_PUBLIC_API_TIMEOUT=30000

# Uploadthing (for CSV hosting)
NEXT_PUBLIC_UPLOADTHING_APP_ID=your_app_id
UPLOADTHING_SECRET=your_secret

# Auth (Clerk or similar)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

### 3.2 API Client (`lib/api/client.ts`)

```typescript
// lib/api/client.ts
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

export interface ApiResponse<T> {
  ok: boolean;
  job: {
    job_id: string | null;
    user_id: string | null;
    created_at: string | null;
    engine_version: string | null;
    input_sha256: string | null;
    execution_status: ExecutionStatus | null;
  };
  data: T | null;
  error: ApiError | null;
}

export type ExecutionStatus = 
  | "PENDING" 
  | "RUNNING" 
  | "COMPLETED" 
  | "FAILED" 
  | "TIMEOUT";

export interface ApiError {
  code: string;
  message: string;
  details: Record<string, unknown>;
}

export class TemperApiClient {
  private baseUrl: string;
  private getAuthToken: () => Promise<string | null>;

  constructor(baseUrl: string, getAuthToken: () => Promise<string | null>) {
    this.baseUrl = baseUrl;
    this.getAuthToken = getAuthToken;
  }

  private async request<T>(
    endpoint: string,
    options?: RequestInit
  ): Promise<ApiResponse<T>> {
    const token = await this.getAuthToken();
    const headers = new Headers(options?.headers);
    
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers,
    });

    return response.json();
  }

  // Job creation
  async createJob(params: {
    file: File;
    userId: string;
    dailyMaxLoss?: number;
    kRepeat?: number;
    runAsync?: boolean;
  }): Promise<ApiResponse<{ status_url: string; summary_url: string }>> {
    const formData = new FormData();
    formData.append("file", params.file);
    formData.append("user_id", params.userId);
    if (params.dailyMaxLoss) formData.append("daily_max_loss", String(params.dailyMaxLoss));
    if (params.kRepeat) formData.append("k_repeat", String(params.kRepeat));
    if (params.runAsync !== undefined) formData.append("run_async", String(params.runAsync));

    return this.request("/jobs", {
      method: "POST",
      body: formData,
    });
  }

  // Job status polling
  async getJobStatus(jobId: string): Promise<ApiResponse<JobStatusData>> {
    return this.request(`/jobs/${jobId}`);
  }

  // Analysis results
  async getSummary(jobId: string): Promise<ApiResponse<SummaryData>> {
    return this.request(`/jobs/${jobId}/summary`);
  }

  async getReview(jobId: string): Promise<ApiResponse<{ review: TemperReport }>> {
    return this.request(`/jobs/${jobId}/review`);
  }

  async getCounterfactual(params: {
    jobId: string;
    offset?: number;
    limit?: number;
  }): Promise<ApiResponse<CounterfactualData>> {
    const query = new URLSearchParams({
      offset: String(params.offset || 0),
      limit: String(params.limit || 500),
    });
    return this.request(`/jobs/${jobId}/counterfactual?${query}`);
  }

  // Coach AI
  async generateCoach(jobId: string, force = false): Promise<ApiResponse<void>> {
    return this.request(`/jobs/${jobId}/coach?force=${force}`, {
      method: "POST",
    });
  }

  async getCoach(jobId: string): Promise<ApiResponse<{ coach: CoachResponse }>> {
    return this.request(`/jobs/${jobId}/coach`);
  }

  // User job history
  async getUserJobs(userId: string, limit = 20): Promise<ApiResponse<JobsListData>> {
    return this.request(`/users/${userId}/jobs?limit=${limit}`);
  }

  // Single trade inspector
  async getTrade(jobId: string, tradeId: number): Promise<ApiResponse<{ trade: TradeDetail }>> {
    return this.request(`/jobs/${jobId}/trade/${tradeId}`);
  }
}

// Singleton instance
let apiClient: TemperApiClient | null = null;

export function getApiClient(getAuthToken: () => Promise<string | null>): TemperApiClient {
  if (!apiClient) {
    apiClient = new TemperApiClient(API_BASE, getAuthToken);
  }
  return apiClient;
}
```

### 3.3 Response Type Interfaces

```typescript
// lib/api/types.ts
import { TemperReport, CoachResponse } from "@/lib/types";

export interface JobStatusData {
  status: ExecutionStatus;
  finished_at: string | null;
  outcome: "WINNER" | "DRAW" | "LOSER" | null;
  delta_pnl: number | null;
  cost_of_bias: number | null;
  error_type: string | null;
  error_message: string | null;
  artifacts: {
    summary_url: string;
    review_url: string;
    counterfactual_url: string;
  };
}

export interface SummaryData {
  headline: "WINNER" | "DRAW" | "LOSER";
  scoreboard: {
    delta_pnl: number;
    cost_of_bias: number;
    blocked_bias_count: number;
    blocked_risk_count: number;
  };
  bias_rates: {
    revenge_rate: number;
    overtrading_rate: number;
    loss_aversion_rate: number;
    any_bias_rate: number;
  };
  badge_counts: Record<string, number>;
  top_moments_preview: Array<{
    timestamp: string;
    asset: string;
    label: string;
    impact: number;
  }>;
  error_type: string | null;
  error_message: string | null;
}

export interface CounterfactualData {
  offset: number;
  limit: number;
  total_rows: number;
  columns: string[];
  rows: CounterfactualRow[];
}

export interface CounterfactualRow {
  timestamp: string;
  asset: string;
  pnl: number;
  is_revenge: boolean;
  is_overtrading: boolean;
  is_loss_aversion: boolean;
  is_blocked_bias: boolean;
  is_blocked_risk: boolean;
  blocked_reason: "NONE" | "BIAS" | "DAILY_MAX_LOSS";
  simulated_pnl: number;
  simulated_daily_pnl: number;
  simulated_equity: number;
  checkmated_day: boolean;
  trade_grade: string;
  special_tags: string;
}

export interface JobsListData {
  count: number;
  limit: number;
  jobs: Array<{
    job_id: string;
    user_id: string;
    created_at: string;
    execution_status: ExecutionStatus;
    outcome: "WINNER" | "DRAW" | "LOSER" | null;
    delta_pnl: number | null;
    cost_of_bias: number | null;
  }>;
}

export interface TradeDetail {
  // Full trade object with counterfactual + decision trace
  [key: string]: unknown;
}
```

---

## 4. Authentication Flow

### 4.1 Recommended: Clerk + JWT

```typescript
// app/providers.tsx
"use client";
import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { createContext, useContext } from "react";
import { getApiClient, TemperApiClient } from "@/lib/api/client";

const ApiContext = createContext<TemperApiClient | null>(null);

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <ApiProvider>{children}</ApiProvider>
    </ClerkProvider>
  );
}

function ApiProvider({ children }: { children: React.ReactNode }) {
  const { getToken } = useAuth();
  
  const client = getApiClient(async () => {
    return await getToken();
  });

  return (
    <ApiContext.Provider value={client}>
      {children}
    </ApiContext.Provider>
  );
}

export function useApi() {
  const client = useContext(ApiContext);
  if (!client) throw new Error("useApi must be used within ApiProvider");
  return client;
}
```

### 4.2 Login Page Integration

**Current** ([login/page.tsx](login/page.tsx)):
```typescript
// Mock authentication - no backend
const handleLogin = () => router.push("/dashboard");
```

**Target**:
```typescript
// app/login/page.tsx
"use client";
import { SignIn } from "@clerk/nextjs";

export default function LoginPage() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <SignIn 
        appearance={{
          elements: {
            rootBox: "mx-auto",
            card: "bg-black border border-zinc-800",
          }
        }}
        redirectUrl="/dashboard"
      />
    </div>
  );
}
```

### 4.3 Protected Routes

```typescript
// middleware.ts
import { authMiddleware } from "@clerk/nextjs";

export default authMiddleware({
  publicRoutes: ["/", "/login"],
});

export const config = {
  matcher: ["/((?!.+\\.[\\w]+$|_next).*)", "/", "/(api|trpc)(.*)"],
};
```

---

## 5. Data Flow: Upload → Analysis → Display

### 5.1 Upload Flow (CSV → Job Creation)

**Current** ([upload/page.tsx](upload/page.tsx) lines 115, 196):
```typescript
// After CSV parsing
localStorage.setItem("temper_current_session", JSON.stringify(trades));
router.push("/dashboard");
```

**Target**:
```typescript
// app/upload/page.tsx
"use client";
import { useApi } from "@/app/providers";
import { useUser } from "@clerk/nextjs";

export default function UploadPage() {
  const api = useApi();
  const { user } = useUser();
  const [uploading, setUploading] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);

  async function handleCsvUpload(file: File) {
    if (!user) return;
    
    setUploading(true);
    
    const response = await api.createJob({
      file,
      userId: user.id,
      runAsync: true, // Non-blocking
    });

    if (response.ok && response.job?.job_id) {
      setJobId(response.job.job_id);
      // Redirect to status page that polls job
      router.push(`/jobs/${response.job.job_id}/status`);
    } else {
      // Handle error
      toast.error(response.error?.message || "Upload failed");
    }
    
    setUploading(false);
  }

  return (
    <div>
      <CsvUploader onUpload={handleCsvUpload} disabled={uploading} />
      {uploading && <StatusMessage>Uploading and analyzing...</StatusMessage>}
    </div>
  );
}
```

### 5.2 Job Status Polling

Create new page: `app/jobs/[jobId]/status/page.tsx`

```typescript
"use client";
import { useApi } from "@/app/providers";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function JobStatusPage() {
  const api = useApi();
  const params = useParams();
  const router = useRouter();
  const jobId = params.jobId as string;
  
  const [status, setStatus] = useState<ExecutionStatus>("PENDING");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let intervalId: NodeJS.Timeout;

    async function pollStatus() {
      const response = await api.getJobStatus(jobId);
      
      if (!response.ok) {
        setError(response.error?.message || "Failed to fetch status");
        return;
      }

      const newStatus = response.job.execution_status;
      setStatus(newStatus || "PENDING");

      // Terminal states → redirect
      if (newStatus === "COMPLETED") {
        clearInterval(intervalId);
        router.push(`/dashboard?job_id=${jobId}`);
      } else if (newStatus === "FAILED" || newStatus === "TIMEOUT") {
        clearInterval(intervalId);
        setError(response.data?.error_message || "Job failed");
      }
    }

    // Poll every 2 seconds
    pollStatus();
    intervalId = setInterval(pollStatus, 2000);

    return () => clearInterval(intervalId);
  }, [api, jobId, router]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-4">
          {status === "PENDING" && "Queued..."}
          {status === "RUNNING" && "Analyzing trades..."}
          {status === "COMPLETED" && "Complete! Redirecting..."}
          {(status === "FAILED" || status === "TIMEOUT") && "Analysis failed"}
        </h1>
        {error && <p className="text-red-400">{error}</p>}
        {!error && <Spinner />}
      </div>
    </div>
  );
}
```

### 5.3 Dashboard: Fetch Results

**Current** ([dashboard/page.tsx](dashboard/page.tsx) line 113):
```typescript
const session = localStorage.getItem("temper_current_session");
const trades = session ? JSON.parse(session) : [];
const report = analyzeTrades(trades); // Client-side
```

**Target**:
```typescript
"use client";
import { useApi } from "@/app/providers";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { TemperReport } from "@/lib/types";

export default function DashboardPage() {
  const api = useApi();
  const searchParams = useSearchParams();
  const jobId = searchParams.get("job_id"); // From redirect after upload
  
  const [report, setReport] = useState<TemperReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchReport() {
      if (!jobId) {
        setLoading(false);
        return;
      }

      const response = await api.getReview(jobId);
      
      if (response.ok && response.data) {
        setReport(response.data.review);
      }
      
      setLoading(false);
    }

    fetchReport();
  }, [api, jobId]);

  if (loading) return <LoadingSpinner />;
  if (!report) return <EmptyState>No session loaded. Upload CSV to start.</EmptyState>;

  return (
    <div>
      <TemperScoreDisplay score={report.temperScore} />
      <BiasBreakdown biasScores={report.biasScores} />
      {/* ... rest of dashboard */}
    </div>
  );
}
```

---

## 6. Page-by-Page Integration

### 6.1 Upload Page (`app/upload/page.tsx`)

**Changes:**
- Replace `localStorage.setItem` → `api.createJob()`
- Add file upload progress UI
- Redirect to `/jobs/{job_id}/status` instead of `/dashboard`
- Handle API errors (file too large, invalid CSV, etc.)

**Key localStorage removal:**
```diff
- localStorage.setItem("temper_current_session", JSON.stringify(trades));
+ const response = await api.createJob({ file, userId: user.id });
+ router.push(`/jobs/${response.job.job_id}/status`);
```

### 6.2 Dashboard Page (`app/dashboard/page.tsx`)

**Changes:**
- Accept `?job_id=` query param
- Fetch `GET /jobs/{job_id}/review` on mount
- Store report in React state (or Zustand store)
- Remove all `localStorage.getItem` calls

**Key localStorage removal:**
```diff
- const session = localStorage.getItem("temper_current_session");
- const trades = session ? JSON.parse(session) : [];
+ const jobId = searchParams.get("job_id");
+ const { data } = await api.getReview(jobId);
+ const report = data.review;
```

### 6.3 Analyze Page (`app/analyze/page.tsx`)

**Changes:**
- Same as Dashboard: fetch report by `job_id`
- Display session analytics from `report.session`
- Show counterfactual comparison from `report.disciplinedReplay`

**Key localStorage removal:**
```diff
- const session = localStorage.getItem("temper_current_session");
+ const { data } = await api.getReview(jobId);
```

### 6.4 Explorer Page (`app/explorer/page.tsx`)

**Changes:**
- **Paginated counterfactual fetching** instead of loading all trades in memory
- Use `GET /jobs/{job_id}/counterfactual?offset=0&limit=500`
- Implement infinite scroll or cursor-based pagination
- Filter/search on backend (future enhancement)

**Current** (line 81):
```typescript
const session = localStorage.getItem("temper_current_session");
const trades = JSON.parse(session);
// Render all 10K trades in 3D scene (performance issue)
```

**Target**:
```typescript
const [trades, setTrades] = useState<Trade[]>([]);
const [offset, setOffset] = useState(0);
const LIMIT = 500;

async function loadMoreTrades() {
  const response = await api.getCounterfactual({
    jobId,
    offset,
    limit: LIMIT,
  });
  
  if (response.ok && response.data) {
    // Convert counterfactual rows to Trade objects
    const newTrades = response.data.rows.map(rowToTrade);
    setTrades(prev => [...prev, ...newTrades]);
    setOffset(prev => prev + LIMIT);
  }
}

useEffect(() => {
  loadMoreTrades(); // Initial load
}, []);

// Infinite scroll trigger
<InfiniteScroll onLoadMore={loadMoreTrades} hasMore={trades.length < totalRows} />
```

### 6.5 Journal Page (`app/journal/page.tsx`)

**Changes:**
- Store journal entries in **backend database** (new endpoint needed)
- Proposal: `POST /users/{user_id}/journal` → save entry
- Proposal: `GET /users/{user_id}/journal?limit=50` → load entries
- Link journal entries to specific `job_id` for context

**Current** (lines 78, 98, 152):
```typescript
const entries = JSON.parse(localStorage.getItem("temper_journal_entries") || "[]");
// ...
localStorage.setItem("temper_journal_entries", JSON.stringify(updated));
```

**Target**:
```typescript
// New API methods in client.ts
async saveJournalEntry(userId: string, entry: JournalEntry): Promise<ApiResponse<void>> {
  return this.request(`/users/${userId}/journal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  });
}

async getJournalEntries(userId: string, limit = 50): Promise<ApiResponse<{ entries: JournalEntry[] }>> {
  return this.request(`/users/${userId}/journal?limit=${limit}`);
}

// In component
const { data } = await api.getJournalEntries(user.id);
setEntries(data.entries);
```

### 6.6 Sessions Page (`app/sessions/page.tsx`)

**Changes:**
- Display job history from `GET /users/{user_id}/jobs?limit=20`
- Each row shows: date, outcome (WINNER/DRAW/LOSER), delta_pnl, cost_of_bias
- Click → navigate to `/dashboard?job_id={job_id}`

**Target**:
```typescript
const [jobs, setJobs] = useState<JobsListData["jobs"]>([]);

useEffect(() => {
  async function fetchJobs() {
    const response = await api.getUserJobs(user.id, 20);
    if (response.ok && response.data) {
      setJobs(response.data.jobs);
    }
  }
  fetchJobs();
}, []);

return (
  <table>
    {jobs.map(job => (
      <tr key={job.job_id} onClick={() => router.push(`/dashboard?job_id=${job.job_id}`)}>
        <td>{new Date(job.created_at).toLocaleDateString()}</td>
        <td>{job.outcome}</td>
        <td>${job.delta_pnl?.toFixed(2)}</td>
        <td>${job.cost_of_bias?.toFixed(2)}</td>
      </tr>
    ))}
  </table>
);
```

### 6.7 Settings Page (`app/settings/page.tsx`)

**Changes:**
- "Clear Data" button → backend API call to delete user sessions
- Proposal: `DELETE /users/{user_id}/sessions` → wipe all jobs
- Risk settings → store in user profile (new endpoint)

**Current** (lines 47-48):
```typescript
localStorage.removeItem("temper_current_session");
localStorage.removeItem("temper_journal_entries");
```

**Target**:
```typescript
async function handleClearData() {
  if (!confirm("Delete all sessions? This cannot be undone.")) return;
  
  const response = await api.deleteUserSessions(user.id);
  
  if (response.ok) {
    toast.success("All sessions deleted");
    router.push("/upload");
  }
}
```

---

## 7. Type System Alignment

### 7.1 Frontend Types → Backend Schemas

| Frontend Type | Backend Endpoint | Response Field |
|--------------|------------------|----------------|
| `TemperReport` | `GET /jobs/{job_id}/review` | `data.review` |
| `Trade` | `GET /jobs/{job_id}/counterfactual` | `data.rows[i]` (converted) |
| `Session` | `GET /jobs/{job_id}/review` | `data.review.session` |
| `BiasScores` | `GET /jobs/{job_id}/review` | `data.review.biasScores` |
| `CoachResponse` | `GET /jobs/{job_id}/coach` | `data.coach` |
| `DecisionEvent` | `GET /jobs/{job_id}/review` | `data.review.decisions[i]` |

### 7.2 Counterfactual Row → Trade Conversion

Backend returns flat rows; frontend expects `Trade` objects:

```typescript
// lib/api/converters.ts
import type { Trade } from "@/lib/types";
import type { CounterfactualRow } from "@/lib/api/types";

export function counterfactualRowToTrade(row: CounterfactualRow, index: number): Trade {
  return {
    id: `trade-${index}`,
    index,
    timestamp: row.timestamp,
    timestampMs: new Date(row.timestamp).getTime(),
    symbol: row.asset,
    side: inferSideFromRow(row), // Helper function
    quantity: row.quantity || 0,
    price: row.price || 0,
    pnl: row.pnl,
    runningPnl: row.simulated_equity,
    runningTradeCount: index + 1,
    drawdownFromPeak: 0, // Compute from equity curve
    peakPnlAtTrade: 0,
    timeSinceLastTradeMs: null,
    sizeRelativeToBaseline: 1.0,
    isWin: row.pnl > 0,
    rMultiple: null,
    tags: row.special_tags ? [row.special_tags] : [],
    // Bias flags from counterfactual
    isRevengeTrade: row.is_revenge,
    isOvertrading: row.is_overtrading,
    isLossAversion: row.is_loss_aversion,
    isBlocked: row.is_blocked_bias || row.is_blocked_risk,
    decisionLabel: row.trade_grade as DecisionLabel,
  };
}
```

### 7.3 Type-Safe API Hooks

```typescript
// lib/hooks/useJob.ts
import { useEffect, useState } from "react";
import { useApi } from "@/app/providers";
import type { TemperReport } from "@/lib/types";

export function useJobReport(jobId: string | null) {
  const api = useApi();
  const [report, setReport] = useState<TemperReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;

    async function fetch() {
      setLoading(true);
      setError(null);

      const response = await api.getReview(jobId);

      if (response.ok && response.data) {
        setReport(response.data.review);
      } else {
        setError(response.error?.message || "Failed to load report");
      }

      setLoading(false);
    }

    fetch();
  }, [api, jobId]);

  return { report, loading, error };
}

// Usage in components
const { report, loading, error } = useJobReport(jobId);
if (loading) return <Spinner />;
if (error) return <ErrorMessage>{error}</ErrorMessage>;
if (!report) return <EmptyState />;
```

---

## 8. Error Handling Patterns

### 8.1 API Error Codes

From `backend/API_CONTRACT.md`, common error codes:

| Code | HTTP Status | Meaning | UI Action |
|------|-------------|---------|-----------|
| `INVALID_REQUEST` | 400 | Bad input | Show validation message |
| `JOB_NOT_FOUND` | 404 | Invalid job_id | Redirect to upload |
| `JOB_NOT_READY` | 409 | Job still running | Show spinner, retry |
| `COACH_GENERATION_FAILED` | 502 | AI service error | Show fallback message |
| `INVALID_LIMIT` | 400 | Pagination out of range | Reset to default |

### 8.2 Error Handling Component

```typescript
// components/ErrorBoundary.tsx
export function ApiErrorBoundary({ error }: { error: ApiError | null }) {
  if (!error) return null;

  const getMessage = () => {
    switch (error.code) {
      case "JOB_NOT_FOUND":
        return "Session not found. It may have been deleted.";
      case "JOB_NOT_READY":
        return "Analysis in progress. Please wait...";
      case "INVALID_REQUEST":
        return `Invalid request: ${error.message}`;
      default:
        return error.message;
    }
  };

  return (
    <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4">
      <p className="text-red-400">{getMessage()}</p>
      {error.details && (
        <pre className="mt-2 text-xs text-red-300/60">
          {JSON.stringify(error.details, null, 2)}
        </pre>
      )}
    </div>
  );
}
```

### 8.3 Retry Logic for Transient Failures

```typescript
// lib/api/retry.ts
export async function retryRequest<T>(
  fn: () => Promise<ApiResponse<T>>,
  maxRetries = 3,
  delayMs = 1000
): Promise<ApiResponse<T>> {
  let lastError: ApiResponse<T> | null = null;

  for (let i = 0; i < maxRetries; i++) {
    const response = await fn();

    if (response.ok) return response;

    // Retry on 5xx errors or specific codes
    if (
      response.error?.code === "TIMEOUT" ||
      response.error?.code === "INTERNAL_ERROR"
    ) {
      lastError = response;
      await new Promise(resolve => setTimeout(resolve, delayMs * (i + 1)));
      continue;
    }

    // Non-retryable error
    return response;
  }

  return lastError!;
}

// Usage
const response = await retryRequest(() => api.getJobStatus(jobId), 3, 2000);
```

---

## 9. Real-Time Updates & Polling

### 9.1 Polling Strategy (Current API v1)

Since the backend API v1 **does not include WebSocket**, use **short polling**:

```typescript
// lib/hooks/useJobPoller.ts
import { useEffect, useState } from "react";
import { useApi } from "@/app/providers";
import type { ExecutionStatus } from "@/lib/api/types";

export function useJobPoller(
  jobId: string | null,
  onComplete: () => void,
  intervalMs = 2000
) {
  const api = useApi();
  const [status, setStatus] = useState<ExecutionStatus | null>(null);

  useEffect(() => {
    if (!jobId) return;

    let intervalId: NodeJS.Timeout;

    async function poll() {
      const response = await api.getJobStatus(jobId);

      if (response.ok && response.job.execution_status) {
        setStatus(response.job.execution_status);

        if (response.job.execution_status === "COMPLETED") {
          clearInterval(intervalId);
          onComplete();
        }
      }
    }

    poll(); // Initial poll
    intervalId = setInterval(poll, intervalMs);

    return () => clearInterval(intervalId);
  }, [api, jobId, onComplete, intervalMs]);

  return status;
}

// Usage
const status = useJobPoller(jobId, () => router.push("/dashboard"));
```

### 9.2 Exponential Backoff (for long jobs)

```typescript
export function useJobPollerWithBackoff(jobId: string | null) {
  const [intervalMs, setIntervalMs] = useState(1000);

  useEffect(() => {
    // Increase interval: 1s → 2s → 4s → 8s (max)
    const timer = setTimeout(() => {
      setIntervalMs(prev => Math.min(prev * 2, 8000));
    }, 10000); // After 10 seconds of polling

    return () => clearTimeout(timer);
  }, []);

  return useJobPoller(jobId, () => {}, intervalMs);
}
```

### 9.3 Future: WebSocket Upgrade (optional v2)

If backend adds WebSocket support:

```typescript
// lib/api/websocket.ts (future)
export function useJobWebSocket(jobId: string) {
  const [status, setStatus] = useState<ExecutionStatus>("PENDING");

  useEffect(() => {
    const ws = new WebSocket(`ws://127.0.0.1:8000/jobs/${jobId}/ws`);

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setStatus(data.execution_status);
    };

    return () => ws.close();
  }, [jobId]);

  return status;
}
```

---

## 10. Migration Checklist

### 10.1 Phase 1: API Client Setup

- [ ] Install dependencies: `pnpm add @clerk/nextjs zustand`
- [ ] Create `lib/api/client.ts` with `TemperApiClient` class
- [ ] Add `lib/api/types.ts` for response interfaces
- [ ] Set up `.env.local` with `NEXT_PUBLIC_API_BASE_URL`
- [ ] Create `app/providers.tsx` with Clerk + API context
- [ ] Wrap `app/layout.tsx` with `<Providers>`

### 10.2 Phase 2: Authentication

- [ ] Create Clerk account, get API keys
- [ ] Add Clerk components to [login/page.tsx](login/page.tsx)
- [ ] Create `middleware.ts` for route protection
- [ ] Test login flow → dashboard redirect
- [ ] Replace all `user_id` hardcodes with `user.id` from Clerk

### 10.3 Phase 3: Upload Flow

- [ ] Update [upload/page.tsx](upload/page.tsx): replace `localStorage.setItem` with `api.createJob()`
- [ ] Create `app/jobs/[jobId]/status/page.tsx` for status polling
- [ ] Add loading spinner + progress UI
- [ ] Handle errors (file too large, invalid CSV)
- [ ] Test: upload CSV → poll status → redirect to dashboard

### 10.4 Phase 4: Dashboard & Analysis

- [ ] Update [dashboard/page.tsx](dashboard/page.tsx): fetch report from `GET /jobs/{job_id}/review`
- [ ] Remove all `localStorage.getItem("temper_current_session")`
- [ ] Add error handling for missing `job_id` query param
- [ ] Update [analyze/page.tsx](analyze/page.tsx) with same pattern
- [ ] Test: click job from sessions list → see full dashboard

### 10.5 Phase 5: Explorer (Paginated Trades)

- [ ] Update [explorer/page.tsx](explorer/page.tsx): fetch counterfactual rows from API
- [ ] Implement pagination: `offset` + `limit` query params
- [ ] Convert `CounterfactualRow[]` → `Trade[]` using converter
- [ ] Add infinite scroll or "Load More" button
- [ ] Optimize 3D scene rendering for windowing (only visible trades)

### 10.6 Phase 6: Journal Persistence

- [ ] Add backend endpoints: `POST /users/{user_id}/journal`, `GET /users/{user_id}/journal`
- [ ] Update [journal/page.tsx](journal/page.tsx): replace localStorage with API calls
- [ ] Link journal entries to `job_id` for context
- [ ] Test: save entry → refresh page → entry persists

### 10.7 Phase 7: Sessions History

- [ ] Create [sessions/page.tsx](sessions/page.tsx) using `GET /users/{user_id}/jobs`
- [ ] Display table: date, outcome, P&L, cost of bias
- [ ] Add click handler → navigate to `/dashboard?job_id={job_id}`
- [ ] Implement sorting by date (descending)

### 10.8 Phase 8: Settings & Cleanup

- [ ] Update [settings/page.tsx](settings/page.tsx): replace localStorage clear with API delete
- [ ] Add backend endpoint: `DELETE /users/{user_id}/sessions`
- [ ] Remove all remaining `localStorage` references
- [ ] Test: clear data → refresh → no cached state

### 10.9 Phase 9: Coach AI Integration

- [ ] Add "Generate Coach" button to dashboard
- [ ] Call `POST /jobs/{job_id}/coach` on button click
- [ ] Poll `GET /jobs/{job_id}/coach` for result
- [ ] Display coach response in modal or dedicated section
- [ ] Handle errors: `COACH_NOT_FOUND`, `COACH_GENERATION_FAILED`

### 10.10 Phase 10: Testing & Polish

- [ ] End-to-end test: upload → poll → dashboard → explorer → journal → sessions
- [ ] Error scenario tests: invalid file, job not found, coach failure
- [ ] Performance test: 10K trade CSV, pagination speed
- [ ] Multi-device sync test: upload on desktop → view on mobile
- [ ] Final localStorage audit: `grep -r "localStorage" app/` should return 0 results

---

## Additional Resources

- **Backend API Contract**: `backend/API_CONTRACT.md` (full reference)
- **Frontend Type Reference**: [lib/types.ts](lib/types.ts)
- **Demo Guide**: `DEMO_GUIDE.md` (feature inventory + rubric alignment)
- **Clerk Docs**: https://clerk.com/docs/quickstarts/nextjs
- **Next.js App Router**: https://nextjs.org/docs/app

---

**End of BACKEND_INTEGRATION.md**  
*Ready for production hookup. No trade left unconnected.* 🎯
