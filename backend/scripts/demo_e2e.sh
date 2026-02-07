#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOST="127.0.0.1"
PORT="8010"
BASE_URL="http://${HOST}:${PORT}"
CSV_PATH="${ROOT_DIR}/trading_datasets/calm_trader.csv"

if [[ ! -f "${CSV_PATH}" ]]; then
  echo "missing CSV at ${CSV_PATH}" >&2
  exit 1
fi

SERVER_LOG="$(mktemp)"
SERVER_PID=""

cleanup() {
  if [[ -n "${SERVER_PID}" ]]; then
    kill "${SERVER_PID}" >/dev/null 2>&1 || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi
  rm -f "${SERVER_LOG}"
}
trap cleanup EXIT

cd "${ROOT_DIR}"
PYTHONPATH=backend backend/venv/bin/uvicorn app.main:app --app-dir backend --host "${HOST}" --port "${PORT}" >"${SERVER_LOG}" 2>&1 &
SERVER_PID="$!"

# Wait for health endpoint.
for _ in $(seq 1 60); do
  if curl -fsS "${BASE_URL}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

if ! curl -fsS "${BASE_URL}/health" >/dev/null 2>&1; then
  echo "server failed to start" >&2
  cat "${SERVER_LOG}" >&2
  exit 1
fi

CREATE_JSON="$(curl -fsS -X POST "${BASE_URL}/jobs" \
  -F "file=@${CSV_PATH}" \
  -F "user_id=demo_e2e_user" \
  -F "run_async=true")"

JOB_ID="$(python3 - <<'PY' "${CREATE_JSON}"
import json,sys
payload=json.loads(sys.argv[1])
assert payload["ok"] is True, payload
job_id=payload["job"]["job_id"]
assert job_id, payload
print(job_id)
PY
)"

TERMINAL=""
JOB_JSON="{}"
for _ in $(seq 1 240); do
  JOB_JSON="$(curl -fsS "${BASE_URL}/jobs/${JOB_ID}")"
  TERMINAL="$(python3 - <<'PY' "${JOB_JSON}"
import json,sys
print(json.loads(sys.argv[1])["job"]["execution_status"])
PY
)"
  case "${TERMINAL}" in
    COMPLETED|FAILED|TIMEOUT)
      break
      ;;
  esac
  sleep 0.25
done

if [[ "${TERMINAL}" != "COMPLETED" ]]; then
  echo "job failed to complete: status=${TERMINAL}" >&2
  echo "${JOB_JSON}" >&2
  exit 1
fi

SUMMARY_JSON="$(curl -fsS "${BASE_URL}/jobs/${JOB_ID}/summary")"

python3 - <<'PY' "${SUMMARY_JSON}"
import json,sys
payload=json.loads(sys.argv[1])
if not payload.get("ok"):
    raise SystemExit(f"summary request failed: {payload}")
data=payload["data"]
headline=data["headline"]
badge_counts=data["badge_counts"]
moments=data["top_moments"]
first_moment=moments[0] if moments else None
print("headline:", headline)
print("badge_counts:", json.dumps(badge_counts, sort_keys=True))
print("first_top_moment:", json.dumps(first_moment, sort_keys=True))
PY

echo "demo_e2e.sh PASS"
