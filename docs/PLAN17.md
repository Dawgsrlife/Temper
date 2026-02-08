# PLAN17 - Golden Fixture Catalog TDD

## Goal
Maintain explicit fixture-to-output truth table.

## Fixture Matrix
1. `F01_core_replay.csv` -> replay mechanics exact values
2. `F02_overtrading_burst.csv` -> overtrading episodes and skips
3. `F03_revenge_episode.csv` -> revenge trigger and rescale
4. `F04_loss_aversion.csv` -> loss cap math
5. `F05_malformed.csv` -> anomaly counters and safe behavior
6. `F06_timeline_dense.csv` -> series compacting and chart stability
7. `F07_alias_contract.csv` -> upload/job endpoint contract
8. `F08_20x_scale_hint.csv` -> throughput sanity + bounded series

## TDD Case 1 (Registry validity)
Input: run all fixtures through pipeline.
Expected outputs:
1. each fixture has expected artifact set
2. no fixture returns empty summary/moments unexpectedly

## TDD Case 2 (Determinism audit)
Input: rerun entire matrix.
Expected outputs:
1. artifact hashes stable for same config
