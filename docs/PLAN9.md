# PLAN9 - Judge Demo Contract TDD

## Goal
Lock the one-command judge demo contract using a real CSV fixture and exact expected outputs.

## Fixture Input
- `docs/testdata/F12_phase9_demo.csv`

This fixture is intentionally small but realistic: normal trades + one loss-aversion intervention case.

## TDD Case 1 - End-to-end job completion
Input:
1. `POST /jobs` with `F12_phase9_demo.csv`, `user_id=phase9-demo-user`, `run_async=false`
2. Poll `GET /jobs/{job_id}` until terminal

Expected outputs:
1. Create returns `202` and a non-empty `job_id`
2. Terminal status is `COMPLETED`

## TDD Case 2 - Summary/review exact values
Input:
1. `GET /jobs/{job_id}/summary`
2. `GET /jobs/{job_id}/review`

Expected outputs from this fixture:
1. `headline == "WINNER"`
2. `delta_pnl == 70.0`
3. `cost_of_bias == 70.0`
4. `bias_rates.loss_aversion_rate == 1/12`
5. top moments length is exactly `3`
6. first top moment:
   - `label == "MEGABLUNDER"`
   - `asset == "GOOG"`
   - `impact == 70.0`

## TDD Case 3 - Coach post-hoc contract
Input:
1. `POST /jobs/{job_id}/coach` with deterministic Vertex stub
2. `GET /jobs/{job_id}/coach`

Expected outputs:
1. Coach generation returns `200`
2. Persisted `move_review` length is exactly `3`
3. First `move_review` label remains `"MEGABLUNDER"` (deterministic label lock)

## TDD Case 4 - History fallback when Supabase unavailable
Input:
1. Force Supabase list to fail
2. `GET /users/{user_id}/jobs?limit=1`

Expected outputs:
1. Endpoint still returns `200` (local fallback)
2. Envelope remains stable: `{ok, job, data, error}`
3. `data.count >= 1`
4. first returned `job_id` matches the created job

## Implementation anchor
- Gate test: `backend/tests/gates/test_gate_phase9_judge_demo_contract.py`
- Canonical runner: `bash backend/scripts/run_gate_suite.sh`
