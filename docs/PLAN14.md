# PLAN14 - Coach Personalization (Vertex) TDD

## Goal
Keep coach post-hoc, schema-locked, and metric-faithful:
1. Coach cannot alter deterministic move facts.
2. Coach prompt must include user-relative metrics from deterministic artifacts.
3. Numeric drift in `move_review.metric_refs` must fail closed.

## Fixture
`/Users/vishnu/Documents/Temper/docs/testdata/F19_phase14_personalization.csv`

## TDD Case 1 (Happy path + personalization quality)
Input:
1. Create completed job from `F19_phase14_personalization.csv`.
2. Monkeypatch Vertex function to:
   - assert payload includes `derived_stats` and `thresholds`
   - assert keys `trades_per_hour_p95` and `loss_abs_p85` exist
   - return valid coach schema using those metrics in plan text.

Operation:
1. `POST /jobs/{id}/coach`
2. `GET /jobs/{id}/coach`

Expected outputs:
1. POST status `200`
2. coach contains `move_review` length `3`
3. returned `move_review` equals deterministic pre-LLM payload
4. plan text references user-relative metrics (hourly cadence + loss cap)
5. GET returns the same coach artifact

## TDD Case 2 (Numeric drift rejection)
Input:
1. Same completed F19 job.
2. Monkeypatch Vertex to change one `move_review.metric_refs.value`.

Operation:
1. `POST /jobs/{id}/coach`
2. `GET /jobs/{id}/coach`

Expected outputs:
1. POST status `502`
2. `error.code=COACH_GENERATION_FAILED`
3. error message indicates metric drift
4. GET status `409`, `error.code=COACH_FAILED`
5. `coach_error.json` exists with structured failure payload

## TDD Case 3 (Not-ready guard)
Input:
1. Synthetic `RUNNING` job record.

Operation:
1. `POST /jobs/{id}/coach`

Expected outputs:
1. status `409`
2. `error.code=JOB_NOT_READY`

## Implementation Contract (Minimal)
Required prompt fields in `_coach_prompt_payload`:
1. `derived_stats` from `review.derived_stats`
2. `thresholds` from `review.labeling_rules.thresholds`
3. deterministic `move_review` from backend renderer

No engine/detector/counterfactual formula changes are allowed in this phase.
