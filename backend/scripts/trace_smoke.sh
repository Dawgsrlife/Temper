#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"
USER_ID="${USER_ID:-trace_smoke_user}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
CSV_PATH="${CSV_PATH:-${REPO_ROOT}/trading_datasets/golden_bias_smoke.csv}"
POLL_SECONDS="${POLL_SECONDS:-90}"
POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS:-0.5}"

if [[ ! -f "${CSV_PATH}" ]]; then
  echo "missing CSV_PATH file: ${CSV_PATH}" >&2
  exit 1
fi

if ! curl -fsS "${BASE_URL}/health" >/dev/null; then
  echo "backend health check failed at ${BASE_URL}/health" >&2
  exit 1
fi

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "${WORK_DIR}"' EXIT

CREATE_JSON_PATH="${WORK_DIR}/create.json"
JOB_JSON_PATH="${WORK_DIR}/job.json"
SUMMARY_JSON_PATH="${WORK_DIR}/summary.json"
REVIEW_JSON_PATH="${WORK_DIR}/review.json"
MOMENTS_JSON_PATH="${WORK_DIR}/moments.json"
TRACE_JSON_PATH="${WORK_DIR}/trace.json"
SERIES_JSON_PATH="${WORK_DIR}/series.json"

curl -fsS -X POST "${BASE_URL}/jobs" \
  -F "file=@${CSV_PATH};type=text/csv" \
  -F "user_id=${USER_ID}" >"${CREATE_JSON_PATH}"

JOB_ID="$(python3 - "${CREATE_JSON_PATH}" <<'PY'
import json,sys
payload=json.load(open(sys.argv[1]))
if not payload.get("ok"):
    raise SystemExit(f"job creation failed: {payload}")
job_id=(payload.get("job") or {}).get("job_id")
if not job_id:
    raise SystemExit(f"missing job_id in response: {payload}")
print(job_id)
PY
)"

echo "job_id: ${JOB_ID}"

DEADLINE="$(python3 - "${POLL_SECONDS}" <<'PY'
import sys,time
print(time.time() + float(sys.argv[1]))
PY
)"

TERMINAL_STATUS=""
while true; do
  NOW="$(python3 - <<'PY'
import time
print(time.time())
PY
)"
  if ! python3 - "${NOW}" "${DEADLINE}" <<'PY'
import sys
raise SystemExit(0 if float(sys.argv[1]) <= float(sys.argv[2]) else 1)
PY
  then
    echo "poll timeout after ${POLL_SECONDS}s" >&2
    exit 1
  fi

  curl -fsS "${BASE_URL}/jobs/${JOB_ID}" >"${JOB_JSON_PATH}"
  TERMINAL_STATUS="$(python3 - "${JOB_JSON_PATH}" <<'PY'
import json,sys
payload=json.load(open(sys.argv[1]))
if not payload.get("ok"):
    raise SystemExit(f"job polling failed: {payload}")
print((payload.get("job") or {}).get("execution_status"))
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
  cat "${JOB_JSON_PATH}" >&2
  exit 1
fi

curl -fsS "${BASE_URL}/jobs/${JOB_ID}/summary" >"${SUMMARY_JSON_PATH}"
curl -fsS "${BASE_URL}/jobs/${JOB_ID}/review" >"${REVIEW_JSON_PATH}"
curl -fsS "${BASE_URL}/jobs/${JOB_ID}/moments" >"${MOMENTS_JSON_PATH}"
curl -fsS "${BASE_URL}/jobs/${JOB_ID}/trace?offset=0&limit=50" >"${TRACE_JSON_PATH}"
curl -fsS "${BASE_URL}/jobs/${JOB_ID}/counterfactual/series?max_points=500" >"${SERIES_JSON_PATH}"

python3 - "${SUMMARY_JSON_PATH}" "${REVIEW_JSON_PATH}" "${MOMENTS_JSON_PATH}" "${TRACE_JSON_PATH}" "${SERIES_JSON_PATH}" <<'PY'
import json,sys
summary=json.load(open(sys.argv[1]))
review=json.load(open(sys.argv[2]))
moments=json.load(open(sys.argv[3]))
trace=json.load(open(sys.argv[4]))
series=json.load(open(sys.argv[5]))

for name,payload in [("summary",summary),("review",review),("moments",moments),("trace",trace),("series",series)]:
    if not payload.get("ok"):
        raise SystemExit(f"{name} endpoint failed: {payload}")

s=summary["data"]
r=(review.get("data") or {}).get("review", {})
print("headline:", s.get("headline"))
print("outcome:", r.get("headline"))
print("delta_pnl:", s.get("delta_pnl"))
print("cost_of_bias:", s.get("cost_of_bias"))
print("bias_rates:", json.dumps(s.get("bias_rates", {}), sort_keys=True))

moments_rows=(moments.get("data") or {}).get("moments", [])
if not moments_rows:
    raise SystemExit("moments endpoint returned no rows")
print("top_moments_with_receipts:")
for row in moments_rows[:3]:
    print(
        " -",
        f"{row.get('trade_grade')} | {row.get('timestamp')} | {row.get('asset')} | {row.get('explanation_human')}",
    )

trace_rows=(trace.get("data") or {}).get("rows", [])
if not trace_rows:
    raise SystemExit("trace endpoint returned no rows")
fired_counts={"REVENGE_AFTER_LOSS":0,"OVERTRADING_HOURLY_CAP":0,"LOSS_AVERSION_PAYOFF_PROXY":0}
for row in trace_rows:
    for hit in (row.get("rule_hits") or []):
        rule_id=hit.get("rule_id")
        if rule_id in fired_counts and bool(hit.get("fired")):
            fired_counts[rule_id]+=1
print("trace_fired_counts_in_page:", json.dumps(fired_counts, sort_keys=True))

series_points=(series.get("data") or {}).get("points", [])
print("series_points:", len(series_points))
if len(series_points) <= 0:
    raise SystemExit("counterfactual series returned no points")
PY

echo "trace_smoke.sh PASS"
