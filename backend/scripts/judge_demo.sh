#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"
USER_ID="${USER_ID:-demo-user}"
INPUT_CSV="${INPUT_CSV:-/Users/vishnu/Documents/Temper/docs/testdata/F12_phase9_demo.csv}"
RUN_ASYNC="${RUN_ASYNC:-true}"
POLL_SECONDS="${POLL_SECONDS:-90}"
POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS:-0.5}"
ALLOW_COACH_FAILURE="${ALLOW_COACH_FAILURE:-0}"

# Optional uploadthing mode
USE_UPLOADTHING="${USE_UPLOADTHING:-0}"
FILE_KEY="${FILE_KEY:-}"
UPLOADTHING_SIGNATURE="${UPLOADTHING_SIGNATURE:-}"
ORIGINAL_FILENAME="${ORIGINAL_FILENAME:-judge.csv}"

if ! curl -fsS "${BASE_URL}/health" >/dev/null; then
  echo "backend health check failed at ${BASE_URL}/health" >&2
  exit 1
fi

create_job_csv() {
  if [[ ! -f "${INPUT_CSV}" ]]; then
    echo "missing INPUT_CSV: ${INPUT_CSV}" >&2
    exit 1
  fi

  curl -fsS -X POST "${BASE_URL}/jobs" \
    -F "file=@${INPUT_CSV}" \
    -F "user_id=${USER_ID}" \
    -F "run_async=${RUN_ASYNC}"
}

create_job_uploadthing() {
  if [[ -z "${FILE_KEY}" || -z "${UPLOADTHING_SIGNATURE}" ]]; then
    echo "missing required env vars for uploadthing mode: FILE_KEY, UPLOADTHING_SIGNATURE" >&2
    exit 1
  fi

  curl -fsS -X POST "${BASE_URL}/jobs/from-uploadthing" \
    -H "content-type: application/json" \
    -H "x-uploadthing-signature: ${UPLOADTHING_SIGNATURE}" \
    --data "$(python3 - "${USER_ID}" "${FILE_KEY}" "${ORIGINAL_FILENAME}" "${RUN_ASYNC}" <<'PY'
import json,sys
print(json.dumps({
    "user_id": sys.argv[1],
    "file_key": sys.argv[2],
    "original_filename": sys.argv[3],
    "run_async": str(sys.argv[4]).lower() == 'true',
}))
PY
)"
}

if [[ "${USE_UPLOADTHING}" == "1" ]]; then
  CREATE_JSON="$(create_job_uploadthing)"
else
  CREATE_JSON="$(create_job_csv)"
fi

JOB_ID="$(python3 - "${CREATE_JSON}" <<'PY'
import json,sys
payload=json.loads(sys.argv[1])
if not payload.get('ok'):
    raise SystemExit(f"job creation failed: {json.dumps(payload)}")
job=payload.get('job') or {}
job_id=job.get('job_id')
if not job_id:
    raise SystemExit(f"missing job_id in response: {json.dumps(payload)}")
print(job_id)
PY
)"

echo "job_id: ${JOB_ID}"

TERMINAL_STATUS=""
JOB_JSON="{}"
DEADLINE="$(python3 - "${POLL_SECONDS}" <<'PY'
import sys,time
print(time.time()+float(sys.argv[1]))
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
if not payload.get('ok'):
    raise SystemExit(f"/jobs failed: {json.dumps(payload)}")
job=payload.get('job') or {}
print(job.get('execution_status'))
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
  python3 - "${JOB_JSON}" <<'PY' >&2
import json,sys
payload=json.loads(sys.argv[1])
data=payload.get('data') or {}
print('error_type:', data.get('error_type'))
print('error_message:', data.get('error_message'))
PY
  echo "${JOB_JSON}" >&2
  exit 1
fi

SUMMARY_JSON="$(curl -fsS "${BASE_URL}/jobs/${JOB_ID}/summary")"
REVIEW_JSON="$(curl -fsS "${BASE_URL}/jobs/${JOB_ID}/review")"

