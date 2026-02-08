# Post-Pull Frontend Merge Playbook

Goal: integrate incoming frontend PR with backend quickly, with minimal drift.

## Step 1: Freeze Backend Contract

Do not change engine semantics. Only wire frontend to existing endpoints.

Use:
- `POST /jobs`
- `GET /jobs/{job_id}`
- `GET /jobs/{job_id}/summary`
- `GET /jobs/{job_id}/counterfactual/series?max_points=2000`
- `GET /jobs/{job_id}/moments`
- `GET /jobs/{job_id}/trade/{trade_id}`
- `POST /jobs/{job_id}/coach`
- `GET /jobs/{job_id}/coach`
- `GET /users/{user_id}/jobs?limit=10`

Legacy aliases exist if frontend currently calls `/api/*`:
- `POST /api/upload`
- `POST /api/analyze`
- `GET /api/jobs/{job_id}`
- `GET /api/history`

## Step 2: Large CSV Upload Path (200k+ rows)

Use `POST /jobs` (multipart upload) and poll job status.

Notes:
- `/jobs` now enforces `MAX_UPLOAD_MB` with `413 PAYLOAD_TOO_LARGE`.
- `/api/upload` also enforces this limit and no longer does a second full CSV parse.
- Set `MAX_UPLOAD_MB` high enough for demo datasets.

Recommended env:
- `MAX_UPLOAD_MB=100`
- `JOB_WORKERS=1` (deterministic demo behavior)

## Step 3: Trading View Wiring

Use `GET /jobs/{job_id}/counterfactual/series?max_points=2000`.

Render:
- actual line: `point.actual_equity`
- replay line: `point.policy_replay_equity` (or `point.simulated_equity`)

Interaction:
- pan/zoom in chart layer
- markers from `data.markers` for top moments

Tooltip content:
- timestamp
- asset
- trade_grade
- reason_label
- impact_abs
- intervention_type

## Step 4: Side Panel (Chess Review)

Primary list:
- `GET /jobs/{job_id}/moments`

Inspector on click:
- use `trace_trade_id` from selected moment
- call `GET /jobs/{job_id}/trade/{trace_trade_id}`

Show:
- decision and reason label
- deterministic explanation (`explanation_plain_english`, `thesis`, `lesson`)
- mechanics (`counterfactual_mechanics`)
- rule receipts (`evidence.rule_hits`)
- optional coach explanation (`/jobs/{job_id}/coach`)

## Step 5: ELO + Session Result

Use:
- `GET /jobs/{job_id}/elo` for session delta/projection
- `GET /users/{user_id}/jobs` for history row list
- `GET /api/history?userId=...` if frontend expects old rating history payload

Session result label source:
- `summary.outcome` from job/summary envelope

## Step 6: Optional Integrations (Supabase, Uploadthing)

Use only if frontend PR needs them:
- Uploadthing ingest: `POST /jobs/from-uploadthing`
- Supabase history is already read with local fallback for history paths.

If a provider fails during demo:
- keep canonical `/jobs` flow working first
- surface structured API errors in UI (do not hide)

## Step 7: Merge Gate (Must Run)

1. Backend gates:
```bash
backend/venv/bin/python backend/tests/gates/run_gates.py
```

2. Integration smoke (requires backend running):
```bash
backend/scripts/frontend_contract_smoke.sh
```

3. Manual checks:
- upload CSV and reach `COMPLETED`
- timeline has non-empty points
- top moments render and open inspector
- coach shows success or structured failure
- history returns rows for same `user_id`
