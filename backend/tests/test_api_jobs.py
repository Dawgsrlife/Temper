from __future__ import annotations

import json
import tempfile
import time
from pathlib import Path

from fastapi.testclient import TestClient

import app.main as main_module

TERMINAL = {"COMPLETED", "FAILED", "TIMEOUT"}


class _FakeSupabaseStore:
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


def _client_with_temp_outputs() -> tuple[TestClient, tempfile.TemporaryDirectory[str], Path]:
    tmp = tempfile.TemporaryDirectory()
    out_dir = Path(tmp.name) / "outputs"
    out_dir.mkdir(parents=True, exist_ok=True)

    original_outputs = main_module.OUTPUTS_DIR
    main_module.OUTPUTS_DIR = out_dir
    client = TestClient(main_module.app)
    return client, tmp, original_outputs


def _wait_for_terminal(client: TestClient, job_id: str, timeout_seconds: float = 15.0) -> dict:
    deadline = time.time() + timeout_seconds
    last: dict | None = None
    while time.time() < deadline:
        response = client.get(f"/jobs/{job_id}")
        assert response.status_code == 200
        payload = response.json()
        last = payload
        status = payload["job"]["execution_status"]
        if status in TERMINAL:
            return payload
        time.sleep(0.1)
    assert False, f"job {job_id} did not reach terminal status; last={last}"


def test_successful_lifecycle() -> None:
    client, tmp, original_outputs = _client_with_temp_outputs()
    try:
        csv = (
            "timestamp,asset,price,size_usd,side,pnl\n"
            "2026-01-01T09:30:00,BTC,100000,1000,Buy,10\n"
            "2026-01-01T09:31:00,BTC,100100,1200,Sell,-5\n"
        )
        create = client.post(
            "/jobs",
            files={"file": ("valid.csv", csv, "text/csv")},
            data={"user_id": "user_api_success"},
        )
        assert create.status_code == 202
        created = create.json()
        assert created["ok"] is True
        assert created["job"]["execution_status"] == "PENDING"
        job_id = created["job"]["job_id"]
        assert job_id

        terminal = _wait_for_terminal(client, job_id)
        assert terminal["job"]["execution_status"] == "COMPLETED"
        assert terminal["data"]["status"] == "COMPLETED"

        review = client.get(f"/jobs/{job_id}/review")
        assert review.status_code == 200
        review_payload = review.json()
        assert review_payload["ok"] is True
        assert review_payload["job"]["execution_status"] == "COMPLETED"
        assert review_payload["data"]["review"]["execution_status"] == "COMPLETED"
        assert review_payload["data"]["review"]["headline"] in {
            "WINNER",
            "DRAW",
            "RESIGN",
            "CHECKMATED",
            None,
        }

        counterfactual = client.get(f"/jobs/{job_id}/counterfactual?offset=0&limit=50")
        assert counterfactual.status_code == 200
        cf_payload = counterfactual.json()
        assert cf_payload["ok"] is True
        assert cf_payload["data"]["total_rows"] == 2
        assert len(cf_payload["data"]["rows"]) <= 2
        assert "simulated_pnl" in cf_payload["data"]["columns"]
    finally:
        main_module.OUTPUTS_DIR = original_outputs
        tmp.cleanup()


def test_failure_lifecycle_invalid_csv() -> None:
    client, tmp, original_outputs = _client_with_temp_outputs()
    try:
        bad_csv = "asset,pnl\nBTC,10\nETH,-5\n"
        create = client.post(
            "/jobs",
            files={"file": ("invalid.csv", bad_csv, "text/csv")},
            data={"user_id": "user_api_fail"},
        )
        assert create.status_code == 202
        created = create.json()
        assert created["ok"] is True
        job_id = created["job"]["job_id"]

        terminal = _wait_for_terminal(client, job_id)
        assert terminal["job"]["execution_status"] in {"FAILED", "TIMEOUT"}
        assert terminal["data"]["error_type"] is not None
        assert terminal["data"]["error_message"] is not None

        summary = client.get(f"/jobs/{job_id}/summary")
        assert summary.status_code == 200
        summary_payload = summary.json()
        assert summary_payload["ok"] is True
        assert summary_payload["data"]["execution_status"] in {"FAILED", "TIMEOUT"}
        assert summary_payload["data"]["error_type"] is not None
        assert summary_payload["data"]["error_message"] is not None
    finally:
        main_module.OUTPUTS_DIR = original_outputs
        tmp.cleanup()


