#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if [[ -x "backend/venv/bin/python" ]]; then
  if backend/venv/bin/python -c "import pytest" >/dev/null 2>&1; then
    backend/venv/bin/python -m pytest backend/tests/gates -q
  else
    echo "pytest is not installed in backend/venv. Install backend requirements with network access, then rerun." >&2
    exit 1
  fi
else
  if python -c "import pytest" >/dev/null 2>&1; then
    python -m pytest backend/tests/gates -q
  else
    echo "pytest is not installed in the active python environment." >&2
    exit 1
  fi
fi
