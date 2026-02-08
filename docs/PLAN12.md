# PLAN12 - Grade and ELO TDD

## Goal
Make chess-style review and ELO deterministic and explainable.

## TDD Case 1 (Grade mapping from impacts)
Input: `F01_core_replay.csv` with impacts from replay outputs.
Derived values:
1. `unit = median(abs(actual_pnl)) = 300`
2. impacts: `[0,0,950,7900,0,100]`

Expected labels (example locked mapping):
1. trade 3 (`950`) -> `BLUNDER`
2. trade 4 (`7900`) -> `MEGABLUNDER`
3. trade 6 (`100`) -> `GOOD`

## TDD Case 2 (ELO delta)
Input grade counts:
1. `GOOD=4`, `BLUNDER=1`, `MEGABLUNDER=1`
Weighting:
`score = 0.5*GOOD - 4*BLUNDER - 6*MEGABLUNDER = -8`
`elo_delta = round(10*tanh(score/50)) = -2`

Expected outputs:
1. base ELO `1200`
2. new ELO `1198`

## TDD Case 3 (UI terminology)
Input: review page render for above run.
Expected outputs:
1. headline uses `ELO` text
2. no primary label `Discipline Score` on judge path

## TDD Case 4 (Session result labels)
Input: completed run with deterministic grading summary.
Expected outputs:
1. one result label chosen from `{WINNER,DRAW,RESIGN,CHECKMATED,ABANDON,TIMEOUT}`
2. result derivation is deterministic from summary/review facts
3. tooltip explains result in plain language
