# EXECUTION_CHECKLIST - Final Ship Board

This is the only board to execute from. Do phases in order. Do not skip gate checks.

## Global Rules

- [ ] Do not change engine semantics unless a failing golden test proves a bug.
- [ ] Every code change follows fail-first TDD: failing test -> fix -> passing test.
- [ ] Keep one active branch owner for production changes.
- [ ] Use canonical fixtures in `/Users/vishnu/Documents/Temper/docs/testdata`.

## Fixture Index

- `F01_core_replay.csv` (baseline deterministic mechanics)
- `F02_overtrading_burst.csv` (overtrading episode)
- `F03_revenge_episode.csv` (revenge episode)
- `F04_loss_aversion.csv` (loss-aversion pattern)
- `F05_malformed.csv` (anomaly handling)
- `F06_timeline_dense.csv` (series compaction + chart stability)
- `F07_alias_contract.csv` (upload/job contract)
- `F08_20x_scale_hint.csv` (scale sanity)
- `F09_overtrading_switches.csv` (switching/churn + post-event burst)
- `F10_phase8_scale.csv` (20x-like timeline stress for phase 8)
- `F11_phase8_robust.csv` (anomaly robustness fixture for phase 8)
- `F12_phase9_demo.csv` (judge-demo contract fixture for phase 9)
- `F13_phase10_recording.csv` (recording-readiness contract fixture for phase 10)
- `F14_phase11_heatmap.csv` (heatmap/timeline contract fixture for phase 11)
- `F15_phase12_draw.csv` (phase 12 draw/result baseline)
- `F16_phase12_winner.csv` (phase 12 winner/result baseline)
- `F17_phase12_resign.csv` (phase 12 resign/result baseline)
- `F18_phase13_overtrading.csv` (phase 13 overtrading explanation anchor)
- `F19_phase14_personalization.csv` (phase 14 coach personalization contract)
- `F20_phase15_uploadthing.csv` (phase 15 uploadthing/supabase integration contract)
- `F21_phase16_governance.csv` (phase 16 semantic/payload governance contract)
- `F22_phase17_determinism.csv` (phase 17 fixture-catalog determinism contract)
- `F23_phase18_selector.csv` (phase 18 review-selector diversity contract)
- `F24_phase19_judge.csv` (phase 19 judge-demo script contract fixture)
- `F25_phase20_unseen_scale.csv` (phase 20 final-board unseen scale fixture)

## Phase 0 - Environment + Baseline (15 min)

- [ ] Backend env is loaded
- [ ] Frontend env is loaded
- [ ] Vertex env vars set if coach is in-scope

Commands:
```bash
cd /Users/vishnu/Documents/Temper/backend
source venv/bin/activate
python --version

cd /Users/vishnu/Documents/Temper/frontend
npm --version
```

Pass criteria:
- Python + npm available
- No missing critical env errors at startup

## Phase 1 - Gate Lock (30 min)

- [ ] Run gate suite
- [ ] Resolve failures before any UI work

Commands:
```bash
cd /Users/vishnu/Documents/Temper
# canonical (works with project venv/shim)
bash backend/scripts/run_gate_suite.sh

# optional direct form if environment is configured
pytest backend/tests/gates -q
```

Pass criteria:
- Gate suite green
- No golden drift

## Phase 2 - Backend Truth via HTTP (45 min)

- [ ] Create job from F01
- [ ] Poll to COMPLETED
- [ ] Fetch summary/series/moments/trade

Commands:
```bash
cd /Users/vishnu/Documents/Temper

# 1) create job
curl -s -X POST http://127.0.0.1:8000/jobs \
  -F "file=@/Users/vishnu/Documents/Temper/docs/testdata/F01_core_replay.csv" \
  -F "user_id=demo-user" \
  -F "run_async=false"

# 2) poll status (replace JOB_ID)
curl -s http://127.0.0.1:8000/jobs/JOB_ID

# 3) fetch outputs
curl -s http://127.0.0.1:8000/jobs/JOB_ID/summary
curl -s "http://127.0.0.1:8000/jobs/JOB_ID/counterfactual/series?max_points=2000"
curl -s http://127.0.0.1:8000/jobs/JOB_ID/moments
curl -s http://127.0.0.1:8000/jobs/JOB_ID/trade/3
```