def test_summary_size_bound_and_key_presence() -> None:
    client, tmp, original_outputs = _client_with_temp_outputs()
    try:
        csv = (
            "timestamp,asset,price,size_usd,side,pnl\n"
            "2026-01-01T09:30:00,BTC,100000,1000,Buy,10\n"
            "2026-01-01T09:31:00,BTC,100100,1200,Sell,-5\n"
            "2026-01-01T09:32:00,ETH,2000,1400,Buy,2\n"
        )
        create = client.post(
            "/jobs",
            files={"file": ("valid.csv", csv, "text/csv")},
            data={"user_id": "user_summary"},
        )
        assert create.status_code == 202
        job_id = create.json()["job"]["job_id"]
        _wait_for_terminal(client, job_id)

        summary = client.get(f"/jobs/{job_id}/summary")
        assert summary.status_code == 200
        payload = summary.json()
        encoded = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        assert len(encoded) <= 25 * 1024

        assert payload["ok"] is True
        assert {"job_id", "user_id", "created_at", "engine_version", "input_sha256", "execution_status"} <= set(
            payload["job"].keys()
        )
        assert {
            "headline",
            "delta_pnl",
            "cost_of_bias",
            "bias_rates",
            "badge_counts",
            "top_moments",
            "data_quality_warnings",
            "execution_status",
            "error_type",
            "error_message",
        } <= set(payload["data"].keys())
        assert len(payload["data"]["top_moments"]) <= 3
    finally:
        main_module.OUTPUTS_DIR = original_outputs
        tmp.cleanup()


def test_determinism_across_identical_uploads() -> None:
    client, tmp, original_outputs = _client_with_temp_outputs()
    try:
        csv = (
            "timestamp,asset,price,size_usd,side,pnl\n"
            "2026-01-01T09:30:00,BTC,100000,1000,Buy,10\n"
            "2026-01-01T09:31:00,BTC,100100,1200,Sell,-5\n"
            "2026-01-01T09:32:00,ETH,2000,1400,Buy,2\n"
            "2026-01-01T09:33:00,ETH,2010,1300,Sell,-1\n"
        )

        create_a = client.post(
            "/jobs",
            files={"file": ("same_a.csv", csv, "text/csv")},
            data={"user_id": "determinism_user"},
        )
        create_b = client.post(
            "/jobs",
            files={"file": ("same_b.csv", csv, "text/csv")},
            data={"user_id": "determinism_user"},
        )
        assert create_a.status_code == 202
        assert create_b.status_code == 202
        job_a = create_a.json()["job"]["job_id"]
        job_b = create_b.json()["job"]["job_id"]

        terminal_a = _wait_for_terminal(client, job_a)
        terminal_b = _wait_for_terminal(client, job_b)
        assert terminal_a["job"]["execution_status"] == "COMPLETED"
        assert terminal_b["job"]["execution_status"] == "COMPLETED"

        assert terminal_a["job"]["input_sha256"] == terminal_b["job"]["input_sha256"]
        assert terminal_a["job"]["engine_version"] == terminal_b["job"]["engine_version"]

        review_a = client.get(f"/jobs/{job_a}/review").json()["data"]["review"]
        review_b = client.get(f"/jobs/{job_b}/review").json()["data"]["review"]
        assert review_a["badge_counts"] == review_b["badge_counts"]
    finally:
        main_module.OUTPUTS_DIR = original_outputs
        tmp.cleanup()


