# PLAN8 - Anomaly Handling TDD

## Goal
Handle malformed judge data deterministically.

## TDD Case 1 (Anomaly counts)
Input: `/Users/vishnu/Documents/Temper/docs/testdata/F05_malformed.csv`
Expected summary anomalies:
1. `ASSET_MISSING=1`
2. `MISSING_FIELDS=2` (quantity, pnl)
3. `INVALID_TIMESTAMP=1`
4. `IMPLIED_NOTIONAL_TOO_HIGH=1`
5. `PNL_TO_BALANCE_OUTLIER=1`

## TDD Case 2 (Safety behavior)
Input: same fixture.
Expected outputs:
1. job completes without crash
2. incomplete rows marked/excluded deterministically
3. response schema remains stable

## TDD Case 3 (No fabricated values)
Input: same fixture row with missing quantity.
Expected outputs:
1. `quantity_after=null`
2. no fabricated inferred quantity unless explicit derivation rule exists