Pass criteria:
- Job reaches `COMPLETED`
- Non-empty `summary`, `series.points`, `moments`
- Trade inspector has `decision`, `reason`, `counterfactual_mechanics`

## Phase 3 - Deterministic Mechanics Validation (30 min)

- [ ] Validate exact F01 expected outputs

Expected values (F01):
- `trade_id=3`: `REVENGE_SIZE_RESCALED`, `effective_scale=0.05`, `simulated_pnl=50.0`
- `trade_id=4`: `LOSS_AVERSION_CAPPED`, `cap_used=2100.0`, `simulated_pnl=-2100.0`
- `trade_id=6`: `OVERTRADING_COOLDOWN_SKIP`, `simulated_pnl=0.0`
- final actual cumulative pnl `-9349.0`
- final replay cumulative pnl `-2499.0`

Commands:
```bash
cd /Users/vishnu/Documents/Temper
pytest backend/tests/gates/test_golden_replay_cases.py -q
```

Pass criteria:
- Golden mechanics tests green

## Phase 4 - Frontend Real Wiring (90 min)

- [ ] Upload page posts to backend job path
- [ ] Analyze page reads backend outputs only
- [ ] No mock/local random scoring in demo path

Commands:
```bash
# terminal 1
cd /Users/vishnu/Documents/Temper/backend
source venv/bin/activate
uvicorn app.main:app --reload --port 8000

# terminal 2
cd /Users/vishnu/Documents/Temper/frontend
npm run dev
```

Manual checks:
- [ ] Upload `F07_alias_contract.csv` from UI
- [ ] Observe polling and transition to completed
- [ ] Summary and moments reflect backend facts

Pass criteria:
- One full UI flow works without page disappearing
- No hidden fallback to mock analyzer

## Phase 5 - Timeline and Moments UX (90 min)

- [ ] Compact timeline renders both curves
- [ ] Markers sync with moments
- [ ] Tooltip shows label/reason/pnl deltas

Test input:
- `F06_timeline_dense.csv`

Checks:
- [ ] `series.points.length > 0`
- [ ] With `max_points=4`, response is bounded and ordered
- [ ] No canvas error state

Commands:
```bash
curl -s "http://127.0.0.1:8000/jobs/JOB_ID/counterfactual/series?max_points=4"
```

Pass criteria:
- Chart remains stable and interactive
- No per-trade horizontal spam navigation

## Phase 6 - Pattern/Episode Validation (45 min)

- [ ] Overtrading as episode (not isolated label spam)
- [ ] Revenge as episode with anchor trade
- [ ] Loss aversion as session-level pattern + exemplars

Test inputs:
- `F02_overtrading_burst.csv`
- `F03_revenge_episode.csv`
- `F04_loss_aversion.csv`
- `F09_overtrading_switches.csv`

Pass criteria:
- Distinct episode outputs exist
- Explanations include thresholded evidence

## Phase 7 - Coach (Vertex) Post-Hoc (60 min)

- [ ] Generate coach for completed job
- [ ] Verify move_review length=3
- [ ] Verify numeric refs unchanged
- [ ] Structured failure shown if unavailable

Commands:
```bash
curl -s -X POST http://127.0.0.1:8000/jobs/JOB_ID/coach
curl -s http://127.0.0.1:8000/jobs/JOB_ID/coach
```

Pass criteria:
- Coach success OR explicit `COACH_GENERATION_FAILED`
- No silent blank coach UI

## Phase 8 - Robustness and Scale Sanity (45 min)

- [ ] Malformed input handled safely
- [ ] 20x-style timeline still bounded

Test inputs:
- `F05_malformed.csv`
- extended copy of `F08_20x_scale_hint.csv`

Commands:
```bash
pytest backend/tests/gates/test_gate_data_robustness.py -q
```

Pass criteria:
- Deterministic anomaly counts
- No crashes
- Bounded series response for large runs

