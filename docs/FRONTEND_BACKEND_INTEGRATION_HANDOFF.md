# Frontend-Backend Integration Handoff (Merge-Ready)

This document is the backend wiring contract for the incoming frontend PR.
It is intentionally narrow: endpoint mapping, response keys, and integration sequence.

## 1) Canonical Flow (Must Use This Order)

1. Upload/create job  
   - Primary: `POST /jobs` (multipart CSV upload)
   - Legacy alias: `POST /api/upload`
2. Poll status until terminal  
   - Primary: `GET /jobs/{job_id}`
   - Legacy alias: `GET /api/jobs/{job_id}`
3. Read artifacts for rendering  
   - `GET /jobs/{job_id}/summary`
   - `GET /jobs/{job_id}/counterfactual/series?max_points=2000`
   - `GET /jobs/{job_id}/moments`
   - `GET /jobs/{job_id}/trade/{trade_id}` (on click)
4. Optional coach  
   - `POST /jobs/{job_id}/coach`
   - `GET /jobs/{job_id}/coach`
5. History  
   - `GET /users/{user_id}/jobs?limit=10`
   - Legacy alias: `GET /api/history?userId={user_id}&limit=10`

## 2) Endpoint Mapping For Frontend PR

If frontend currently calls these:
- `POST /api/upload`
- `POST /api/analyze`
- `GET /api/jobs/{job_id}`
- `GET /api/history`

No frontend backend-wire refactor is required immediately: aliases already exist.

Recommended long-term cleanup:
- Move all frontend calls to canonical `/jobs/*` + `/users/*` endpoints.

## 3) Required Response Keys Frontend Can Depend On

### 3.1 `GET /jobs/{job_id}/summary`
- `ok`
- `job.execution_status`
- `data.headline`
- `data.delta_pnl`
- `data.cost_of_bias`
- `data.bias_rates`
- `data.badge_counts`

### 3.2 `GET /jobs/{job_id}/counterfactual/series`
- `ok`
- `data.points[]` with:
  - `timestamp`
  - `actual_equity`
  - `simulated_equity`
  - `policy_replay_equity`
- `data.markers[]` with:
  - `timestamp`
  - `asset`
  - `trade_grade`
  - `blocked_reason`
  - `reason_label`
  - `impact_abs`
  - `intervention_type`
- `data.metrics` with:
  - `return_actual`
  - `return_policy_replay`
  - `max_drawdown_actual`
  - `max_drawdown_policy_replay`
  - `worst_day_actual`
  - `worst_day_policy_replay`
  - `trade_volatility_actual`
  - `trade_volatility_policy_replay`
  - `pct_trades_modified`
  - `top_bias_by_impact`

### 3.3 `GET /jobs/{job_id}/moments`
- `ok`
- `data.moments[]` each includes:
  - `timestamp`
  - `asset`
  - `label` or `trade_grade`
  - `pnl`
  - `simulated_pnl`
  - `impact_abs`
  - `blocked_reason`
  - bias flags (`is_revenge`, `is_overtrading`, `is_loss_aversion`) as bool or null
  - `explanation_human`
  - `evidence`
  - `trace_trade_id` (inspector anchor)

### 3.4 `GET /jobs/{job_id}/trade/{trade_id}`
- `ok`
- `data.trade` with:
  - `raw_input_row`
  - `derived_flags`
  - `decision`
  - `counterfactual`
  - `counterfactual_mechanics`
  - `explanation_plain_english`
  - `thesis`
  - `lesson`
  - `evidence`

### 3.5 Coach Endpoints
- `POST /jobs/{job_id}/coach`
  - success: `ok=true`
  - not ready: `409 JOB_NOT_READY`
  - generation failure: `502 COACH_GENERATION_FAILED`
- `GET /jobs/{job_id}/coach`
  - success: `data.coach`
  - failed state: `409 COACH_FAILED` with `data.coach_error`
  - missing: `404 COACH_NOT_FOUND`

## 4) Frontend Merge Guardrails

1. Do not run local `analyzeSession/parseCSV` for judge path pages.
2. Always show backend error envelope contents (`error.code`, `error.message`) inline.
3. Never default missing bias flags to `false`; render `null` explicitly as unknown.
4. Timeline must read `data.points` from `/counterfactual/series`; no local reconstruction.
5. Trade inspector must use `trace_trade_id` from `/moments` when available.

## 5) Integration Smoke Command

Run before merging frontend PR:

```bash
/Users/vishnu/Documents/Temper/backend/scripts/frontend_contract_smoke.sh
```

This validates:
- `/jobs/*` canonical flow
- `/api/*` alias compatibility
- key payload keys expected by frontend wiring

## 6) Scope Boundary

- Backend engine semantics are frozen.
- Frontend PR can change UI/UX freely.
- Backend wiring must only consume published contract above.

## 7) Merge Helpers

- Post-pull integration runbook:
  - `docs/POST_PULL_FRONTEND_MERGE_PLAYBOOK.md`
- Copy-paste TS adapter:
  - `docs/FRONTEND_API_ADAPTER_SNIPPET.ts`