def test_concurrency_two_jobs_submitted_back_to_back_complete() -> None:
    client, tmp, original_outputs = _client_with_temp_outputs()
    try:
        csv = (
            "timestamp,asset,price,size_usd,side,pnl\n"
            "2026-01-01T09:30:00,BTC,100000,1000,Buy,10\n"
            "2026-01-01T09:31:00,BTC,100100,1200,Sell,-5\n"
            "2026-01-01T09:32:00,ETH,2000,1400,Buy,2\n"
            "2026-01-01T09:33:00,ETH,2010,1300,Sell,-1\n"
        )

        create_1 = client.post(
            "/jobs",
            files={"file": ("first.csv", csv, "text/csv")},
            data={"user_id": "concurrency_user"},
        )
        create_2 = client.post(
            "/jobs",
            files={"file": ("second.csv", csv, "text/csv")},
            data={"user_id": "concurrency_user"},
        )
        assert create_1.status_code == 202
        assert create_2.status_code == 202
        job_1 = create_1.json()["job"]["job_id"]
        job_2 = create_2.json()["job"]["job_id"]

        terminal_1 = _wait_for_terminal(client, job_1)
        terminal_2 = _wait_for_terminal(client, job_2)
        assert terminal_1["job"]["execution_status"] == "COMPLETED"
        assert terminal_2["job"]["execution_status"] == "COMPLETED"
    finally:
        main_module.OUTPUTS_DIR = original_outputs
        tmp.cleanup()


def test_counterfactual_pagination_stable_rows_offset_limit() -> None:
    client, tmp, original_outputs = _client_with_temp_outputs()
    try:
        csv = (
            "timestamp,asset,price,size_usd,side,pnl\n"
            "2026-01-01T09:30:00,BTC,100000,1000,Buy,10\n"
            "2026-01-01T09:31:00,BTC,100100,1200,Sell,-5\n"
            "2026-01-01T09:32:00,ETH,2000,1400,Buy,2\n"
            "2026-01-01T09:33:00,ETH,2010,1300,Sell,-1\n"
            "2026-01-01T09:34:00,SOL,100,800,Buy,3\n"
            "2026-01-01T09:35:00,SOL,102,900,Sell,-2\n"
        )
        create = client.post(
            "/jobs",
            files={"file": ("paging.csv", csv, "text/csv")},
            data={"user_id": "paging_user"},
        )
        assert create.status_code == 202
        job_id = create.json()["job"]["job_id"]
        _wait_for_terminal(client, job_id)

        p0 = client.get(f"/jobs/{job_id}/counterfactual?offset=0&limit=2").json()
        p0_repeat = client.get(f"/jobs/{job_id}/counterfactual?offset=0&limit=2").json()
        p1 = client.get(f"/jobs/{job_id}/counterfactual?offset=2&limit=2").json()
        p_combined = client.get(f"/jobs/{job_id}/counterfactual?offset=0&limit=4").json()

        assert p0["ok"] is True
        assert p1["ok"] is True
        assert p0["data"]["rows"] == p0_repeat["data"]["rows"]
        assert p0["data"]["columns"] == p1["data"]["columns"] == p_combined["data"]["columns"]

        left = p0["data"]["rows"] + p1["data"]["rows"]
        right = p_combined["data"]["rows"]
        assert left == right
    finally:
        main_module.OUTPUTS_DIR = original_outputs
        tmp.cleanup()


def test_corrupt_job_record_returns_structured_422_for_all_read_endpoints() -> None:
    client, tmp, original_outputs = _client_with_temp_outputs()
    try:
        corrupt_job_id = "corrupt_job"
        corrupt_dir = Path(tmp.name) / "outputs" / corrupt_job_id
        corrupt_dir.mkdir(parents=True, exist_ok=True)
        (corrupt_dir / "job.json").write_text("{not valid json")

        endpoints = [
            f"/jobs/{corrupt_job_id}",
            f"/jobs/{corrupt_job_id}/summary",
            f"/jobs/{corrupt_job_id}/review",
            f"/jobs/{corrupt_job_id}/counterfactual",
        ]

        for path in endpoints:
            response = client.get(path)
            assert response.status_code == 422, path
            payload = response.json()
            assert payload["ok"] is False
            assert payload["error"]["code"] == "CORRUPT_JOB_RECORD"
            assert "parse_error" in payload["error"]["details"]
    finally:
        main_module.OUTPUTS_DIR = original_outputs
        tmp.cleanup()