## Phase 9 - Judge Demo Script (30 min)

- [ ] Run one-command demo path
- [ ] Validate printed essentials

Commands:
```bash
bash /Users/vishnu/Documents/Temper/backend/scripts/judge_demo.sh
```

Expected printed highlights:
- job id + terminal status
- headline/outcome
- delta_pnl + cost_of_bias
- bias rates + non-zero badge counts
- top 3 move explanations
- coach plan titles

Pass criteria:
- Script exits `0` on baseline fixture
- Script exits non-zero with structured error on malformed path

## Phase 10 - Recording Readiness TDD (30 min)

- [ ] Run Phase 10 gate fixture (`F13`)
- [ ] Verify summary/timeline/moments/trade/coach/history payloads
- [ ] Verify one personalized recommendation with deterministic metric refs

Commands:
```bash
bash /Users/vishnu/Documents/Temper/backend/scripts/run_gate_suite.sh
```

Pass criteria (from `F13_phase10_recording.csv`):
- headline=`WINNER`
- delta_pnl=`3220.0`, cost_of_bias=`3220.0`
- loss_aversion_rate=`0.2`
- top moment=`MEGABLUNDER` on `GOOG` with `impact=2860.0`
- `/counterfactual/series?max_points=5` returns exactly 5 points
- first point=`2025-03-14T09:00:00` (100.0 vs 100.0)
- last point=`2025-03-14T09:17:00` (-2330.0 vs 890.0)
- coach move_review length=3
- history returns created job id

## Phase 11 - Heatmap Contract TDD (30 min)

- [ ] Run Phase 11 fixture (`F14`) through full API path
- [ ] Verify hourly heatmap cells and totals
- [ ] Verify compact series compatibility

Pass criteria (from `F14_phase11_heatmap.csv`):
- summary delta/cost both `1180.0`
- loss_aversion_rate `2/7`
- heatmap `total_cells=3` (09h, 10h, 11h buckets)
- 09h: trades=3, modified=1, bias=1, actual=-530.0, replay=-90.0, impact=440.0
- 10h: trades=2, modified=1, bias=1, actual=-820.0, replay=-80.0, impact=740.0
- 11h: trades=2, modified=0, bias=0, actual=50.0, replay=50.0, impact=0.0
- totals: trades=7, modified=2, bias=2, actual=-1300.0, replay=-120.0, impact=1180.0

## Phase 12 - Grade and ELO Contract TDD (30 min)

- [ ] Run F15/F16/F17 sequence for one user
- [ ] Verify per-session result labels and deltas
- [ ] Verify per-job ELO mapping endpoint + history progression

Pass criteria:
- F15 summary: `DRAW`, `delta_pnl=0.0`, top label `INACCURACY`, `/jobs/{id}/elo.delta=+4.0`
- F16 summary: `WINNER`, `delta_pnl=2880.0`, top label `MEGABLUNDER`, `/jobs/{id}/elo.delta=+8.0`
- F17 summary: `RESIGN`, `delta_pnl=-522.0`, top label `MISS`, `/jobs/{id}/elo.delta=-8.0`
- `/api/history` for the same user:
  - 3 reports
  - current rating `1204.0`
  - peak rating `1212.0`
  - sessions played `3`

## Phase 13 - Deterministic Move Explanations TDD (30 min)

- [ ] Run fixtures for revenge/overtrading/loss-aversion explanation anchors
- [ ] Verify exact deterministic explanation text + numeric rule-hit evidence
- [ ] Verify dedicated deterministic move review endpoint

Pass criteria:
- F17 top moment explanation:
  - `You just had a big loss (-$500.00) and increased size to +$600,000.00, so replay scaled exposure to 2.0000%.`
  - `prev_trade_pnl=-500.0`, `minutes_since_prev_trade=2.0`, `size_multiplier=12.0`
- F18 top moment explanation:
  - `You were trading far more frequently than normal, so this trade was skipped during cooldown (details: 205 trades in last hour, threshold: 200).`
  - `rolling_trade_count_1h=205.0`, `overtrading_trade_threshold=200`
