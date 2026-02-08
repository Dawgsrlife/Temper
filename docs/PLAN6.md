# PLAN6 - Pattern/Episode Modeling TDD

## Goal
Model biases as episodes, not isolated trade labels.

## TDD Case 1 (Overtrading episode)
Input: `/Users/vishnu/Documents/Temper/docs/testdata/F02_overtrading_burst.csv`
Expected outputs:
1. one `OVERTRADING` episode with start/end window
2. anchor trade includes threshold-crossing row (`trade_id=6`)
3. episode metrics include `trade_count`, `avg_interval`

## TDD Case 1B (Overtrading switching and post-event burst)
Input: `/Users/vishnu/Documents/Temper/docs/testdata/F09_overtrading_switches.csv`
Expected outputs:
1. episode metrics include `direction_flip_count` for rapid BUY/SELL switching
2. episode flags include burst-after-loss and burst-after-win indicators
3. explanation references switching cadence, not just total count

## TDD Case 2 (Revenge episode)
Input: `/Users/vishnu/Documents/Temper/docs/testdata/F03_revenge_episode.csv`
Expected outputs:
1. one `REVENGE` episode triggered by `trade_id=2`
2. anchor trade `trade_id=3`
3. explanation includes `prev_loss=-480`, `size_mult>=2.5`, `delta_minutes=1`

## TDD Case 3 (Loss aversion pattern)
Input: `/Users/vishnu/Documents/Temper/docs/testdata/F04_loss_aversion.csv`
Expected outputs:
1. session-level loss aversion metrics present
2. exemplar list includes `trade_id=4`
3. explanation references win/loss imbalance
