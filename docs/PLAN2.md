# PLAN2 - Endpoint Contract TDD

## Goal
Lock API behavior so frontend cannot drift.

## TDD Case 1 (Upload and Job Lifecycle)
Input: `/Users/vishnu/Documents/Temper/docs/testdata/F07_alias_contract.csv`
Operation:
1. `POST /jobs` (multipart)
2. poll `GET /jobs/{id}` until terminal

Expected outputs:
1. upload returns `202` with `job.execution_status=PENDING`
2. polling reaches `COMPLETED`
3. envelope always includes `ok, job, data, error`

## TDD Case 1B (XLSX ingestion path)
Input: XLSX file with same canonical columns as F07.
Operation:
1. upload through same endpoint or XLSX-normalizing endpoint

Expected outputs:
1. row count matches CSV equivalent
2. summary metrics match CSV equivalent job within tolerance
3. no schema drift in downstream artifacts

## TDD Case 2 (Required Review Endpoints)
Input: job created from fixture above.
Operations:
1. `GET /jobs/{id}/summary`
2. `GET /jobs/{id}/counterfactual/series?max_points=2000`
3. `GET /jobs/{id}/moments`
4. `GET /jobs/{id}/trade/{trade_id}`

Expected outputs:
1. summary has `delta_pnl`, `bias_rates`, `badge_counts`
2. series has `points.length > 0`
3. moments returns list with `label`, `explanation_human`, `evidence.metric_refs`
4. trade inspector contains `decision`, `reason`, `counterfactual_mechanics`

## TDD Case 3 (Error contract)
Operation: request non-existent job.
Expected outputs:
1. `404`, `error.code=JOB_NOT_FOUND`
2. no 500, envelope shape stable
