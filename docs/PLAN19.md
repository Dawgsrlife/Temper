# PLAN19 - Judge Demo Script TDD

## Goal
One command proving end-to-end behavior via HTTP only.

## Script Inputs
1. base URL
2. user id
3. CSV path (`F01_core_replay.csv` for baseline)

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
Input: `F01_core_replay.csv`
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
2. prints structured error code/message