def test_invalid_timestamp_input_job_fails_with_error_metadata() -> None:
    client, tmp, original_outputs = _client_with_temp_outputs()
    try:
        csv = (
            "timestamp,asset,price,size_usd,side,pnl\n"
            "2026-01-01T09:30:00,BTC,100000,1000,Buy,10\n"
            "not-a-timestamp,BTC,100100,1200,Sell,-5\n"
        )
        create = client.post(
            "/jobs",
            files={"file": ("invalid_timestamp.csv", csv, "text/csv")},
            data={"user_id": "user_bad_ts"},
        )
        assert create.status_code == 202
        job_id = create.json()["job"]["job_id"]

        terminal = _wait_for_terminal(client, job_id)
        assert terminal["job"]["execution_status"] == "FAILED"
        assert terminal["data"]["error_type"] == "ValueError"
        assert "Timestamp parsing failed" in terminal["data"]["error_message"]

        summary = client.get(f"/jobs/{job_id}/summary")
        assert summary.status_code == 200
        payload = summary.json()
        assert payload["data"]["execution_status"] == "FAILED"
        assert payload["data"]["error_type"] == "ValueError"
        assert "Timestamp parsing failed" in payload["data"]["error_message"]
    finally:
        main_module.OUTPUTS_DIR = original_outputs
        tmp.cleanup()


def test_uploadthing_happy_path_creates_job_completes_and_persists_upload_metadata() -> None:
    client, tmp, original_outputs = _client_with_temp_outputs()
    original_verify = main_module._verify_uploadthing_signature
    original_download = main_module._download_uploadthing_bytes
    original_supabase_store = main_module._supabase_store
    fake_supabase = _FakeSupabaseStore()
    try:
        csv_bytes = (
            b"timestamp,asset,price,size_usd,side,pnl\n"
            b"2026-01-01T09:30:00,BTC,100000,1000,Buy,10\n"
            b"2026-01-01T09:31:00,BTC,100100,1200,Sell,-5\n"
        )

        def _always_valid(**_: object) -> bool:
            return True

        def _fake_download(file_key: str) -> bytes:
            assert file_key == "ut_file_123"
            return csv_bytes

        main_module._verify_uploadthing_signature = _always_valid
        main_module._download_uploadthing_bytes = _fake_download
        main_module._supabase_store = lambda: fake_supabase

        create = client.post(
            "/jobs/from-uploadthing",
            json={
                "user_id": "upload_user",
                "file_key": "ut_file_123",
                "original_filename": "demo.csv",
            },
            headers={"x-uploadthing-signature": "irrelevant-in-test"},
        )
        assert create.status_code == 202
        payload = create.json()
        assert payload["ok"] is True
        assert payload["job"]["execution_status"] == "PENDING"
        assert payload["job"]["upload"]["source"] == "uploadthing"
        assert payload["job"]["upload"]["file_key"] == "ut_file_123"
        assert payload["job"]["upload"]["original_filename"] == "demo.csv"
        assert payload["job"]["upload"]["byte_size"] == len(csv_bytes)
        assert payload["job"]["upload"]["input_sha256"] == payload["job"]["input_sha256"]

        job_id = payload["job"]["job_id"]
        terminal = _wait_for_terminal(client, job_id)
        assert terminal["job"]["execution_status"] == "COMPLETED"
        assert terminal["job"]["upload"]["file_key"] == "ut_file_123"
        deadline = time.time() + 3.0
        while time.time() < deadline:
            row = fake_supabase.jobs.get(job_id)
            if row is not None and row.get("status") == "COMPLETED":
                break
            time.sleep(0.05)
        assert job_id in fake_supabase.jobs
        supabase_row = fake_supabase.jobs[job_id]
        assert supabase_row["status"] == "COMPLETED"
        assert supabase_row["upload_source"] == "uploadthing"
        assert supabase_row["uploadthing_file_key"] == "ut_file_123"
        assert supabase_row["original_filename"] == "demo.csv"
        assert supabase_row["byte_size"] == len(csv_bytes)
        assert supabase_row["input_sha256"] == payload["job"]["input_sha256"]
        assert supabase_row["outcome"] in {"WINNER", "DRAW", "RESIGN", "CHECKMATED"}
        assert "counterfactual.csv" in fake_supabase.artifacts.get(job_id, {})
        statuses = [row["status"] for row in fake_supabase.upsert_history if row["id"] == job_id]
        assert "PENDING" in statuses
        assert "RUNNING" in statuses
        assert "COMPLETED" in statuses

        summary = client.get(f"/jobs/{job_id}/summary")
        assert summary.status_code == 200
        assert summary.json()["ok"] is True
    finally:
        main_module._verify_uploadthing_signature = original_verify
        main_module._download_uploadthing_bytes = original_download
        main_module._supabase_store = original_supabase_store
        main_module.OUTPUTS_DIR = original_outputs
        tmp.cleanup()


