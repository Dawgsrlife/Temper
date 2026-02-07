# Temper Backend API Contract (v1)

Status: Draft for implementation  
Scope: frontend-ready API surface only (engine remains unchanged)  
Stability rule: required keys are never omitted; unknown values are `null`.

## 1. Global Contract Rules

### 1.1 Content Types
- Request bodies:
  - `POST /jobs`: `multipart/form-data`
  - `GET` endpoints: no request body
- Response bodies:
  - JSON endpoints: `application/json`
  - `GET /jobs/{job_id}/counterfactual`: `application/json` (paginated rows)

### 1.2 Execution Status Enum
`execution_status` is always one of:
- `PENDING`
- `RUNNING`
- `COMPLETED`
- `FAILED`
- `TIMEOUT`

### 1.3 Correlation Fields (always present in JSON responses)
Every JSON response contains a `job` object with:
- `job_id: string | null`
- `user_id: string | null`
- `created_at: string | null` (ISO-8601 UTC)
- `engine_version: string | null`
- `input_sha256: string | null`
- `execution_status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "TIMEOUT" | null`

If the endpoint is not job-specific, fields can be `null` where unknown.

### 1.4 Standard Response Envelope
Success:
```json
{
  "ok": true,
  "job": {
    "job_id": "b4af58b2-8a61-44b2-8d2f-6fb4838f6d2f",
    "user_id": "user_123",
    "created_at": "2026-02-07T18:30:00+00:00",
    "engine_version": "a1b2c3d",
    "input_sha256": "f6e1...",
    "execution_status": "RUNNING"
  },
  "data": {},
  "error": null
}
```

Error:
```json
{
  "ok": false,
  "job": {
    "job_id": "b4af58b2-8a61-44b2-8d2f-6fb4838f6d2f",
    "user_id": "user_123",
    "created_at": "2026-02-07T18:30:00+00:00",
    "engine_version": "a1b2c3d",
    "input_sha256": "f6e1...",
    "execution_status": "FAILED"
  },
  "data": null,
  "error": {
    "code": "INVALID_INPUT",
    "message": "CSV missing required timestamp column.",
    "details": {
      "field": "timestamp"
    }
  }
}
```

### 1.5 State Transitions
Valid lifecycle:
- `PENDING -> RUNNING -> COMPLETED`
- `PENDING -> RUNNING -> FAILED`
- `PENDING -> RUNNING -> TIMEOUT`

No backward transitions.

## 2. Endpoint Contracts

## 2.1 POST `/jobs`
Create a new analysis job. Non-blocking by default; client polls job endpoints.

### Request
- Headers:
  - `Content-Type: multipart/form-data`
- Form fields:
  - `file` (required): CSV file
  - `user_id` (optional): string
  - `daily_max_loss` (optional): number > 0
  - `k_repeat` (optional): integer > 0, default `1`
  - `max_seconds` (optional): number > 0, default `120`
  - `run_async` (optional): boolean, default `true`

### Success Response
- Status: `202 Accepted` (async accepted) OR `200 OK` (if server configured for sync fallback)

Example:
```json
{
  "ok": true,
  "job": {
    "job_id": "8b6f1ef3-57dd-4fb5-a861-c9cc09f1bb4f",
    "user_id": "user_123",
    "created_at": "2026-02-07T18:34:21+00:00",
    "engine_version": "a1b2c3d",
    "input_sha256": "2f3fd5dfe1...",
    "execution_status": "PENDING"
  },
  "data": {
    "status_url": "/jobs/8b6f1ef3-57dd-4fb5-a861-c9cc09f1bb4f",
    "summary_url": "/jobs/8b6f1ef3-57dd-4fb5-a861-c9cc09f1bb4f/summary",
    "review_url": "/jobs/8b6f1ef3-57dd-4fb5-a861-c9cc09f1bb4f/review",
    "counterfactual_url": "/jobs/8b6f1ef3-57dd-4fb5-a861-c9cc09f1bb4f/counterfactual",
    "message": "Job accepted."
  },
  "error": null
}
```

