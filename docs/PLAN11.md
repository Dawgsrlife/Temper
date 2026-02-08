# PLAN11 - Compact Timeline and Interaction TDD

## Goal
Render entire session as compact series with actionable hover/marker context.

## TDD Case 1 (Downsample contract)
Input: `F06_timeline_dense.csv`, request `max_points=4`.
Expected outputs:
1. response `points.length <= 4`
2. first/last timestamps preserved
3. no duplicate timestamps in returned sequence

## TDD Case 2 (Hover context)
Input: same job.
Expected outputs for hovered marker:
1. shows `trade_id`, `asset`, `label`
2. shows `actual_pnl` and `simulated_pnl`
3. displays deterministic explanation from moments payload

## TDD Case 3 (Scalability behavior)
Input: duplicate F06 rows 1000x (synthetic large run).
Expected outputs:
1. series endpoint still bounded by `max_points`
2. frontend remains interactive (no horizontal-per-trade bar)

## TDD Case 4 (Graphical insight breadth)
Input: `F09_overtrading_switches.csv`.
Expected outputs:
1. timeline chart renders actual vs replay lines
2. activity/bias heatmap (hourly or interval) renders non-empty cells
3. top moments list links back to chart markers
