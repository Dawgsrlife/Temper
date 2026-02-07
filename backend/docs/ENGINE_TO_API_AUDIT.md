# Engine to API Audit

Scope: backend runtime as implemented in `/Users/vishnu/Documents/Temper/backend/app/main.py`, `/Users/vishnu/Documents/Temper/backend/scripts/judge_pack.py`, and `/Users/vishnu/Documents/Temper/backend/app/job_store.py`.

## 1. Endpoint Schemas

All JSON endpoints return:
- `ok: bool`
- `job: { job_id, user_id, created_at, engine_version, input_sha256, execution_status }`
- `data: object|null`
- `error: object|null`

`execution_status` enum:
- `PENDING`
- `RUNNING`
- `COMPLETED`
- `FAILED`
- `TIMEOUT`
- `null` (only for unknown/nonexistent jobs)

### POST `/jobs`
- Input:
  - Multipart (`file`) or raw CSV body (fallback)
  - Optional params: `user_id`, `daily_max_loss`, `k_repeat`, `max_seconds`, `run_async`
- Output:
  - `202 Accepted`
  - `job.execution_status = "PENDING"`
  - `data` includes status/summary/review/counterfactual URLs.

### GET `/jobs/{job_id}`
- Output:
  - `data.status` mirrors `job.execution_status`
  - `data.finished_at` set only for terminal states
  - `data.outcome`, `delta_pnl`, `cost_of_bias` may be `null` pre-completion
  - `data.error_type`, `data.error_message` populated for failed/timeout jobs

### GET `/users/{user_id}/jobs?limit=...`
- Output:
  - `data.jobs[]` sorted by `created_at` descending (from `LocalJobStore.list_jobs`)
  - each job item includes correlation fields + outcome/delta/cost (nullable)

### GET `/jobs/{job_id}/summary`
- Output (compact):
  - `headline`
  - `delta_pnl`, `cost_of_bias`
  - `bias_rates`
  - `badge_counts`
  - `top_moments` (max 3, mapped subset)
  - `data_quality_warnings`
  - `execution_status`
  - `error_type`, `error_message`

### GET `/jobs/{job_id}/review`
- Output:
  - full review object under `data.review`
  - stable keys are always present (fallback skeleton before artifact exists)

### GET `/jobs/{job_id}/counterfactual`
- Output:
  - paginated JSON (`offset`, `limit`, `total_rows`, `columns`, `rows`)
  - hard limit cap enforced (`COUNTERFACTUAL_PAGE_MAX = 2000`)

## 2. Job Lifecycle State Machine

State transitions in `main.py`:
- On ingestion: write `PENDING` job record.
- Worker entry (`_process_job`): update to `RUNNING`.
- `judge_pack.py` writes terminal record:
  - `COMPLETED` on success
  - `FAILED` on handled exception
  - `TIMEOUT` on wall-clock breach
- Fallback path in `_run_job_subprocess` writes `FAILED` if subprocess exits before writing `job.json`.

Valid transitions:
- `PENDING -> RUNNING -> COMPLETED`
- `PENDING -> RUNNING -> FAILED`
- `PENDING -> RUNNING -> TIMEOUT`

## 3. Artifact Storage and References

Per-job directory:
- `/Users/vishnu/Documents/Temper/backend/outputs/<job_id>/`

Primary files:
- `input.csv`
- `job.json`
- `normalized.csv`
- `flagged.csv`
- `counterfactual.csv`
- `review.json`
- `policy_report.txt`
- `data_quality.json`
- `runtime_metrics.json`

`job.json.artifacts` stores absolute file paths written by `judge_pack.py`.

## 4. Concurrency Behavior

Implemented in `main.py`:
- `JOB_SEMAPHORE = asyncio.Semaphore(max(1, JOB_WORKERS))`
- default `JOB_WORKERS=1`
- each submitted job runs inside `_process_job` guarded by semaphore.

Implication:
- Back-to-back submissions are accepted immediately (`PENDING`) and processed serially by default.
- Prevents multi-job race pressure during demo without extra queue infra.

## 5. Payload Size Guarantees

### `/summary`
- Designed for compact payload:
  - only top 3 moments
  - no full review narrative internals
  - scalar metrics + small maps
- Current test enforces typical bound: `<= 25KB` (see `test_summary_size_bound_and_key_presence`).

### `/counterfactual`
- Pagination controls payload size:
  - required paging semantics via `offset`, `limit`
  - `limit` constrained to `1..2000`
  - deterministic slices from persisted CSV.

## 6. Engine Boundary Integrity

Engine modules unchanged in semantics:
- `/Users/vishnu/Documents/Temper/backend/app/normalizer.py`
- `/Users/vishnu/Documents/Temper/backend/app/detective.py`
- `/Users/vishnu/Documents/Temper/backend/app/counterfactual.py`
- `/Users/vishnu/Documents/Temper/backend/app/review.py`

API layer orchestration only:
- ingestion, scheduling, polling, and artifact projection happen in `/Users/vishnu/Documents/Temper/backend/app/main.py`.
