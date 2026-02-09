# PLAN12 - Grade and ELO Contract TDD

## Goal
Lock deterministic chess/result labels and ELO progression using real CSV fixtures and API outputs.

## Fixture Inputs
- `docs/testdata/F15_phase12_draw.csv`
- `docs/testdata/F16_phase12_winner.csv`
- `docs/testdata/F17_phase12_resign.csv`

All three are uploaded for the same user in chronological order.

## TDD Case 1 - Result labels per session
Input:
1. `POST /jobs` for each fixture with `run_async=false`
2. `GET /jobs/{job_id}/summary`

Expected outputs:
1. `F15`: `headline == DRAW`, `delta_pnl == 0.0`, top label `INACCURACY`
2. `F16`: `headline == WINNER`, `delta_pnl == 2880.0`, top label `MEGABLUNDER`
3. `F17`: `headline == RESIGN`, `delta_pnl == -522.0`, top label `MISS`

## TDD Case 2 - Per-job ELO mapping endpoint
Input:
1. `GET /jobs/{job_id}/elo`

Expected outputs:
1. endpoint exists and returns `200`
2. deterministic ELO values:
   - `F15 DRAW -> delta +4.0`
   - `F16 WINNER -> delta +8.0`
   - `F17 RESIGN -> delta -8.0`
3. payload includes:
   - `outcome`
   - `delta_pnl`
   - `badge_counts`
   - `elo.base`, `elo.delta`, `elo.projected`

## TDD Case 3 - Cross-session history ELO progression
Input:
1. `GET /api/history?userId=phase12-user&limit=10`

Expected outputs:
1. exactly 3 reports
2. per-session deltas match fixtures (`+4.0`, `+8.0`, `-8.0`)
3. current rating:
   - `rating == 1204.0`
   - `peakRating == 1212.0`
   - `sessionsPlayed == 3`

## Implementation anchor
- Gate test: `backend/tests/gates/test_gate_phase12_grade_elo_contract.py`
- New endpoint: `GET /jobs/{job_id}/elo`
- Canonical runner: `bash backend/scripts/run_gate_suite.sh`