### Error Response
- Status: `400`, `413`, `415`, `422`, `500`

Example:
```json
{
  "ok": false,
  "job": {
    "job_id": null,
    "user_id": "user_123",
    "created_at": null,
    "engine_version": null,
    "input_sha256": null,
    "execution_status": null
  },
  "data": null,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "k_repeat must be > 0",
    "details": {}
  }
}
```

### Invariants
- `job.job_id` is non-null on success.
- `execution_status` is `PENDING` or `RUNNING` on accepted async jobs.
- Correlation fields are always present.

## 2.2 GET `/jobs/{job_id}`
Fetch canonical job status and metadata.

### Request
- Path params:
  - `job_id` (required): string UUID-like identifier

### Success Response
- Status: `200 OK`

Example:
```json
{
  "ok": true,
  "job": {
    "job_id": "8b6f1ef3-57dd-4fb5-a861-c9cc09f1bb4f",
    "user_id": "user_123",
    "created_at": "2026-02-07T18:34:21+00:00",
    "engine_version": "a1b2c3d",
    "input_sha256": "2f3fd5dfe1...",
    "execution_status": "COMPLETED"
  },
  "data": {
    "status": "COMPLETED",
    "finished_at": "2026-02-07T18:34:24+00:00",
    "outcome": "WINNER",
    "delta_pnl": 1250.5,
    "cost_of_bias": 1250.5,
    "error_type": null,
    "error_message": null,
    "artifacts": {
      "summary_url": "/jobs/8b6f1ef3-57dd-4fb5-a861-c9cc09f1bb4f/summary",
      "review_url": "/jobs/8b6f1ef3-57dd-4fb5-a861-c9cc09f1bb4f/review",
      "counterfactual_url": "/jobs/8b6f1ef3-57dd-4fb5-a861-c9cc09f1bb4f/counterfactual"
    }
  },
  "error": null
}
```

### Error Response
- Status: `404`

```json
{
  "ok": false,
  "job": {
    "job_id": "8b6f1ef3-57dd-4fb5-a861-c9cc09f1bb4f",
    "user_id": null,
    "created_at": null,
    "engine_version": null,
    "input_sha256": null,
    "execution_status": null
  },
  "data": null,
  "error": {
    "code": "JOB_NOT_FOUND",
    "message": "Job does not exist.",
    "details": {}
  }
}
```

### Invariants
- `data.status == job.execution_status`.
- `outcome`, `delta_pnl`, `cost_of_bias` are `null` unless `COMPLETED`.
- `error_type/error_message` are non-null only for `FAILED|TIMEOUT`.

## 2.3 GET `/users/{user_id}/jobs?limit=...`
List recent jobs for one user.

### Request
- Path params:
  - `user_id` (required)
- Query params:
  - `limit` (optional): integer `1..200`, default `20`

### Success Response
- Status: `200 OK`

```json
{
  "ok": true,
  "job": {
    "job_id": null,
    "user_id": "user_123",
    "created_at": null,
    "engine_version": null,
    "input_sha256": null,
    "execution_status": null
  },
  "data": {
    "count": 2,
    "limit": 20,
    "jobs": [
      {
        "job_id": "job_a",
        "user_id": "user_123",
        "created_at": "2026-02-07T18:34:21+00:00",
        "engine_version": "a1b2c3d",
        "input_sha256": "abcd...",
        "execution_status": "COMPLETED",
        "outcome": "DRAW",
        "delta_pnl": 0.0,
        "cost_of_bias": 0.0
      },
      {
        "job_id": "job_b",
        "user_id": "user_123",
        "created_at": "2026-02-07T18:30:11+00:00",
        "engine_version": "a1b2c3d",
        "input_sha256": "efgh...",
        "execution_status": "FAILED",
        "outcome": null,
        "delta_pnl": null,
        "cost_of_bias": null
      }
    ]
  },
  "error": null
}
```

### Error Response
- Status: `400` (invalid limit), `500`

