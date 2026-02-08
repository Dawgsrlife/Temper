# PLAN4 - Timeline Product Contract TDD

## Goal
Timeline must be compact, zoomable, and explainable.

## TDD Case 1 (Series generation)
Input: `/Users/vishnu/Documents/Temper/docs/testdata/F06_timeline_dense.csv`
Operation: `GET /jobs/{id}/counterfactual/series?max_points=5`

Expected outputs:
1. `points.length <= 5`
2. `points.length > 0`
3. timestamps strictly increasing
4. each point has finite `actual_equity` and `simulated_equity`

## TDD Case 2 (Marker linkage)
Input: same job.
Operation: `GET /jobs/{id}/moments`
Expected outputs:
1. each top moment timestamp appears as marker or nearest point context
2. tooltip payload includes `label`, `reason`, `actual_pnl`, `simulated_pnl`

## TDD Case 3 (Chart crash prevention)
Input: include one invalid timestamp row in fixture copy.
Expected outputs:
1. chart sanitization removes invalid point
2. UI does not throw canvas error
