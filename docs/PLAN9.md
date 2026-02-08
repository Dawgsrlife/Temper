# PLAN9 - Error Envelope and Failure Modes TDD

## Goal
No hidden failures; no user-facing 500s for expected error paths.

## TDD Case 1 (Not found)
Input: `GET /jobs/nonexistent`.
Expected outputs:
1. HTTP `404`
2. `error.code=JOB_NOT_FOUND`
3. envelope keys present

## TDD Case 2 (Not ready coach)
Input: create pending/running job, then `POST /jobs/{id}/coach`.
Expected outputs:
1. HTTP `409`
2. `error.code=JOB_NOT_READY`

## TDD Case 3 (Corrupt record)
Input: write invalid `job.json` then read endpoints.
Expected outputs:
1. HTTP `422`
2. `error.code=CORRUPT_JOB_RECORD`
3. no endpoint returns raw stacktrace