python3 - "${SUMMARY_JSON}" "${REVIEW_JSON}" "${JOB_JSON}" <<'PY'
import json,sys
summary_payload=json.loads(sys.argv[1])
review_payload=json.loads(sys.argv[2])
job_payload=json.loads(sys.argv[3])
if not summary_payload.get('ok'):
    raise SystemExit(f"summary failed: {json.dumps(summary_payload)}")
if not review_payload.get('ok'):
    raise SystemExit(f"review failed: {json.dumps(review_payload)}")

data=summary_payload.get('data') or {}
review=(review_payload.get('data') or {}).get('review') or {}
outcome=(job_payload.get('data') or {}).get('outcome')
badge_counts=data.get('badge_counts') or {}
nonzero={k:v for k,v in badge_counts.items() if isinstance(v,(int,float)) and v}
print('headline:', data.get('headline'))
print('outcome:', outcome)
print('delta_pnl:', data.get('delta_pnl'))
print('cost_of_bias:', data.get('cost_of_bias'))
print('bias_rates:', json.dumps(data.get('bias_rates') or {}, sort_keys=True))
print('badge_counts_nonzero:', json.dumps(nonzero, sort_keys=True))

moments = review.get('top_moments') or []
if moments:
    m = moments[0]
    label = m.get('label') or m.get('trade_grade')
    impact = m.get('impact') if 'impact' in m else m.get('impact_abs')
    print('top_moment:', f"{label} | {m.get('timestamp')} | {m.get('asset')} | impact={impact}")
else:
    print('top_moment: none')
PY

COACH_POST_JSON="$(curl -sS -X POST "${BASE_URL}/jobs/${JOB_ID}/coach")"
COACH_POST_OK="$(python3 - "${COACH_POST_JSON}" <<'PY'
import json,sys
p=json.loads(sys.argv[1])
print('1' if p.get('ok') else '0')
PY
)"
if [[ "${COACH_POST_OK}" != "1" ]]; then
  if [[ "${ALLOW_COACH_FAILURE}" == "1" ]]; then
    echo "coach generation failed (allowed): ${COACH_POST_JSON}" >&2
  else
    echo "coach generation failed: ${COACH_POST_JSON}" >&2
    exit 1
  fi
fi

COACH_GET_JSON="$(curl -sS "${BASE_URL}/jobs/${JOB_ID}/coach")"
python3 - "${COACH_GET_JSON}" <<'PY'
import json,sys
payload=json.loads(sys.argv[1])
if not payload.get('ok'):
    raise SystemExit(f"coach fetch failed: {json.dumps(payload)}")
coach=(payload.get('data') or {}).get('coach') or {}
plan=coach.get('plan') or []
print('plan_titles:')
for item in plan:
    title=item.get('title')
    if title:
        print(' -', title)
move_review=coach.get('move_review') or []
print('move_review_top3:')
for row in move_review[:3]:
    print(' -', f"{row.get('label')} | {row.get('timestamp')} | {row.get('asset')} | {row.get('explanation')}")

personalized_line = None
for row in move_review:
    refs = row.get('metric_refs') or []
    if refs:
        ref = refs[0]
        personalized_line = f"{row.get('label')} | {ref.get('name')}={ref.get('value')} {ref.get('unit')}"
        break
if personalized_line:
    print('personalized_evidence:', personalized_line)
else:
    print('personalized_evidence: none')
PY

HISTORY_JSON="$(curl -fsS "${BASE_URL}/users/${USER_ID}/jobs?limit=1")"
python3 - "${HISTORY_JSON}" <<'PY'
import json,sys
payload=json.loads(sys.argv[1])
if not payload.get('ok'):
    raise SystemExit(f"history fetch failed: {json.dumps(payload)}")
jobs=((payload.get('data') or {}).get('jobs') or [])
if not jobs:
    raise SystemExit('history returned no jobs')
print('newest_job_row:', json.dumps(jobs[0], sort_keys=True))
PY

echo "judge_demo.sh PASS"
