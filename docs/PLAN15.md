# PLAN15 - Uploadthing/Supabase/Vertex Integration TDD

## Goal
Integrate required services as thin seams around deterministic core.

## Fixtures
1. `/Users/vishnu/Documents/Temper/docs/testdata/F20_phase15_uploadthing.csv`
2. `/Users/vishnu/Documents/Temper/docs/testdata/F19_phase14_personalization.csv`

## TDD Case 1 (Uploadthing ingest + lifecycle)
Input:
1. mocked valid Uploadthing signature
2. `file_key` download stub returns `F20_phase15_uploadthing.csv`
3. `run_async=false` for deterministic completion in test

Expected outputs:
1. endpoint returns `202`
2. job metadata includes upload block:
   - `source=uploadthing`
   - `file_key` and `original_filename` echoed
   - `byte_size` and `input_sha256` set
3. summary from completed job is deterministic for F20:
   - `delta_pnl=0.0`
   - `cost_of_bias=0.0`
   - `bias_rates.any_bias_rate=0.0`
4. Supabase upsert history includes `PENDING`, `RUNNING`, `COMPLETED`
5. artifact pointers are written for completed job

## TDD Case 2 (Invalid signature)
Input: bad signature.
Expected outputs:
1. HTTP `401`
2. `error.code=INVALID_UPLOADTHING_SIGNATURE`
3. no job created

## TDD Case 3 (Coach persistence via Supabase)
Input:
1. uploadthing ingest using `F19_phase14_personalization.csv`
2. monkeypatched Vertex function returning valid schema

Expected outputs:
1. `POST /jobs/{id}/coach` returns `200`
2. coach payload has `move_review` length `3`
3. Supabase job row has `coach_status=COMPLETED`
4. Supabase artifacts include `coach_json` pointer

## TDD Case 4 (Vertex real call toggle)
Input: completed job + valid Vertex creds.
Expected outputs:
1. coach generation succeeds
2. coach status persisted

Note:
In CI/local gates, Vertex is monkeypatched for determinism/no-network. Real credential checks remain runtime/deployment validation.