- F04 top moment explanation:
  - `This loss was much larger than your typical win, so replay kept the same price move but scaled exposure to 7.000000% to cap downside near -$140.00.`
  - `median_win_pnl=35.0`, `loss_cap_value=140.0`, `loss_abs_pnl=2000.0`
- `/jobs/{id}/move-review` returns 3 deterministic rows with metric refs

Narration line (use exactly):
`We detect behavioral patterns deterministically, replay the same history under explicit guardrails, and show receipts per move. The coach is post-hoc and cannot alter facts.`

## Phase 14 - Coach Personalization + Drift Guard TDD (30 min)

- [ ] Run `F19_phase14_personalization.csv` through full job pipeline
- [ ] Assert coach prompt carries deterministic personalization metrics
- [ ] Assert LLM output is rejected on metric drift
- [ ] Assert not-ready jobs are guarded with 409

Pass criteria:
- `POST /jobs/{id}/coach` succeeds with mocked Vertex when payload includes:
  - `derived_stats` (including `trades_per_hour_p95`)
  - `thresholds` (including `loss_abs_p85`)
- Coach response includes `move_review` length `3` unchanged from deterministic payload
- Drifted `move_review.metric_refs.value` is rejected:
  - `POST` returns `502 COACH_GENERATION_FAILED`
  - `GET /jobs/{id}/coach` returns `409 COACH_FAILED`
- Not-ready job returns `409 JOB_NOT_READY`

## Phase 15 - Uploadthing + Supabase + Vertex Seams TDD (30 min)

- [ ] Validate uploadthing ingest contract with real CSV fixture
- [ ] Validate signature rejection path
- [ ] Validate supabase lifecycle + artifact dual-write
- [ ] Validate coach status persistence after generation

Pass criteria:
- `POST /jobs/from-uploadthing` on `F20_phase15_uploadthing.csv` returns `202`
- upload metadata present: `source`, `file_key`, `original_filename`, `byte_size`, `input_sha256`
- completed F20 summary is deterministic:
  - `delta_pnl=0.0`
  - `cost_of_bias=0.0`
  - `bias_rates.any_bias_rate=0.0`
- invalid signature returns:
  - `401`
  - `error.code=INVALID_UPLOADTHING_SIGNATURE`
- Supabase upsert lifecycle includes `PENDING`, `RUNNING`, `COMPLETED`
- `POST /jobs/{id}/coach` (F19 fixture + stubbed Vertex) returns `200`
- Supabase row for that job has `coach_status=COMPLETED`
- Supabase artifact pointers include `coach_json`

## Phase 16 - CI Governance + Contract Freeze TDD (20 min)

- [ ] Validate semantic reason strings on real CSV fixture
- [ ] Validate moments/trade payload shape freeze on real CSV fixture
- [ ] Validate golden change policy artifact exists

Pass criteria:
- F21 summary remains deterministic:
  - `headline=WINNER`
  - `delta_pnl=6210.0`
  - `cost_of_bias=6210.0`
  - `loss_aversion_rate=0.25`
- `/jobs/{id}/trade/3` deterministic contract:
  - `reason=LOSS_AVERSION_CAPPED`
  - `reason_label=Loss aversion (downside capped)`
  - `counterfactual_mechanics.scale_factor=0.02`
  - `counterfactual.actual_pnl=-6000.0`
  - `counterfactual.simulated_pnl=-120.0`
- `/jobs/{id}/moments` includes shape-critical keys:
  - `decision`, `reason`, `reason_label`, `counterfactual_mechanics`, `evidence`, `explanation_human`
- `docs/GOLDEN_CHANGE_POLICY.md` exists and enforces fail-first -> fix -> golden update in same PR

## Phase 17 - Fixture Catalog + Determinism Audit TDD (20 min)

- [ ] Validate core fixture matrix (F01-F08) with expected outcomes
- [ ] Validate malformed fixture failure contract (`F05`)
- [ ] Validate repeated-run determinism on F22
- [ ] Validate fixture catalog document exists