```json
{
  "ok": false,
  "job": {
    "job_id": null,
    "user_id": "user_123",
    "created_at": null,
    "engine_version": null,
    "input_sha256": null,
    "execution_status": null
  },
  "data": null,
  "error": {
    "code": "INVALID_LIMIT",
    "message": "limit must be between 1 and 200",
    "details": {}
  }
}
```

### Invariants
- `data.jobs` sorted by `created_at` descending.
- Every item includes correlation fields and execution status enum.

## 2.4 GET `/jobs/{job_id}/summary`
Return compact frontend summary. Target payload <= 25KB in typical usage.

### Request
- Path params:
  - `job_id` (required)

### Success Response
- Status: `200 OK`

```json
{
  "ok": true,
  "job": {
    "job_id": "8b6f1ef3-57dd-4fb5-a861-c9cc09f1bb4f",
    "user_id": "user_123",
    "created_at": "2026-02-07T18:34:21+00:00",
    "engine_version": "a1b2c3d",
    "input_sha256": "2f3fd5dfe1...",
    "execution_status": "COMPLETED"
  },
  "data": {
    "headline": "WINNER",
    "scoreboard": {
      "delta_pnl": 1250.5,
      "cost_of_bias": 1250.5,
      "blocked_bias_count": 17,
      "blocked_risk_count": 3
    },
    "bias_rates": {
      "revenge_rate": 0.12,
      "overtrading_rate": 0.09,
      "loss_aversion_rate": 0.04,
      "any_bias_rate": 0.18
    },
    "badge_counts": {
      "MEGABLUNDER": 4,
      "BLUNDER": 26,
      "MISS": 19,
      "MISTAKE": 105,
      "INACCURACY": 582,
      "GOOD": 8200,
      "EXCELLENT": 611,
      "BEST": 241,
      "GREAT": 19,
      "BRILLIANT": 3
    },
    "top_moments_preview": [
      {
        "timestamp": "2026-02-01T09:52:00",
        "asset": "BTC",
        "label": "MEGABLUNDER",
        "impact": 1400.2
      }
    ],
    "error_type": null,
    "error_message": null
  },
  "error": null
}
```

### Error Response
- Status: `404`, `409`, `500`
- `409` when job not terminal yet (`PENDING|RUNNING`).

```json
{
  "ok": false,
  "job": {
    "job_id": "8b6f1ef3-57dd-4fb5-a861-c9cc09f1bb4f",
    "user_id": "user_123",
    "created_at": "2026-02-07T18:34:21+00:00",
    "engine_version": "a1b2c3d",
    "input_sha256": "2f3fd5dfe1...",
    "execution_status": "RUNNING"
  },
  "data": null,
  "error": {
    "code": "JOB_NOT_READY",
    "message": "Summary is available only after job completion.",
    "details": {}
  }
}
```

### Invariants
- `summary` keys are stable and always present.
- Unknown scalar values are `null`, not omitted.
- Typical payload should remain <= 25KB by limiting previews (`top_moments_preview` max 3).

## 2.5 GET `/jobs/{job_id}/review`
Return full `review.json` payload for a job.

### Request
- Path params:
  - `job_id` (required)

### Success Response
- Status: `200 OK`

```json
{
  "ok": true,
  "job": {
    "job_id": "8b6f1ef3-57dd-4fb5-a861-c9cc09f1bb4f",
    "user_id": "user_123",
    "created_at": "2026-02-07T18:34:21+00:00",
    "engine_version": "a1b2c3d",
    "input_sha256": "2f3fd5dfe1...",
    "execution_status": "COMPLETED"
  },
  "data": {
    "review": {
      "headline": "WINNER",
      "execution_status": "COMPLETED",
      "scoreboard": {
        "delta_pnl": 1250.5,
        "cost_of_bias": 1250.5,
        "blocked_bias_count": 17,
        "blocked_risk_count": 3
      },
      "bias_rates": {},
      "derived_stats": {},
      "labeling_rules": {},
      "badge_counts": {},
      "badge_examples": {},
      "grade_distribution_by_phase": {},
      "opening": {},
      "middlegame": {},
      "endgame": {},
      "top_moments": [],
      "recommendations": [],
      "coach_plan": [],
      "data_quality_warnings": [],
      "error_type": null,
      "error_message": null
    }
  },
  "error": null
}
```

