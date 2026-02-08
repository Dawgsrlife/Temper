# Fixture Catalog

This catalog is the fixture-to-output truth table used by gate tests.

## Core Matrix (F01-F08)

1. `F01_core_replay.csv`
   - expected terminal status: `COMPLETED`
   - expected summary: `headline=WINNER`, `delta_pnl=9900.0`
   - expected moments: length `3`

2. `F02_overtrading_burst.csv`
   - expected terminal status: `COMPLETED`
   - expected summary: `headline=DRAW`, `delta_pnl=0.0`
   - expected moments: length `3`

3. `F03_revenge_episode.csv`
   - expected terminal status: `COMPLETED`
   - expected summary: `headline=DRAW`, `delta_pnl=0.0`
   - expected moments: length `3`

4. `F04_loss_aversion.csv`
   - expected terminal status: `COMPLETED`
   - expected summary: `headline=WINNER`, `delta_pnl=1860.0`
   - expected moments: length `3`

5. `F05_malformed.csv`
   - expected terminal status: `FAILED`
   - expected summary: `headline=None`, `delta_pnl=0.0`
   - expected moments endpoint: `409 COUNTERFACTUAL_NOT_READY`

6. `F06_timeline_dense.csv`
   - expected terminal status: `COMPLETED`
   - expected summary: `headline=DRAW`, `delta_pnl=0.0`
   - expected moments: length `3`

7. `F07_alias_contract.csv`
   - expected terminal status: `COMPLETED`
   - expected summary: `headline=DRAW`, `delta_pnl=0.0`
   - expected moments: length `3`

8. `F08_20x_scale_hint.csv`
   - expected terminal status: `COMPLETED`
   - expected summary: `headline=DRAW`, `delta_pnl=0.0`
   - expected moments: length `3`

## Determinism Audit Fixture

9. `F22_phase17_determinism.csv`
   - run twice with same config
   - expected summary equality across runs
   - expected moments equality across runs
   - expected artifact hash equality across runs for:
     - `counterfactual.csv`
     - `review.json`
   - expected summary values:
     - `headline=WINNER`
     - `delta_pnl=6360.0`
     - `cost_of_bias=6360.0`
     - `loss_aversion_rate=0.2222222222222222`

## Change Policy

If any expected value in this catalog needs to change, follow `docs/GOLDEN_CHANGE_POLICY.md`:
1. failing test first
2. minimal fix
3. catalog/golden update in same PR
4. full gate suite green
