# PLAN10 - Recording Readiness Contract TDD

## Goal
Lock backend outputs required for demo recording: summary, compact timeline, moments, trade inspector, coach, history.

## Fixture Input
- `docs/testdata/F13_phase10_recording.csv` (custom, real-world style CSV)

## TDD Case 1 - Summary and review exact expectations
Input:
1. `POST /jobs` with `F13_phase10_recording.csv`, `user_id=phase10-recording`, `run_async=false`
2. `GET /jobs/{job_id}/summary`
3. `GET /jobs/{job_id}/review`

Expected outputs:
1. `headline == "WINNER"`
2. `delta_pnl == 3220.0`
3. `cost_of_bias == 3220.0`
4. `bias_rates.loss_aversion_rate == 0.2`
5. `top_moments` length is exactly `3`
6. top moment is `MEGABLUNDER` on `GOOG` with `impact == 2860.0`
7. first recommendation string:
   - `"Bias-impacted trades: 20.00% across 10 trades."`

## TDD Case 2 - Compact timeline series contract
Input:
1. `GET /jobs/{job_id}/counterfactual/series?max_points=5`

Expected outputs:
1. points length is exactly `5`
2. first point:
   - `timestamp == 2025-03-14T09:00:00`
   - `actual_equity == 100.0`
   - `simulated_equity == 100.0`
3. last point:
   - `timestamp == 2025-03-14T09:17:00`
   - `actual_equity == -2330.0`
   - `simulated_equity == 890.0`
4. markers length is exactly `3`
5. first marker label/reason:
   - `trade_grade == MEGABLUNDER`
   - `reason_label == Loss aversion (downside capped)`

## TDD Case 3 - Moments and trade inspector receipts
Input:
1. `GET /jobs/{job_id}/moments`
2. `GET /jobs/{job_id}/trade/{trace_trade_id_of_top_moment}`

Expected outputs:
1. first moment:
   - `decision == KEEP`
   - `reason == LOSS_AVERSION_CAPPED`
   - `counterfactual_mechanics.mechanism == EXPOSURE_SCALING`
   - `scale_factor == 0.0466666667`
   - `cap_used == 140.0`
2. first moment includes:
   - human explanation text
   - non-empty `rule_hits`
3. trade inspector counterfactual:
   - `actual_pnl == -3000.0`
   - `simulated_pnl == -140.0`
   - `delta_pnl == 2860.0`

## TDD Case 4 - Coach personalization lock
Input:
1. `POST /jobs/{job_id}/coach` with deterministic fake Vertex
2. `GET /jobs/{job_id}/coach`

Expected outputs:
1. coach `move_review` length is exactly `3`
2. diagnosis metric refs include exact deterministic values:
   - `loss_aversion_rate == 0.2`
   - `cost_of_bias == 3220.0`
3. plan title includes personalized rate text:
   - `"20.0%"`

## TDD Case 5 - History contract
Input:
1. `GET /users/phase10-recording/jobs?limit=1`

Expected outputs:
1. `200`, stable envelope
2. at least one row
3. first `job_id` matches created job

## Implementation anchor
- Gate test: `backend/tests/gates/test_gate_phase10_recording_readiness.py`
- Canonical runner: `bash backend/scripts/run_gate_suite.sh`
