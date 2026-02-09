# PLAN20 - Final 8-Hour Execution TDD Board

## Goal
Execute without thrash and with verifiable checkpoints.

## Phase 20 Canonical Fixtures
1. `F23_phase18_selector.csv` (mixed-bias rubric demonstration)
2. `F25_phase20_unseen_scale.csv` (unseen 20x-like scale/recording check)

## TDD Case 1 (Hour 0-1: Backend Truth Lock)
TDD Input: `F01_core_replay.csv`
Expected outputs:
1. all gates pass
2. core replay values match PLAN1 exact expectations

## TDD Case 2 (Hour 1-3: Frontend Real Wiring)
TDD Input: `F07_alias_contract.csv` through UI
Expected outputs:
1. upload -> polling -> completed -> summary visible
2. no mock/local analysis in demo route

## TDD Case 3 (Hour 3-5: Timeline + Moments)
TDD Input: `F06_timeline_dense.csv`
Expected outputs:
1. compact timeline visible with >0 points
2. markers and hover details match moments payload

## TDD Case 4 (Hour 5-6: Coach)
TDD Input: completed `F01` job with Vertex enabled
Expected outputs:
1. coach generated and shown
2. if failed, explicit structured error shown

## TDD Case 5 (Hour 6-7: Judge Script Rehearsal)
TDD Input: `F01` then `F05`
Expected outputs:
1. success on baseline
2. graceful failure behavior on malformed file

## TDD Case 6 (Hour 7-8: Recording)
TDD Input: unseen CSV `F25_phase20_unseen_scale.csv`
Expected outputs:
1. no crash
2. deterministic narrative remains valid
3. video includes upload, timeline, moments, inspector, coach

## TDD Case 7 (Challenge rubric final check)
TDD Input: final build + mixed rubric fixtures (`F23`, `F25`) plus baseline matrix sanity.
Expected outputs:
1. Performance: analysis completes quickly and timeline remains bounded
2. Creativity: chess-style move review + timeline + heatmap are visible
3. Behavioral insight: overtrading/loss aversion/revenge are all demonstrated
4. Personalization: suggestions reference user-specific metrics/thresholds

## Real output locks
1. `F23`:
   - moments categories in order: `revenge`, `overtrading`, `loss_aversion`
2. `F25`:
   - summary `headline=WINNER`
   - `delta_pnl=5676.603000000003`
   - `/counterfactual/series?max_points=2000` returns exactly 2000 points
