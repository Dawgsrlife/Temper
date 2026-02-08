# PLAN15 - Uploadthing/Supabase/Vertex Integration TDD

## Goal
Integrate required services as thin seams around deterministic core.

## TDD Case 1 (Uploadthing ingest)
Input: mocked valid Uploadthing signature + `file_key` resolving to `F07_alias_contract.csv` bytes.
Expected outputs:
1. endpoint returns `202`
2. job metadata includes upload block with `source=uploadthing`
3. computed `input_sha256` present

## TDD Case 2 (Invalid signature)
Input: bad signature.
Expected outputs:
1. HTTP `401`
2. `error.code=INVALID_UPLOADTHING_SIGNATURE`
3. no job created

## TDD Case 3 (Supabase lifecycle dual-write)
Input: run job from `F01_core_replay.csv` with mocked Supabase client.
Expected outputs:
1. status transitions `PENDING->RUNNING->COMPLETED`
2. summary fields written to jobs row
3. artifact pointers written to job_artifacts row(s)

## TDD Case 4 (Vertex real call toggle)
Input: completed job + valid Vertex creds.
Expected outputs:
1. coach generation succeeds
2. coach status persisted
