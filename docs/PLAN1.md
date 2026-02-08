# PLAN1 - Master Objective and Canonical TDD Baseline

## Shipping Objective
Deliver one deterministic end-to-end product flow:
1. upload CSV
2. process deterministic bias pipeline
3. render compact timeline (actual vs disciplined replay)
4. show chess-style moments with receipts
5. show trade inspector + coach

## Architecture Alignment (Locked)
Pipeline remains:
`CSV/XLSX/Form -> Normalize -> BiasDetective -> Counterfactual Replay -> Review/Grading -> Artifacts -> API -> UI`

No LLM logic is allowed to modify detection, replay, or grading outputs.

## NBC Challenge Input Schema (Canonical)
Required canonical columns (after normalization):
1. `timestamp`
2. `side` (buy/sell)
3. `asset`
4. `quantity`
5. `entry_price`
6. `exit_price`
7. `profit_loss`
8. `balance`

## Canonical Test Config (Used Across Plans)
- overtrading: `threshold=5 trades`, `window=60m`
- revenge: `prev_loss_abs>=400`, `window<=15m`, `size_mult>=2.5`
- loss aversion cap: `cap = median(prior winning pnl) * 4`
- replay actions: `KEEP | SKIP | RESCALE | LOSS_CAP`

## TDD Case 1 (Core Replay)
Input: `/Users/vishnu/Documents/Temper/docs/testdata/F01_core_replay.csv`

Expected outputs:
1. `trade_id=3` -> `reason=REVENGE_SIZE_RESCALED`, `effective_scale=0.05`, `simulated_pnl=50.0`
2. `trade_id=4` -> `reason=LOSS_AVERSION_CAPPED`, `cap_used=2100.0`, `simulated_pnl=-2100.0`
3. `trade_id=6` -> `reason=OVERTRADING_COOLDOWN_SKIP`, `simulated_pnl=0.0`
4. final actual cumulative pnl = `-9349.0`
5. final replay cumulative pnl = `-2499.0`

## TDD Case 2 (Non-negotiable Integrity)
Input: same fixture.

Expected outputs:
1. no NaN/inf in replay series
2. replay row count equals input row count
3. decisions are deterministic across reruns (byte-identical JSON artifacts)

## TDD Case 3 (Input schema enforcement)
Input: copy of F01 with one required field removed (e.g., missing `side` header).

Expected outputs:
1. normalization fails with structured schema error
2. job status transitions to `FAILED` with clear `error_type` and `error_message`