### Error Response
- Status: `404`, `500`

```json
{
  "ok": false,
  "job": {
    "job_id": "8b6f1ef3-57dd-4fb5-a861-c9cc09f1bb4f",
    "user_id": null,
    "created_at": null,
    "engine_version": null,
    "input_sha256": null,
    "execution_status": null
  },
  "data": null,
  "error": {
    "code": "REVIEW_NOT_FOUND",
    "message": "review.json does not exist for this job.",
    "details": {}
  }
}
```

### Invariants
- `data.review.execution_status` equals top-level `job.execution_status`.
- Review payload keys are stable; missing values use `null` or empty containers.

## 2.6 GET `/jobs/{job_id}/counterfactual`
Return paginated counterfactual rows in JSON for frontend tables/charts.

### Request
- Path params:
  - `job_id` (required)
- Query params:
  - `offset` (optional): integer >= 0, default `0`
  - `limit` (optional): integer `1..2000`, default `500`

### Success Response
- Status: `200 OK`

```json
{
  "ok": true,
  "job": {
    "job_id": "8b6f1ef3-57dd-4fb5-a861-c9cc09f1bb4f",
    "user_id": "user_123",
    "created_at": "2026-02-07T18:34:21+00:00",
    "engine_version": "a1b2c3d",
    "input_sha256": "2f3fd5dfe1...",
    "execution_status": "COMPLETED"
  },
  "data": {
    "offset": 0,
    "limit": 500,
    "total_rows": 10000,
    "columns": [
      "timestamp",
      "asset",
      "pnl",
      "is_revenge",
      "is_overtrading",
      "is_loss_aversion",
      "is_blocked_bias",
      "is_blocked_risk",
      "blocked_reason",
      "simulated_pnl",
      "simulated_daily_pnl",
      "simulated_equity",
      "checkmated_day",
      "trade_grade",
      "special_tags"
    ],
    "rows": [
      {
        "timestamp": "2026-02-01T09:30:00",
        "asset": "BTC",
        "pnl": -100.0,
        "is_revenge": true,
        "is_overtrading": false,
        "is_loss_aversion": false,
        "is_blocked_bias": true,
        "is_blocked_risk": false,
        "blocked_reason": "BIAS",
        "simulated_pnl": 0.0,
        "simulated_daily_pnl": 50.0,
        "simulated_equity": 250.0,
        "checkmated_day": false,
        "trade_grade": "BLUNDER",
        "special_tags": "INTERESTING"
      }
    ]
  },
  "error": null
}
```

### Error Response
- Status: `400`, `404`, `409`, `500`
- `409` when job is not `COMPLETED`.

```json
{
  "ok": false,
  "job": {
    "job_id": "8b6f1ef3-57dd-4fb5-a861-c9cc09f1bb4f",
    "user_id": "user_123",
    "created_at": "2026-02-07T18:34:21+00:00",
    "engine_version": "a1b2c3d",
    "input_sha256": "2f3fd5dfe1...",
    "execution_status": "RUNNING"
  },
  "data": null,
  "error": {
    "code": "JOB_NOT_READY",
    "message": "Counterfactual rows are available only after completion.",
    "details": {}
  }
}
```

### Invariants
- `rows.length <= limit`.
- `offset + rows.length <= total_rows`.
- `blocked_reason` enum is closed: `NONE|BIAS|DAILY_MAX_LOSS`.
- `execution_status` and correlation fields always present.

## 3. Nullability and Required Keys Matrix

Required top-level keys for all JSON responses:
- `ok` (boolean)
- `job` (object with all 6 correlation fields)
- `data` (object or `null`)
- `error` (object or `null`)

Required error object keys (when `error != null`):
- `code` (string)
- `message` (string)
- `details` (object; may be empty)

## 4. Non-Goals / Explicitly Out of Scope
- No change to engine bias/counterfactual semantics.
- No database-specific transport contract here.
- No streaming websocket contract in v1 (polling only).
