# PLAN13 - Deterministic Move Explanation Contract TDD

## Goal
Lock deterministic move explanations as artifact-derived facts (no LLM dependency) for revenge, overtrading, and loss aversion.

## Fixture Inputs
- `docs/testdata/F17_phase12_resign.csv` (revenge anchor)
- `docs/testdata/F18_phase13_overtrading.csv` (overtrading anchor)
- `docs/testdata/F04_loss_aversion.csv` (loss-aversion anchor)

## TDD Case 1 - Revenge explanation + evidence
Input:
1. Upload `F17_phase12_resign.csv`
2. `GET /jobs/{job_id}/moments`

Expected top moment outputs:
1. `reason == REVENGE_SIZE_RESCALED`
2. `reason_label == Revenge sizing`
3. exact deterministic explanation:
   - `You just had a big loss (-$500.00) and increased size to +$600,000.00, so replay scaled exposure to 2.0000%.`
4. fired `REVENGE_AFTER_LOSS` rule inputs:
   - `prev_trade_pnl == -500.0`
   - `minutes_since_prev_trade == 2.0`
   - `size_multiplier == 12.0`

## TDD Case 2 - Overtrading explanation + evidence
Input:
1. Upload `F18_phase13_overtrading.csv`
2. `GET /jobs/{job_id}/moments`

Expected top moment outputs:
1. `reason == OVERTRADING_COOLDOWN_SKIP`
2. `reason_label == Overtrading (cooldown)`
3. exact deterministic explanation:
   - `You were trading far more frequently than normal, so this trade was skipped during cooldown (details: 205 trades in last hour, threshold: 200).`
4. fired `OVERTRADING_HOURLY_CAP` evidence:
   - `rolling_trade_count_1h == 205.0`
   - `overtrading_trade_threshold == 200`

## TDD Case 3 - Loss-aversion explanation + evidence
Input:
1. Upload `F04_loss_aversion.csv`
2. `GET /jobs/{job_id}/moments`

Expected top moment outputs:
1. `reason == LOSS_AVERSION_CAPPED`
2. `reason_label == Loss aversion (downside capped)`
3. exact deterministic explanation:
   - `This loss was much larger than your typical win, so replay kept the same price move but scaled exposure to 7.000000% to cap downside near -$140.00.`
4. fired `LOSS_AVERSION_PAYOFF_PROXY` evidence:
   - `median_win_pnl == 35.0`
   - `loss_cap_value == 140.0`
   - `loss_abs_pnl == 2000.0`

## TDD Case 4 - Dedicated deterministic move review endpoint
Input:
1. `GET /jobs/{job_id}/move-review` (for completed job)

Expected outputs:
1. `200` with stable envelope
2. `move_review` length exactly `3`
3. first row has label + deterministic template explanation + metric refs
4. metric ref names for top `MEGABLUNDER` row:
   - `["impact_abs", "impact_p995", "blocked_reason"]`

## Implementation anchor
- Gate test: `backend/tests/gates/test_gate_phase13_move_explanations_contract.py`
- New endpoint: `GET /jobs/{job_id}/move-review`
- Fixture: `docs/testdata/F18_phase13_overtrading.csv`
- Canonical runner: `bash backend/scripts/run_gate_suite.sh`