Pass criteria:
- F01-F08 expected statuses/headlines/delta values are stable:
  - F01 `WINNER`, `delta_pnl=9900.0`
  - F02 `DRAW`, `delta_pnl=0.0`
  - F03 `DRAW`, `delta_pnl=0.0`
  - F04 `WINNER`, `delta_pnl=1860.0`
  - F06/F07/F08 `DRAW`, `delta_pnl=0.0`
- F05 contract:
  - job status `FAILED`
  - summary returns `headline=None`, `delta_pnl=0.0`
  - moments endpoint returns `409 COUNTERFACTUAL_NOT_READY`
- F22 determinism contract:
  - summary equality across two runs
  - moments equality across two runs
  - artifact hash equality for `counterfactual.csv` and `review.json`
- `docs/FIXTURE_CATALOG.md` exists and includes F01, F05, F08, F22

## Phase 18 - Review Selector + Signal Compression TDD (20 min)

- [ ] Validate diversity-first top moments on real mixed-bias fixture
- [ ] Validate deterministic inspector anchor contract
- [ ] Validate human-first explanation + evidence payload
- [ ] Validate selector policy document exists

Pass criteria:
- For `F23_phase18_selector.csv`, `/jobs/{id}/moments` returns exactly 3 moments with:
  - bias categories in deterministic order: `revenge`, `overtrading`, `loss_aversion`
  - no repetitive overtrading-only set when other categories exist
- First moment anchor is deterministic:
  - use `trace_trade_id`
  - `/jobs/{id}/trade/{trace_trade_id}` matches the first moment asset/timestamp
- Human-first explanation contract:
  - `explanation_human` is non-empty
  - no quantile jargon (`p95`, `p85`) in first-line explanation text
  - `evidence.rule_signature` and `evidence.metric_refs` are present
- `docs/REVIEW_SELECTOR_POLICY.md` exists and defines diversity selection policy

## Phase 19 - Judge Demo Script Contract TDD (20 min)

- [ ] Validate happy-path HTTP walkthrough with real fixture
- [ ] Validate malformed-file failure behavior
- [ ] Validate script output contract lines

Pass criteria:
- For `F24_phase19_judge.csv`:
  - summary `headline=WINNER`
  - `delta_pnl=66.0`
  - top moment is `MEGABLUNDER` on `GOOG`
  - first inspector reason is `LOSS_AVERSION_CAPPED`
  - coach returns plan title + move_review metric refs
- For `F05_malformed.csv`:
  - terminal status `FAILED`
  - structured `error_type=ValueError`
  - `error_message` includes timestamp parse failure
- `backend/scripts/judge_demo.sh` prints:
  - `personalized_evidence: ...`
  - `error_type: ...`
  - `error_message: ...`

## Phase 20 - Final Rubric Gate TDD (20 min)

- [ ] Validate behavioral rubric demonstration on mixed-bias fixture
- [ ] Validate unseen scale fixture completion + bounded timeline
- [ ] Validate final board docs include phase-20 fixture contracts

Pass criteria:
- `F23_phase18_selector.csv` demonstrates all three required biases in representative moments:
  - categories: `revenge`, `overtrading`, `loss_aversion`
- `F25_phase20_unseen_scale.csv` completes successfully and remains bounded:
  - summary `headline=WINNER`
  - `delta_pnl=5676.603000000003`
  - `/counterfactual/series?max_points=2000` returns exactly 2000 points
  - series first/last timestamps:
    - `2025-03-25T09:00:00`
    - `2025-03-25T22:19:40`
- Docs contain final-board contracts:
  - `docs/PLAN20.md` references `F23_phase18_selector.csv`
  - `docs/PLAN20.md` references `F25_phase20_unseen_scale.csv`
  - this checklist contains `Phase 20 - Final Rubric Gate TDD`

## Final Go/No-Go

Ship only if all are checked:
- [ ] Gates green
- [ ] End-to-end upload flow works in UI
- [ ] Timeline stable with markers
- [ ] Moments + inspector explanations are evidence-backed
- [ ] Coach is visible (success or structured failure)
- [ ] No runtime crash
