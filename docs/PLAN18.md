# PLAN18 - Review Selector and Signal Compression TDD

## Goal
Prevent repetitive top moments and surface representative insights.

## Selection Rule
Top 3 moments target diversity first:
1. highest-impact revenge
2. highest-impact overtrading
3. highest-impact loss-aversion exemplar
Fallback by remaining impact.

## TDD Case 1 (Diversity selection)
Input: combine outputs from `F02`, `F03`, and `F04` in one session fixture.
Expected outputs:
1. top moments include at least two distinct bias categories
2. no duplicate repetitive overtrading-only set if other categories exist

## TDD Case 2 (Inspector default)
Input: above job opened in UI.
Expected outputs:
1. inspector defaults to first selected representative moment
2. not random trade id

## TDD Case 3 (Human-first explanation)
Input: same moments payload.
Expected outputs:
1. first line is layman-readable
2. evidence block contains exact rule/threshold refs
