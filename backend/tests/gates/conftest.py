from __future__ import annotations

import tempfile
import time
from pathlib import Path
from typing import Iterator

from fastapi.testclient import TestClient

import app.main as main_module

TERMINAL = {"COMPLETED", "FAILED", "TIMEOUT"}

try:
    import pytest  # type: ignore
except Exception:
    class _PytestShim:
        @staticmethod
        def fixture(func=None, *args, **kwargs):
            if func is None:
                def _decorator(inner):
                    return inner
                return _decorator
            return func

    pytest = _PytestShim()  # type: ignore


class FakeSupabaseStore:
    def __init__(self) -> None:
        self.jobs: dict[str, dict] = {}
        self.artifacts: dict[str, dict[str, str]] = {}
        self.upsert_history: list[dict] = []

    def upsert_job(self, row: dict) -> None:
        payload = dict(row)
        job_id = str(payload["id"])
        self.jobs[job_id] = payload
        self.upsert_history.append(payload)

    def replace_job_artifacts(self, job_id: str, artifacts: dict[str, str]) -> None:
        self.artifacts[job_id] = dict(artifacts)

    def list_jobs_for_user(self, *, user_id: str, limit: int) -> list[dict]:
        rows = [row for row in self.jobs.values() if row.get("user_id") == user_id]
        rows.sort(key=lambda row: str(row.get("created_at", "")), reverse=True)
        return rows[:limit]


@pytest.fixture
def api_env() -> Iterator[tuple[TestClient, Path, FakeSupabaseStore]]:
    tmp = tempfile.TemporaryDirectory()
    outputs_dir = Path(tmp.name) / "outputs"
    outputs_dir.mkdir(parents=True, exist_ok=True)

    original_outputs = main_module.OUTPUTS_DIR
    original_supabase_store = main_module._supabase_store
    fake_supabase = FakeSupabaseStore()
    main_module.OUTPUTS_DIR = outputs_dir
    main_module._supabase_store = lambda: fake_supabase
    client = TestClient(main_module.app)
    try:
        yield client, outputs_dir, fake_supabase
    finally:
        main_module.OUTPUTS_DIR = original_outputs
        main_module._supabase_store = original_supabase_store
        tmp.cleanup()


def wait_for_terminal(client: TestClient, job_id: str, timeout_seconds: float = 20.0) -> dict:
    deadline = time.time() + timeout_seconds
    last_payload: dict | None = None
    while time.time() < deadline:
        response = client.get(f"/jobs/{job_id}")
        assert response.status_code == 200
        payload = response.json()
        last_payload = payload
        status = payload["job"]["execution_status"]
        if status in TERMINAL:
            return payload
        time.sleep(0.1)
    raise AssertionError(f"job {job_id} did not reach terminal status; last={last_payload}")


def golden_bias_csv() -> str:
    source = Path(__file__).resolve().parents[3] / "trading_datasets" / "golden_bias_smoke.csv"
    return source.read_text(encoding="utf-8")
