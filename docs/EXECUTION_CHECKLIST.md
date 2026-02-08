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

Narration line (use exactly):
`We detect behavioral patterns deterministically, replay the same history under explicit guardrails, and show receipts per move. The coach is post-hoc and cannot alter facts.`

## Final Go/No-Go

Ship only if all are checked:
- [ ] Gates green
- [ ] End-to-end upload flow works in UI
- [ ] Timeline stable with markers
- [ ] Moments + inspector explanations are evidence-backed
- [ ] Coach is visible (success or structured failure)
- [ ] No runtime crash
