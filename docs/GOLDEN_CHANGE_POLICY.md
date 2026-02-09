# Golden Change Policy

This repository uses fixture-backed golden gates as the source of truth for deterministic behavior.

## Non-Negotiable Sequence

1. Add or update a failing test first.
2. Show the failure reason clearly.
3. Implement the minimal fix.
4. Re-run gates and show pass.
5. Update golden expectations only when the failing test proves prior output was wrong.

## Golden Update Rule

A golden value change is allowed only when all conditions are met in the same PR:

1. A failing test demonstrates why the previous expected output is wrong.
2. A fix commit changes implementation or contract behavior intentionally.
3. The golden fixture/expected output is updated in the same PR.
4. Gate suite passes after the update.

## Required Evidence in PR Description

1. Failing test output snippet.
2. Passing test output snippet.
3. Exact fixture used (for example `docs/testdata/F21_phase16_governance.csv`).
4. Why the change does not alter deterministic engine semantics unless explicitly intended.

## Scope Guard

1. Do not edit core replay semantics casually.
2. Do not change API payload shapes without gate updates.
3. Do not merge when any gate is red.
