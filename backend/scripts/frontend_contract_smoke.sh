#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"
USER_ID="${USER_ID:-demo-user}"
INPUT_CSV="${INPUT_CSV:-/Users/vishnu/Documents/Temper/docs/testdata/F24_phase19_judge.csv}"
RUN_ASYNC="${RUN_ASYNC:-false}"
ALLOW_COACH_FAILURE="${ALLOW_COACH_FAILURE:-1}"

if [[ ! -f "${INPUT_CSV}" ]]; then
  echo "missing INPUT_CSV: ${INPUT_CSV}" >&2
  exit 1
fi

if ! curl -fsS "${BASE_URL}/health" >/dev/null; then
  echo "backend health check failed: ${BASE_URL}/health" >&2
  exit 1
fi

CREATE_JSON="$(curl -fsS -X POST "${BASE_URL}/jobs" \
  -F "file=@${INPUT_CSV}" \
  -F "user_id=${USER_ID}" \
  -F "run_async=${RUN_ASYNC}")"

JOB_ID="$(python3 - "${CREATE_JSON}" <<'PY'
import json,sys
payload=json.loads(sys.argv[1])
if not payload.get("ok"):
    raise SystemExit(f"job creation failed: {json.dumps(payload)}")
job=(payload.get("job") or {})
job_id=job.get("job_id")
if not job_id:
    raise SystemExit(f"missing job_id: {json.dumps(payload)}")
print(job_id)
PY
)"

echo "job_id=${JOB_ID}"

STATUS_JSON="$(curl -fsS "${BASE_URL}/jobs/${JOB_ID}")"
python3 - "${STATUS_JSON}" <<'PY'
import json,sys
p=json.loads(sys.argv[1])
assert p.get("ok") is True, p
job=p.get("job") or {}
assert job.get("execution_status") in {"PENDING","RUNNING","COMPLETED","FAILED","TIMEOUT"}, p
print("status_ok=1")
PY

SUMMARY_JSON="$(curl -fsS "${BASE_URL}/jobs/${JOB_ID}/summary")"
python3 - "${SUMMARY_JSON}" <<'PY'
import json,sys
p=json.loads(sys.argv[1])
assert p.get("ok") is True, p
d=p.get("data") or {}
for key in ("headline","delta_pnl","cost_of_bias","bias_rates","badge_counts"):
    assert key in d, (key,p)
print("summary_ok=1")
PY

SERIES_JSON="$(curl -fsS "${BASE_URL}/jobs/${JOB_ID}/counterfactual/series?max_points=500")"
python3 - "${SERIES_JSON}" <<'PY'
import json,sys
p=json.loads(sys.argv[1])
assert p.get("ok") is True, p
d=p.get("data") or {}
points=d.get("points") or []
assert isinstance(points,list) and len(points)>0, p
first=points[0]
for key in ("timestamp","actual_equity","simulated_equity","policy_replay_equity"):
    assert key in first, (key,first)
assert "metrics" in d, p
print("series_ok=1")
PY

MOMENTS_JSON="$(curl -fsS "${BASE_URL}/jobs/${JOB_ID}/moments")"
python3 - "${MOMENTS_JSON}" <<'PY'
import json,sys
p=json.loads(sys.argv[1])
assert p.get("ok") is True, p
d=p.get("data") or {}
moments=d.get("moments") or []
assert isinstance(moments,list), p
if moments:
    m=moments[0]
    for key in ("timestamp","asset","impact_abs","blocked_reason"):
        assert key in m, (key,m)
print("moments_ok=1")
PY

TRACE_ID="$(python3 - "${MOMENTS_JSON}" <<'PY'
import json,sys
p=json.loads(sys.argv[1])
moments=((p.get("data") or {}).get("moments") or [])
if moments and isinstance(moments[0],dict) and moments[0].get("trace_trade_id") is not None:
    print(int(moments[0]["trace_trade_id"]))
else:
    print(0)
PY
)"