def test_uploadthing_invalid_signature_returns_401() -> None:
    client, tmp, original_outputs = _client_with_temp_outputs()
    original_verify = main_module._verify_uploadthing_signature
    original_download = main_module._download_uploadthing_bytes
    try:
        def _always_invalid(**_: object) -> bool:
            return False

        def _should_not_download(_: str) -> bytes:
            assert False, "download should not be called when signature fails"

        main_module._verify_uploadthing_signature = _always_invalid
        main_module._download_uploadthing_bytes = _should_not_download

        response = client.post(
            "/jobs/from-uploadthing",
            json={"user_id": "upload_user", "file_key": "ut_file_401"},
            headers={"x-uploadthing-signature": "bad"},
        )
        assert response.status_code == 401
        payload = response.json()
        assert payload["ok"] is False
        assert payload["error"]["code"] == "INVALID_UPLOADTHING_SIGNATURE"

        outputs_dir = Path(tmp.name) / "outputs"
        assert list(outputs_dir.glob("*/job.json")) == []
    finally:
        main_module._verify_uploadthing_signature = original_verify
        main_module._download_uploadthing_bytes = original_download
        main_module.OUTPUTS_DIR = original_outputs
        tmp.cleanup()


def test_uploadthing_invalid_csv_marks_failed_and_persists_supabase_error_metadata() -> None:
    client, tmp, original_outputs = _client_with_temp_outputs()
    original_verify = main_module._verify_uploadthing_signature
    original_download = main_module._download_uploadthing_bytes
    original_supabase_store = main_module._supabase_store
    fake_supabase = _FakeSupabaseStore()
    try:
        bad_csv = b"asset,pnl\nBTC,10\nETH,-5\n"

        def _always_valid(**_: object) -> bool:
            return True

        def _fake_download(file_key: str) -> bytes:
            assert file_key == "ut_bad_csv"
            return bad_csv

        main_module._verify_uploadthing_signature = _always_valid
        main_module._download_uploadthing_bytes = _fake_download
        main_module._supabase_store = lambda: fake_supabase

        create = client.post(
            "/jobs/from-uploadthing",
            json={
                "user_id": "upload_user",
                "file_key": "ut_bad_csv",
                "original_filename": "bad.csv",
            },
            headers={"x-uploadthing-signature": "irrelevant-in-test"},
        )
        assert create.status_code == 202
        job_id = create.json()["job"]["job_id"]

        terminal = _wait_for_terminal(client, job_id)
        assert terminal["job"]["execution_status"] == "FAILED"
        deadline = time.time() + 3.0
        while time.time() < deadline:
            row = fake_supabase.jobs.get(job_id)
            if row is not None and row.get("status") == "FAILED":
                break
            time.sleep(0.05)

        assert job_id in fake_supabase.jobs
        supabase_row = fake_supabase.jobs[job_id]
        assert supabase_row["status"] == "FAILED"
        assert supabase_row["error_type"] == "ValueError"
        assert isinstance(supabase_row["error_message"], str)
        assert supabase_row["error_message"] != ""
        statuses = [row["status"] for row in fake_supabase.upsert_history if row["id"] == job_id]
        assert "PENDING" in statuses
        assert "RUNNING" in statuses
        assert "FAILED" in statuses
    finally:
        main_module._verify_uploadthing_signature = original_verify
        main_module._download_uploadthing_bytes = original_download
        main_module._supabase_store = original_supabase_store
        main_module.OUTPUTS_DIR = original_outputs
        tmp.cleanup()


