# PLAN13 - Deterministic Move Explanation Renderer TDD

## Goal
Generate one-sentence explanations from metrics, not LLM hallucinations.

## TDD Case 1 (Revenge template)
Input: `F03_revenge_episode.csv`, anchor trade `trade_id=3`.
Expected outputs:
Expected explanation:
`After a -$480 loss, you re-entered in 1m at ~11.0x size; replay rescales exposure to baseline.`
Expected metric refs:
1. `prev_loss=-480`
2. `delta_minutes=1`
3. `size_multiplier=11.0`

## TDD Case 2 (Overtrading template)
Input: `F02_overtrading_burst.csv`, anchor `trade_id=6`.
Expected outputs:
Expected explanation:
`This trade occurred after the hourly trade cap was exceeded, so disciplined replay skips it.`
Expected metric refs:
1. `trades_last_hour=6`
2. `threshold=5`

## TDD Case 3 (Loss aversion exemplar)
Input: `F04_loss_aversion.csv`, exemplar `trade_id=4`.
Expected outputs:
Expected explanation:
`Loss size was far larger than typical wins; replay caps downside using your historical win baseline.`
Expected metric refs:
1. `median_win=40`
2. `cap_used=160`
3. `actual_loss=-2000`
