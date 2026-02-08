# PLAN16 - CI and Governance TDD

## Goal
Stop regression from parallel agent churn.

## Fixture
`/Users/vishnu/Documents/Temper/docs/testdata/F21_phase16_governance.csv`

## TDD Case 1 (Semantic protection with real CSV)
Input:
1. Run F21 through `/jobs` pipeline.
2. Inspect `/jobs/{id}/trade/3` (zero-based trace index for fixture trade_id=4).

Expected outputs:
1. `decision.reason=LOSS_AVERSION_CAPPED`
2. `decision.reason_label=Loss aversion (downside capped)`
3. mechanics remain deterministic:
   - `mechanism=EXPOSURE_SCALING`
   - `scale_factor=0.02`
   - `cap_used=120.0`
4. counterfactual remains stable:
   - `actual_pnl=-6000.0`
   - `simulated_pnl=-120.0`

## TDD Case 2 (Payload shape protection with real CSV)
Input: F21 completed job -> call `/jobs/{id}/moments` and `/jobs/{id}/trade/3`.
Expected outputs:
1. moments payload includes required keys:
   - `trade_grade`, `reason`, `reason_label`, `decision`, `counterfactual_mechanics`, `evidence`, `explanation_human`
2. trade inspector payload includes `counterfactual_mechanics.mechanism`
3. if these keys are removed/renamed, Phase 16 gate fails

## TDD Case 3 (Golden update policy)
Input: proposed expected-value update.
Expected outputs required before merge:
1. failing test demonstrating prior expected was wrong
2. fix commit
3. updated golden in same PR

Policy artifact:
`/Users/vishnu/Documents/Temper/docs/GOLDEN_CHANGE_POLICY.md`