def test_list_user_jobs_reads_supabase_newest_first() -> None:
    client, tmp, original_outputs = _client_with_temp_outputs()
    original_supabase_store = main_module._supabase_store
    fake_supabase = _FakeSupabaseStore()
    try:
        fake_supabase.upsert_job(
            {
                "id": "job_old",
                "user_id": "history_user",
                "created_at": "2026-02-07T10:00:00+00:00",
                "status": "COMPLETED",
                "engine_version": "abc",
                "input_sha256": "sha_old",
                "outcome": "DRAW",
                "delta_pnl": 0.0,
                "cost_of_bias": 0.0,
                "badge_counts": {},
                "bias_rates": {},
                "error_type": None,
                "error_message": None,
                "upload_source": None,
                "uploadthing_file_key": None,
                "original_filename": None,
                "byte_size": None,
            }
        )
        fake_supabase.upsert_job(
            {
                "id": "job_new",
                "user_id": "history_user",
                "created_at": "2026-02-07T12:00:00+00:00",
                "status": "FAILED",
                "engine_version": "abc",
                "input_sha256": "sha_new",
                "outcome": None,
                "delta_pnl": None,
                "cost_of_bias": None,
                "badge_counts": {},
                "bias_rates": {},
                "error_type": "ValueError",
                "error_message": "bad input",
                "upload_source": "uploadthing",
                "uploadthing_file_key": "ut_new",
                "original_filename": "new.csv",
                "byte_size": 123,
            }
        )
        main_module._supabase_store = lambda: fake_supabase

        response = client.get("/users/history_user/jobs")
        assert response.status_code == 200
        payload = response.json()
        assert payload["ok"] is True
        assert payload["data"]["count"] == 2
        assert payload["data"]["jobs"][0]["job_id"] == "job_new"
        assert payload["data"]["jobs"][1]["job_id"] == "job_old"
    finally:
        main_module._supabase_store = original_supabase_store
        main_module.OUTPUTS_DIR = original_outputs
        tmp.cleanup()


def test_coach_happy_path_writes_artifact_updates_supabase_and_get_returns_payload() -> None:
    client, tmp, original_outputs = _client_with_temp_outputs()
    original_supabase_store = main_module._supabase_store
    original_generate_coach = main_module.generate_coach_via_vertex
    fake_supabase = _FakeSupabaseStore()
    try:
        main_module._supabase_store = lambda: fake_supabase
        csv = (
            "timestamp,asset,price,size_usd,side,pnl\n"
            "2026-01-01T09:30:00,BTC,100000,1000,Buy,10\n"
            "2026-01-01T09:31:00,BTC,100100,1200,Sell,-5\n"
        )
        create = client.post(
            "/jobs",
            files={"file": ("coach_source.csv", csv, "text/csv")},
            data={"user_id": "coach_user"},
        )
        assert create.status_code == 202
        job_id = create.json()["job"]["job_id"]
        terminal = _wait_for_terminal(client, job_id)
        assert terminal["job"]["execution_status"] == "COMPLETED"

        coach_payload = {
            "version": 1,
            "headline": "Stabilize post-loss execution this week.",
            "diagnosis": [
                {
                    "bias": "REVENGE_TRADING",
                    "severity": 3,
                    "evidence": ["Revenge rate was 0.50% across 2 trades."],
                    "metric_refs": [
                        {"name": "revenge_rate", "value": 0.5, "unit": "percent"},
                    ],
                }
            ],
            "plan": [
                {
                    "title": "Cooldown discipline",
                    "steps": ["Pause 10 minutes after each loss.", "Cut size by 25% after two losses."],
                    "time_horizon": "NEXT_SESSION",
                }
            ],
            "do_next_session": ["Start with max 2 trades first hour.", "Log reason before each entry."],
            "disclaimer": "Educational guidance; not financial advice.",
        }

        main_module.generate_coach_via_vertex = lambda _: coach_payload
        response = client.post(f"/jobs/{job_id}/coach")
        assert response.status_code == 200
        body = response.json()
        assert body["ok"] is True
        assert body["data"]["coach"]["version"] == 1

        coach_path = Path(tmp.name) / "outputs" / job_id / "coach.json"
        assert coach_path.exists()
        assert job_id in fake_supabase.jobs
        row = fake_supabase.jobs[job_id]
        assert row["coach_status"] == "COMPLETED"
        assert row["coach_error_type"] is None
        assert "coach_json" in fake_supabase.artifacts.get(job_id, {})

        get_response = client.get(f"/jobs/{job_id}/coach")
        assert get_response.status_code == 200
        get_body = get_response.json()
        assert get_body["ok"] is True
        assert get_body["data"]["coach"]["headline"] == coach_payload["headline"]
    finally:
        main_module._supabase_store = original_supabase_store
        main_module.generate_coach_via_vertex = original_generate_coach
        main_module.OUTPUTS_DIR = original_outputs
        tmp.cleanup()


