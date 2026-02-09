# PLAN18 - Review Selector and Signal Compression TDD

## Goal
Prevent repetitive top moments and surface representative insights.

## Fixture
`/Users/vishnu/Documents/Temper/docs/testdata/F23_phase18_selector.csv`

## Selection Rule
Top 3 moments target diversity first:
1. highest-impact revenge
2. highest-impact overtrading
3. highest-impact loss-aversion exemplar
Fallback by remaining impact.

## TDD Case 1 (Diversity selection)
Input: run `F23_phase18_selector.csv` through full `/jobs` pipeline.
Expected outputs:
1. top moments include at least two distinct bias categories
2. no duplicate repetitive overtrading-only set if other categories exist
3. ordered representative categories are deterministic:
   - `revenge`
   - `overtrading`
   - `loss_aversion`

## TDD Case 2 (Inspector default)
Input: above job output from `/jobs/{id}/moments`.
Expected outputs:
1. first selected moment provides a deterministic `trace_trade_id`
2. `/jobs/{id}/trade/{trace_trade_id}` resolves to matching asset/timestamp anchor

## TDD Case 3 (Human-first explanation)
Input: same moments payload.
Expected outputs:
1. first line is layman-readable
2. evidence block contains exact rule/threshold refs

Policy artifact:
`/Users/vishnu/Documents/Temper/docs/REVIEW_SELECTOR_POLICY.md`