TRADE_JSON="$(curl -fsS "${BASE_URL}/jobs/${JOB_ID}/trade/${TRACE_ID}")"
python3 - "${TRADE_JSON}" <<'PY'
import json,sys
p=json.loads(sys.argv[1])
assert p.get("ok") is True, p
t=((p.get("data") or {}).get("trade") or {})
for key in ("raw_input_row","derived_flags","decision","counterfactual","counterfactual_mechanics","evidence"):
    assert key in t, (key,t)
print("trade_ok=1")
PY

COACH_POST_JSON="$(curl -sS -X POST "${BASE_URL}/jobs/${JOB_ID}/coach")"
python3 - "${COACH_POST_JSON}" "${ALLOW_COACH_FAILURE}" <<'PY'
import json,sys
p=json.loads(sys.argv[1])
allow_fail=sys.argv[2]=="1"
if p.get("ok") is True:
    print("coach_post_ok=1")
    raise SystemExit(0)
if allow_fail:
    print("coach_post_ok=0 (allowed)")
    raise SystemExit(0)
raise SystemExit(f"coach generation failed: {json.dumps(p)}")
PY

COACH_GET_JSON="$(curl -sS "${BASE_URL}/jobs/${JOB_ID}/coach")"
python3 - "${COACH_GET_JSON}" "${ALLOW_COACH_FAILURE}" <<'PY'
import json,sys
p=json.loads(sys.argv[1])
allow_fail=sys.argv[2]=="1"
if p.get("ok") is True:
    print("coach_get_ok=1")
    raise SystemExit(0)
if allow_fail:
    err=p.get("error") or {}
    code=err.get("code")
    assert code in {"COACH_FAILED","COACH_NOT_FOUND","JOB_NOT_READY"}, p
    print("coach_get_ok=0 (allowed)")
    raise SystemExit(0)
raise SystemExit(f"coach fetch failed: {json.dumps(p)}")
PY

HISTORY_JSON="$(curl -fsS "${BASE_URL}/users/${USER_ID}/jobs?limit=10")"
python3 - "${HISTORY_JSON}" <<'PY'
import json,sys
p=json.loads(sys.argv[1])
assert p.get("ok") is True, p
d=p.get("data") or {}
jobs=d.get("jobs") or []
assert isinstance(jobs,list), p
print("history_ok=1")
PY

# Legacy alias checks for dashboard compatibility
ALIAS_UPLOAD_JSON="$(curl -fsS -X POST "${BASE_URL}/api/upload" \
  -F "file=@${INPUT_CSV}" \
  -F "user_id=${USER_ID}" \
  -F "run_async=false")"

ALIAS_JOB_ID="$(python3 - "${ALIAS_UPLOAD_JSON}" <<'PY'
import json,sys
p=json.loads(sys.argv[1])
job_id=p.get("jobId")
if not job_id:
    raise SystemExit(f"/api/upload missing jobId: {json.dumps(p)}")
print(job_id)
PY
)"

ALIAS_STATUS_JSON="$(curl -fsS "${BASE_URL}/api/jobs/${ALIAS_JOB_ID}")"
python3 - "${ALIAS_STATUS_JSON}" <<'PY'
import json,sys
p=json.loads(sys.argv[1])
assert "status" in p and "jobId" in p, p
print("alias_status_ok=1")
PY

ALIAS_ANALYZE_JSON="$(curl -fsS -X POST "${BASE_URL}/api/analyze" \
  -H "content-type: application/json" \
  --data "{\"jobId\":\"${ALIAS_JOB_ID}\"}")"
python3 - "${ALIAS_ANALYZE_JSON}" <<'PY'
import json,sys
p=json.loads(sys.argv[1])
assert "status" in p and "jobId" in p, p
print("alias_analyze_ok=1")
PY

ALIAS_HISTORY_JSON="$(curl -fsS "${BASE_URL}/api/history?userId=${USER_ID}&limit=5")"
python3 - "${ALIAS_HISTORY_JSON}" <<'PY'
import json,sys
p=json.loads(sys.argv[1])
assert "reports" in p and "currentRating" in p, p
print("alias_history_ok=1")
PY

echo "frontend_contract_smoke.sh PASS"
