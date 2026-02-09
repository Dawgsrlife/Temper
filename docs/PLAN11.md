# PLAN11 - Heatmap and Compact Timeline Contract TDD

## Goal
Provide backend-ready graphical insight primitives for frontend: compact timeline plus hourly/day heatmap cells.

## Fixture Input
- `docs/testdata/F14_phase11_heatmap.csv` (custom, real-world style CSV)

## TDD Case 1 - Summary lock for fixture
Input:
1. `POST /jobs` with `F14_phase11_heatmap.csv`, `user_id=phase11-user`, `run_async=false`
2. `GET /jobs/{job_id}/summary`

Expected outputs:
1. `delta_pnl == 1180.0`
2. `cost_of_bias == 1180.0`
3. `bias_rates.loss_aversion_rate == 2/7`

## TDD Case 2 - Hourly heatmap contract
Input:
1. `GET /jobs/{job_id}/counterfactual/heatmap?granularity=hour`

Expected outputs:
1. `granularity == "hour"`
2. `total_cells == 3`
3. cell[0] (`2025-03-15T09:00:00`):
   - `trade_count=3`
   - `modified_count=1`
   - `bias_count=1`
   - `actual_pnl=-530.0`
   - `policy_replay_pnl=-90.0`
   - `impact_abs_total=440.0`
4. cell[1] (`2025-03-15T10:00:00`):
   - `trade_count=2`
   - `modified_count=1`
   - `bias_count=1`
   - `actual_pnl=-820.0`
   - `policy_replay_pnl=-80.0`
   - `impact_abs_total=740.0`
5. cell[2] (`2025-03-15T11:00:00`):
   - `trade_count=2`
   - `modified_count=0`
   - `bias_count=0`
   - `actual_pnl=50.0`
   - `policy_replay_pnl=50.0`
   - `impact_abs_total=0.0`

## TDD Case 3 - Heatmap totals lock
Input:
1. same hourly heatmap response

Expected outputs:
1. `totals.trade_count == 7`
2. `totals.modified_count == 2`
3. `totals.bias_count == 2`
4. `totals.actual_pnl == -1300.0`
5. `totals.policy_replay_pnl == -120.0`
6. `totals.impact_abs_total == 1180.0`

## TDD Case 4 - Compact timeline compatibility
Input:
1. `GET /jobs/{job_id}/counterfactual/series?max_points=4`

Expected outputs:
1. non-empty points array (`returned_points <= 4`)
2. markers list remains available for top moments linking
3. endpoint remains bounded for frontend compaction

## Implementation anchor
- Gate test: `backend/tests/gates/test_gate_phase11_heatmap_contract.py`
- Endpoint: `GET /jobs/{job_id}/counterfactual/heatmap`
- Canonical runner: `bash backend/scripts/run_gate_suite.sh`