def test_coach_failure_writes_error_artifact_updates_supabase_and_get_returns_failed_state() -> None:
    client, tmp, original_outputs = _client_with_temp_outputs()
    original_supabase_store = main_module._supabase_store
    original_generate_coach = main_module.generate_coach_via_vertex
    fake_supabase = _FakeSupabaseStore()
    try:
        main_module._supabase_store = lambda: fake_supabase
        csv = (
            "timestamp,asset,price,size_usd,side,pnl\n"
            "2026-01-01T09:30:00,BTC,100000,1000,Buy,10\n"
            "2026-01-01T09:31:00,BTC,100100,1200,Sell,-5\n"
        )
        create = client.post(
            "/jobs",
            files={"file": ("coach_failure_source.csv", csv, "text/csv")},
            data={"user_id": "coach_user"},
        )
        assert create.status_code == 202
        job_id = create.json()["job"]["job_id"]
        terminal = _wait_for_terminal(client, job_id)
        assert terminal["job"]["execution_status"] == "COMPLETED"

        def _raise_vertex(_: dict) -> dict:
            raise RuntimeError("vertex timeout in test")

        main_module.generate_coach_via_vertex = _raise_vertex
        response = client.post(f"/jobs/{job_id}/coach")
        assert response.status_code == 502
        body = response.json()
        assert body["ok"] is False
        assert body["error"]["code"] == "COACH_GENERATION_FAILED"

        error_path = Path(tmp.name) / "outputs" / job_id / "coach_error.json"
        assert error_path.exists()
        row = fake_supabase.jobs[job_id]
        assert row["coach_status"] == "FAILED"
        assert row["coach_error_type"] == "RuntimeError"
        assert isinstance(row["coach_error_message"], str)
        assert row["coach_error_message"] != ""

        get_response = client.get(f"/jobs/{job_id}/coach")
        assert get_response.status_code == 409
        get_body = get_response.json()
        assert get_body["ok"] is False
        assert get_body["error"]["code"] == "COACH_FAILED"
        assert "coach_error" in get_body["data"]
    finally:
        main_module._supabase_store = original_supabase_store
        main_module.generate_coach_via_vertex = original_generate_coach
        main_module.OUTPUTS_DIR = original_outputs
        tmp.cleanup()


def test_coach_not_ready_returns_409_for_running_job() -> None:
    client, tmp, original_outputs = _client_with_temp_outputs()
    try:
        out_dir = Path(tmp.name) / "outputs"
        job_id = "running_coach_job"
        running_dir = out_dir / job_id
        running_dir.mkdir(parents=True, exist_ok=True)
        running_record = main_module._initial_job_record(
            job_id,
            user_id="coach_user",
            input_sha256="deadbeef",
            status="RUNNING",
        )
        main_module._store().write(running_record, job_dir=running_dir)

        response = client.post(f"/jobs/{job_id}/coach")
        assert response.status_code == 409
        payload = response.json()
        assert payload["ok"] is False
        assert payload["error"]["code"] == "JOB_NOT_READY"
    finally:
        main_module.OUTPUTS_DIR = original_outputs
        tmp.cleanup()
