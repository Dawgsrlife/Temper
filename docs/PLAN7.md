# PLAN7 - Disciplined Replay Mechanics TDD

## Goal
Make replay mathematically and behaviorally defensible.

## Constraint (Critical)
Without intratrade path data (high/low/MAE/MFE), replay does **not** fabricate `hold-winner-longer` exits.
That part is diagnosis/recommendation only, not counterfactual pnl editing.

## TDD Case 1 (Revenge rescale exact math)
Input: `F01_core_replay.csv`
Expected outputs for `trade_id=3`:
1. `size_usd_before=600000`
2. `size_usd_after=30000`
3. `effective_scale=0.05`
4. `simulated_pnl=1000*0.05=50`

## TDD Case 2 (Loss cap via exposure scaling)
Input: `F01_core_replay.csv`
Expected outputs for `trade_id=4`:
1. prior wins `[50, 1000]`, median `525`, cap `2100`
2. `simulated_pnl=-2100`
3. `effective_scale=2100/10000=0.21`
4. `simulated_pnl ~= actual_pnl * effective_scale`

## TDD Case 3 (Overtrading skip)
Input: `F01_core_replay.csv`
Expected outputs for `trade_id=6`:
1. `decision=SKIP`
2. `mechanism=COOLDOWN_SKIP`
3. `simulated_pnl=0`

## TDD Case 4 (No fabricated winner extension)
Input: `F04_loss_aversion.csv` (includes small winners).
Expected outputs:
1. winners are not artificially increased in replay without path data
2. recommendation layer may mention early profit-taking, but replay pnl remains data-grounded
