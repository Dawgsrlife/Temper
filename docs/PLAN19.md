# PLAN19 - Judge Demo Script TDD

## Goal
One command proving end-to-end behavior via HTTP only.

## Script Inputs
1. base URL
2. user id
3. CSV path (`F24_phase19_judge.csv` baseline for this phase)

## Required Steps
1. create job
2. poll terminal status
3. fetch summary
4. fetch series
5. fetch moments
6. fetch trade inspector for first moment
7. generate coach + fetch coach
8. fetch user history
9. print one line of personalized recommendation evidence

## TDD Case 1 (Happy path)
Input: `F24_phase19_judge.csv`
Expected printed outputs:
1. `job_id`
2. `status=COMPLETED`
3. headline + `delta_pnl`
4. top 3 moment labels + explanations
5. coach plan titles
6. one personalized rule suggestion with metric refs

## TDD Case 2 (Failure behavior)
Input: malformed `F05_malformed.csv`.
Expected outputs:
1. script exits non-zero on terminal failure
2. prints structured `error_type` / `error_message`

## Real fixture expectations (F24)
1. `headline=WINNER`
2. `delta_pnl=66.0`
3. dominant top moment: `MEGABLUNDER` on `GOOG`
4. first trade inspector reason: `LOSS_AVERSION_CAPPED`
