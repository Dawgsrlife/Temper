# PLAN3 - Gate-First Development Workflow

## Rule
No production code edits until failing test exists.

## Gate Command
1. `pytest backend/tests/gates -q`
2. optional: `python3 backend/tests/gates/run_gates.py`

## TDD Case 1 (Fail-first example)
Input: modify replay behavior intentionally (local branch only) for `trade_id=6` in F01 so it is not skipped.
Expected failing output:
1. golden test fails on `trade_id=6 simulated_pnl expected 0.0`

Then implementation fix expected output:
1. gate suite passes
2. `trade_id=6` restored to `SKIP` and `simulated_pnl=0.0`

## TDD Case 2 (Golden stability)
Input: rerun same fixture F01 twice.
Expected outputs:
1. same decisions in same order
2. same mechanics payload values
3. same summary metrics
