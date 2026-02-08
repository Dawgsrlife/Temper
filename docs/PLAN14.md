# PLAN14 - Coach (Vertex) TDD

## Goal
Coach augments deterministic facts; never changes them.

## TDD Case 1 (Happy path with strict schema)
Input: completed job from `F01_core_replay.csv`.
Operation: `POST /jobs/{id}/coach` then `GET /jobs/{id}/coach`.
Expected outputs:
1. coach JSON includes `move_review` length `3`
2. each `move_review.metric_refs` matches deterministic values exactly
3. coach artifact exists and is retrievable

## TDD Case 1B (Personalization quality)
Input: completed job from `F04_loss_aversion.csv`.
Expected outputs:
1. coach recommendations include user-relative thresholds (not generic tips)
2. at least one recommendation references detected dominant bias metrics
3. recommendations are actionable (e.g., cooldown, size cap, stop-loss discipline)

## TDD Case 2 (Numeric drift rejection)
Input: same job, mocked Vertex response with changed metric value.
Expected outputs:
1. POST returns `502`
2. `error.code=COACH_GENERATION_FAILED`
3. `coach_error.json` written with drift reason

## TDD Case 3 (Not-ready guard)
Input: pending job.
Expected outputs:
1. `POST /coach` returns `409 JOB_NOT_READY`
