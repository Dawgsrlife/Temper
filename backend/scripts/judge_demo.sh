#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"
USER_ID="${USER_ID:-}"
FILE_KEY="${FILE_KEY:-}"
UPLOADTHING_SIGNATURE="${UPLOADTHING_SIGNATURE:-}"
ORIGINAL_FILENAME="${ORIGINAL_FILENAME:-judge.csv}"
POLL_SECONDS="${POLL_SECONDS:-60}"
POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS:-0.5}"

if [[ -z "${USER_ID}" || -z "${FILE_KEY}" || -z "${UPLOADTHING_SIGNATURE}" ]]; then
  echo "missing required env vars: USER_ID, FILE_KEY, UPLOADTHING_SIGNATURE" >&2
  exit 1
fi

if ! curl -fsS "${BASE_URL}/health" >/dev/null; then
  echo "backend health check failed at ${BASE_URL}/health" >&2
  exit 1
fi

CREATE_JSON="$(curl -fsS -X POST "${BASE_URL}/jobs/from-uploadthing" \
  -H "content-type: application/json" \
  -H "x-uploadthing-signature: ${UPLOADTHING_SIGNATURE}" \
  --data "$(python3 - "${USER_ID}" "${FILE_KEY}" "${ORIGINAL_FILENAME}" <<'PY'
import json,sys
print(json.dumps({
    "user_id": sys.argv[1],
    "file_key": sys.argv[2],
    "original_filename": sys.argv[3],
    "run_async": True,
}))
PY
)")"

JOB_ID="$(python3 - "${CREATE_JSON}" <<'PY'
import json,sys
payload=json.loads(sys.argv[1])
if not payload.get("ok"):
    raise SystemExit(f"job creation failed: {payload}")
job_id=payload.get("job",{}).get("job_id")
if not job_id:
    raise SystemExit(f"missing job_id: {payload}")
print(job_id)
PY
)"

echo "job_id: ${JOB_ID}"

TERMINAL_STATUS=""
JOB_JSON="{}"
DEADLINE="$(python3 - "${POLL_SECONDS}" <<'PY'
import sys,time
print(time.time() + float(sys.argv[1]))
PY
)"
while true; do
  NOW="$(python3 - <<'PY'
import time
print(time.time())
PY
)"
  if python3 - "${NOW}" "${DEADLINE}" <<'PY'
import sys
raise SystemExit(0 if float(sys.argv[1]) <= float(sys.argv[2]) else 1)
PY
  then
    :
  else
    echo "poll timeout after ${POLL_SECONDS}s" >&2
    exit 1
  fi

  JOB_JSON="$(curl -fsS "${BASE_URL}/jobs/${JOB_ID}")"
  TERMINAL_STATUS="$(python3 - "${JOB_JSON}" <<'PY'
import json,sys
payload=json.loads(sys.argv[1])
if not payload.get("ok"):
    raise SystemExit(f"/jobs/{payload.get('job',{}).get('job_id')} failed: {payload}")
print(payload["job"]["execution_status"])
PY
)"
  echo "status: ${TERMINAL_STATUS}"
  case "${TERMINAL_STATUS}" in
    COMPLETED|FAILED|TIMEOUT)
      break
      ;;
  esac
  sleep "${POLL_INTERVAL_SECONDS}"
done

if [[ "${TERMINAL_STATUS}" != "COMPLETED" ]]; then
  echo "job did not complete successfully: ${TERMINAL_STATUS}" >&2
  echo "${JOB_JSON}" >&2
  exit 1
fi

SUMMARY_JSON="$(curl -fsS "${BASE_URL}/jobs/${JOB_ID}/summary")"
REVIEW_JSON="$(curl -fsS "${BASE_URL}/jobs/${JOB_ID}/review")"

python3 - "${SUMMARY_JSON}" "${JOB_JSON}" <<'PY'
import json,sys
payload=json.loads(sys.argv[1])
job_payload=json.loads(sys.argv[2])
if not payload.get("ok"):
    raise SystemExit(f"summary failed: {payload}")
data=payload["data"]
badge_counts=data.get("badge_counts",{}) or {}
badge_counts_nonzero={k:v for k,v in badge_counts.items() if isinstance(v,(int,float)) and v}
print("headline:", data.get("headline"))
print("outcome:", job_payload.get("data",{}).get("outcome"))
print("delta_pnl:", data.get("delta_pnl"))
print("cost_of_bias:", data.get("cost_of_bias"))
print("bias_rates:", json.dumps(data.get("bias_rates",{}), sort_keys=True))
print("badge_counts_nonzero:", json.dumps(badge_counts_nonzero, sort_keys=True))
PY

COACH_POST_JSON="$(curl -sS -X POST "${BASE_URL}/jobs/${JOB_ID}/coach")"
COACH_POST_STATUS="$(python3 - "${COACH_POST_JSON}" <<'PY'
import json,sys
payload=json.loads(sys.argv[1])
print("200" if payload.get("ok") else str(payload.get("error",{}).get("code","UNKNOWN")))
PY
)"
if [[ "${COACH_POST_STATUS}" != "200" ]]; then
  echo "coach generation failed: ${COACH_POST_JSON}" >&2
  exit 1
fi

COACH_GET_JSON="$(curl -fsS "${BASE_URL}/jobs/${JOB_ID}/coach")"

python3 - "${COACH_GET_JSON}" "${REVIEW_JSON}" <<'PY'
import json,sys
coach_payload=json.loads(sys.argv[1])
review_payload=json.loads(sys.argv[2])
if not coach_payload.get("ok"):
    raise SystemExit(f"coach fetch failed: {coach_payload}")
coach=coach_payload.get("data",{}).get("coach",{}) or {}
plan=coach.get("plan",[]) or []
print("plan_titles:")
for item in plan:
    title=item.get("title")
    if title:
        print(" -", title)

move_review=coach.get("move_review",[]) or []
if move_review:
    print("move_review_top3:")
    for row in move_review[:3]:
        print(
            " -",
            f"{row.get('label')} | {row.get('timestamp')} | {row.get('asset')} | {row.get('explanation')}",
        )
else:
    review=review_payload.get("data",{}).get("review",{}) if review_payload.get("ok") else {}
    print("move_review_top3 (fallback from review):")
    for moment in (review.get("top_moments",[]) or [])[:3]:
        label=moment.get("label") or moment.get("trade_grade")
        ts=moment.get("timestamp")
        asset=moment.get("asset")
        actual=moment.get("actual_pnl")
        simulated=moment.get("simulated_pnl")
        impact=moment.get("impact") if "impact" in moment else moment.get("impact_abs")
        explanation=f"Actual pnl {actual} vs simulated {simulated}; impact {impact}."
        print(" -", f"{label} | {ts} | {asset} | {explanation}")
PY

HISTORY_JSON="$(curl -fsS "${BASE_URL}/users/${USER_ID}/jobs?limit=1")"
python3 - "${HISTORY_JSON}" <<'PY'
import json,sys
payload=json.loads(sys.argv[1])
if not payload.get("ok"):
    raise SystemExit(f"history fetch failed: {payload}")
jobs=payload.get("data",{}).get("jobs",[]) or []
if not jobs:
    raise SystemExit("history returned no jobs")
print("newest_job_row:", json.dumps(jobs[0], sort_keys=True))
PY

echo "judge_demo.sh PASS"
