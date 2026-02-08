#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if [[ -x "backend/venv/bin/python" ]]; then
  backend/venv/bin/python backend/tests/gates/run_gates.py
else
  python backend/tests/gates/run_gates.py
fi
