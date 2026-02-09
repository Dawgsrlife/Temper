from __future__ import annotations

import csv
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


def _load_review_and_counterfactual_rows(outputs_dir: Path, job_id: str) -> tuple[dict, list[dict]]:
    job_dir = outputs_dir / job_id
    review = json.loads((job_dir / "review.json").read_text())
    with (job_dir / "counterfactual.csv").open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    return review, rows


def _calm_csv_slice(rows: int = 150) -> str:
    source = Path(__file__).resolve().parents[2] / "trading_datasets" / "calm_trader.csv"
    lines = source.read_text(encoding="utf-8").splitlines()
    if rows < 1:
        raise ValueError("rows must be >= 1")
    return "\n".join([lines[0], *lines[1 : 1 + rows]]) + "\n"


def _golden_bias_csv() -> str:
    source = Path(__file__).resolve().parents[2] / "trading_datasets" / "golden_bias_smoke.csv"
    return source.read_text(encoding="utf-8")


def test_successful_lifecycle() -> None:
    client, tmp, original_outputs = _client_with_temp_outputs()
    try:
        csv = _calm_csv_slice()
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
        assert cf_payload["data"]["total_rows"] >= 1
        assert len(cf_payload["data"]["rows"]) <= 50
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
        csv = _calm_csv_slice()

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
        csv = _calm_csv_slice()
        create = client.post(
            "/jobs",
            files={"file": ("coach_source.csv", csv, "text/csv")},
            data={"user_id": "coach_user"},
        )
        assert create.status_code == 202
        job_id = create.json()["job"]["job_id"]
        terminal = _wait_for_terminal(client, job_id)
        assert terminal["job"]["execution_status"] == "COMPLETED"
        outputs_dir = Path(tmp.name) / "outputs"
        review_payload, counterfactual_rows = _load_review_and_counterfactual_rows(outputs_dir, job_id)
        deterministic_move_review = main_module.build_deterministic_move_review(
            review_payload,
            counterfactual_rows,
        )

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
            "move_review": deterministic_move_review,
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
        csv = _calm_csv_slice()
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


def test_trade_coach_happy_path_writes_artifact_and_get_returns_payload() -> None:
    client, tmp, original_outputs = _client_with_temp_outputs()
    original_supabase_store = main_module._supabase_store
    original_generate_trade_coach = main_module.generate_trade_coach_via_vertex
    fake_supabase = _FakeSupabaseStore()
    try:
        main_module._supabase_store = lambda: fake_supabase
        csv = _calm_csv_slice()
        create = client.post(
            "/jobs",
            files={"file": ("trade_coach_source.csv", csv, "text/csv")},
            data={"user_id": "trade_coach_user"},
        )
        assert create.status_code == 202
        job_id = create.json()["job"]["job_id"]
        terminal = _wait_for_terminal(client, job_id)
        assert terminal["job"]["execution_status"] == "COMPLETED"

        trade_id = 0
        trade_response = client.get(f"/jobs/{job_id}/trade/{trade_id}")
        assert trade_response.status_code == 200
        trade_payload = trade_response.json()["data"]["trade"]
        metric_refs = main_module._trade_metric_refs(trade_payload)
        label = str(trade_payload["label"]).upper()

        def _fake_trade_vertex(_: dict) -> dict:
            return {
                "version": 1,
                "trade_id": trade_id,
                "label": label,
                "llm_explanation": "Size was adjusted to reduce emotional risk while preserving setup.",
                "actionable_fix": "Use a fixed size cap after losses for the next 3 trades.",
                "confidence_note": "Guidance is based on deterministic replay metrics only.",
                "metric_refs": metric_refs,
            }

        main_module.generate_trade_coach_via_vertex = _fake_trade_vertex
        post_response = client.post(f"/jobs/{job_id}/trade/{trade_id}/coach")
        assert post_response.status_code == 200
        post_payload = post_response.json()
        assert post_payload["ok"] is True
        assert post_payload["data"]["trade_coach"]["trade_id"] == trade_id
        assert post_payload["data"]["trade_coach"]["label"] == label

        coach_path = Path(tmp.name) / "outputs" / job_id / f"trade_coach_{trade_id}.json"
        assert coach_path.exists()
        assert "trade_coach_0_json" in fake_supabase.artifacts.get(job_id, {})

        get_response = client.get(f"/jobs/{job_id}/trade/{trade_id}/coach")
        assert get_response.status_code == 200
        get_payload = get_response.json()
        assert get_payload["ok"] is True
        assert get_payload["data"]["trade_coach"]["trade_id"] == trade_id
    finally:
        main_module._supabase_store = original_supabase_store
        main_module.generate_trade_coach_via_vertex = original_generate_trade_coach
        main_module.OUTPUTS_DIR = original_outputs
        tmp.cleanup()


def test_trade_coach_failure_writes_error_artifact_and_get_returns_failed_state() -> None:
    client, tmp, original_outputs = _client_with_temp_outputs()
    original_generate_trade_coach = main_module.generate_trade_coach_via_vertex
    try:
        csv = _calm_csv_slice()
        create = client.post(
            "/jobs",
            files={"file": ("trade_coach_failure_source.csv", csv, "text/csv")},
            data={"user_id": "trade_coach_user"},
        )
        assert create.status_code == 202
        job_id = create.json()["job"]["job_id"]
        terminal = _wait_for_terminal(client, job_id)
        assert terminal["job"]["execution_status"] == "COMPLETED"

        def _raise_trade_vertex(_: dict) -> dict:
            raise RuntimeError("trade vertex timeout in test")

        main_module.generate_trade_coach_via_vertex = _raise_trade_vertex
        trade_id = 0
        post_response = client.post(f"/jobs/{job_id}/trade/{trade_id}/coach")
        assert post_response.status_code == 502
        post_payload = post_response.json()
        assert post_payload["ok"] is False
        assert post_payload["error"]["code"] == "TRADE_COACH_GENERATION_FAILED"

        error_path = Path(tmp.name) / "outputs" / job_id / f"trade_coach_error_{trade_id}.json"
        assert error_path.exists()
        get_response = client.get(f"/jobs/{job_id}/trade/{trade_id}/coach")
        assert get_response.status_code == 409
        get_payload = get_response.json()
        assert get_payload["ok"] is False
        assert get_payload["error"]["code"] == "TRADE_COACH_FAILED"
    finally:
        main_module.generate_trade_coach_via_vertex = original_generate_trade_coach
        main_module.OUTPUTS_DIR = original_outputs
        tmp.cleanup()


def test_trade_coach_not_ready_returns_409_for_running_job() -> None:
    client, tmp, original_outputs = _client_with_temp_outputs()
    try:
        out_dir = Path(tmp.name) / "outputs"
        job_id = "running_trade_coach_job"
        running_dir = out_dir / job_id
        running_dir.mkdir(parents=True, exist_ok=True)
        running_record = main_module._initial_job_record(
            job_id,
            user_id="trade_coach_user",
            input_sha256="deadbeef",
            status="RUNNING",
        )
        main_module._store().write(running_record, job_dir=running_dir)

        response = client.post(f"/jobs/{job_id}/trade/0/coach")
        assert response.status_code == 409
        payload = response.json()
        assert payload["ok"] is False
        assert payload["error"]["code"] == "JOB_NOT_READY"
    finally:
        main_module.OUTPUTS_DIR = original_outputs
        tmp.cleanup()


def _metric_value_from_artifacts(
    *,
    name: str,
    row: dict,
    thresholds: dict,
    daily_max_loss_used: float,
    post_loss_streak: int,
) -> object:
    pnl = float(row["pnl"])
    simulated_pnl = float(row["simulated_pnl"])
    if name == "pnl":
        return pnl
    if name == "impact_abs":
        return abs(pnl - simulated_pnl)
    if name in thresholds:
        return float(thresholds[name])
    if name == "blocked_reason":
        return row["blocked_reason"]
    if name == "post_loss_streak":
        return post_loss_streak
    if name == "near_daily_limit":
        return (float(row["simulated_daily_pnl"]) <= (-0.8 * daily_max_loss_used)) if daily_max_loss_used > 0 else False
    if name == "bias_tagged":
        return (
            str(row["is_revenge"]).lower() == "true"
            or str(row["is_overtrading"]).lower() == "true"
            or str(row["is_loss_aversion"]).lower() == "true"
        )
    raise AssertionError(f"unexpected metric name in deterministic move_review: {name}")


def test_move_review_is_deterministic_and_matches_artifacts() -> None:
    client, tmp, original_outputs = _client_with_temp_outputs()
    try:
        csv = _calm_csv_slice()
        create = client.post(
            "/jobs",
            files={"file": ("move_review_source.csv", csv, "text/csv")},
            data={"user_id": "coach_move_review"},
        )
        assert create.status_code == 202
        job_id = create.json()["job"]["job_id"]
        terminal = _wait_for_terminal(client, job_id)
        assert terminal["job"]["execution_status"] == "COMPLETED"

        outputs_dir = Path(tmp.name) / "outputs"
        review_payload, counterfactual_rows = _load_review_and_counterfactual_rows(outputs_dir, job_id)
        first = main_module.build_deterministic_move_review(review_payload, counterfactual_rows)
        second = main_module.build_deterministic_move_review(review_payload, counterfactual_rows)
        assert first == second
        assert len(first) == 3

        rows_by_key = {(row["timestamp"], row["asset"]): row for row in counterfactual_rows}
        thresholds = review_payload["labeling_rules"]["thresholds"]
        daily_max_loss_used = float(review_payload["derived_stats"]["daily_max_loss_used"])
        post_loss_streak_map: dict[tuple[str, str], int] = {}
        streak = 0
        for row in counterfactual_rows:
            post_loss_streak_map[(row["timestamp"], row["asset"])] = streak
            if float(row["pnl"]) < 0:
                streak += 1
            else:
                streak = 0

        for move in first:
            key = (move["timestamp"], move["asset"])
            assert key in rows_by_key
            row = rows_by_key[key]
            for ref in move["metric_refs"]:
                expected = _metric_value_from_artifacts(
                    name=ref["name"],
                    row=row,
                    thresholds=thresholds,
                    daily_max_loss_used=daily_max_loss_used,
                    post_loss_streak=post_loss_streak_map[key],
                )
                assert ref["value"] == expected
    finally:
        main_module.OUTPUTS_DIR = original_outputs
        tmp.cleanup()


def test_coach_rejects_vertex_number_drift() -> None:
    client, tmp, original_outputs = _client_with_temp_outputs()
    original_generate_coach = main_module.generate_coach_via_vertex
    try:
        csv = _calm_csv_slice()
        create = client.post(
            "/jobs",
            files={"file": ("coach_drift_source.csv", csv, "text/csv")},
            data={"user_id": "coach_drift_user"},
        )
        assert create.status_code == 202
        job_id = create.json()["job"]["job_id"]
        terminal = _wait_for_terminal(client, job_id)
        assert terminal["job"]["execution_status"] == "COMPLETED"

        outputs_dir = Path(tmp.name) / "outputs"
        review_payload, counterfactual_rows = _load_review_and_counterfactual_rows(outputs_dir, job_id)
        deterministic_move_review = main_module.build_deterministic_move_review(
            review_payload,
            counterfactual_rows,
        )

        drifted_move_review = json.loads(json.dumps(deterministic_move_review))
        first_metric_value = drifted_move_review[0]["metric_refs"][0]["value"]
        if isinstance(first_metric_value, bool):
            drifted_move_review[0]["metric_refs"][0]["value"] = not first_metric_value
        elif isinstance(first_metric_value, str):
            drifted_move_review[0]["metric_refs"][0]["value"] = first_metric_value + "_drift"
        else:
            drifted_move_review[0]["metric_refs"][0]["value"] = float(first_metric_value) + 1.0

        def _vertex_with_drift(_: dict) -> dict:
            return {
                "version": 1,
                "headline": "Discipline plan",
                "diagnosis": [
                    {
                        "bias": "OVERTRADING",
                        "severity": 2,
                        "evidence": ["Any bias rate was 1.00%."],
                        "metric_refs": [{"name": "any_bias_rate", "value": 1.0, "unit": "percent"}],
                    }
                ],
                "plan": [
                    {
                        "title": "Stabilize cadence",
                        "steps": ["Reduce impulsive entries.", "Pause after large losses."],
                        "time_horizon": "NEXT_SESSION",
                    }
                ],
                "do_next_session": ["Use size cap for first three trades."],
                "disclaimer": "Educational guidance only.",
                "move_review": drifted_move_review,
            }

        main_module.generate_coach_via_vertex = _vertex_with_drift
        response = client.post(f"/jobs/{job_id}/coach")
        assert response.status_code == 502
        body = response.json()
        assert body["ok"] is False
        assert body["error"]["code"] == "COACH_GENERATION_FAILED"

        error_path = Path(tmp.name) / "outputs" / job_id / "coach_error.json"
        assert error_path.exists()
        error_payload = json.loads(error_path.read_text())
        assert "drifted" in str(error_payload.get("error_message", "")).lower()
    finally:
        main_module.generate_coach_via_vertex = original_generate_coach
        main_module.OUTPUTS_DIR = original_outputs
        tmp.cleanup()


def test_counterfactual_series_returns_non_empty_points_for_completed_job() -> None:
    client, tmp, original_outputs = _client_with_temp_outputs()
    try:
        csv = _calm_csv_slice()
        create = client.post(
            "/jobs",
            files={"file": ("series_source.csv", csv, "text/csv")},
            data={"user_id": "evidence_user"},
        )
        assert create.status_code == 202
        job_id = create.json()["job"]["job_id"]
        terminal = _wait_for_terminal(client, job_id)
        assert terminal["job"]["execution_status"] == "COMPLETED"

        response = client.get(f"/jobs/{job_id}/counterfactual/series?max_points=300")
        assert response.status_code == 200
        payload = response.json()
        assert payload["ok"] is True
        points = payload["data"]["points"]
        assert isinstance(points, list)
        assert len(points) > 0
        assert "timestamp" in points[0]
        assert "actual_equity" in points[0]
        assert "simulated_equity" in points[0]
        assert payload["data"]["returned_points"] <= 300
    finally:
        main_module.OUTPUTS_DIR = original_outputs
        tmp.cleanup()


def test_moments_returns_joined_rows_with_evidence_fields() -> None:
    client, tmp, original_outputs = _client_with_temp_outputs()
    try:
        csv = _calm_csv_slice()
        create = client.post(
            "/jobs",
            files={"file": ("moments_source.csv", csv, "text/csv")},
            data={"user_id": "evidence_user"},
        )
        assert create.status_code == 202
        job_id = create.json()["job"]["job_id"]
        terminal = _wait_for_terminal(client, job_id)
        assert terminal["job"]["execution_status"] == "COMPLETED"

        response = client.get(f"/jobs/{job_id}/moments")
        assert response.status_code == 200
        payload = response.json()
        assert payload["ok"] is True
        moments = payload["data"]["moments"]
        assert isinstance(moments, list)
        assert len(moments) >= 1
        assert len(moments) <= 3
        moment = moments[0]
        for key in [
            "timestamp",
            "asset",
            "trade_grade",
            "bias_category",
            "pnl",
            "simulated_pnl",
            "impact_abs",
            "blocked_reason",
            "is_revenge",
            "is_overtrading",
            "is_loss_aversion",
            "thresholds_referenced",
            "explanation_human",
            "decision",
            "reason",
            "triggering_prior_trade",
            "trace_trade_id",
            "rule_hits",
            "counterfactual_mechanics",
            "evidence",
            "error_notes",
        ]:
            assert key in moment
        assert isinstance(moment["counterfactual_mechanics"], dict)
        assert {
            "mechanism",
            "scale_factor",
            "size_usd_before",
            "size_usd_after",
            "cap_used",
        } <= set(moment["counterfactual_mechanics"].keys())
        assert "metric_refs" in moment["evidence"]
        assert isinstance(moment["evidence"]["metric_refs"], list)
        assert "rule_hits" in moment["evidence"]
        assert isinstance(moment["rule_hits"], list)
        assert isinstance(moment["evidence"]["rule_hits"], list)
        if moment["rule_hits"]:
            first_rule_hit = moment["rule_hits"][0]
            assert "rule_id" in first_rule_hit
            assert "thresholds" in first_rule_hit
            assert "comparison" in first_rule_hit
            assert "fired" in first_rule_hit
        categories = [row.get("bias_category") for row in moments if row.get("bias_category") not in {None, "fallback"}]
        assert len(categories) == len(set(categories))
    finally:
        main_module.OUTPUTS_DIR = original_outputs
        tmp.cleanup()


def test_trace_endpoint_returns_receipts_rows_and_artifact_name() -> None:
    client, tmp, original_outputs = _client_with_temp_outputs()
    try:
        csv = _calm_csv_slice()
        create = client.post(
            "/jobs",
            files={"file": ("trace_source.csv", csv, "text/csv")},
            data={"user_id": "trace_user"},
        )
        assert create.status_code == 202
        job_id = create.json()["job"]["job_id"]
        terminal = _wait_for_terminal(client, job_id)
        assert terminal["job"]["execution_status"] == "COMPLETED"

        response = client.get(f"/jobs/{job_id}/trace?offset=0&limit=20")
        assert response.status_code == 200
        payload = response.json()
        assert payload["ok"] is True
        data = payload["data"]
        assert data["artifact_name"] == "decision_trace.jsonl"
        assert data["total_rows"] >= 1
        assert len(data["rows"]) >= 1
        first = data["rows"][0]
        for key in [
            "trade_id",
            "timestamp",
            "asset",
            "pnl",
            "size_usd",
            "blocked_reason",
            "is_revenge",
            "is_overtrading",
            "is_loss_aversion",
            "rule_hits",
            "decision",
            "reason",
            "explain_like_im_5",
        ]:
            assert key in first
        assert isinstance(first["rule_hits"], list)

        trace_path = Path(tmp.name) / "outputs" / job_id / "decision_trace.jsonl"
        assert trace_path.exists()
    finally:
        main_module.OUTPUTS_DIR = original_outputs
        tmp.cleanup()


def test_golden_bias_csv_triggers_required_bias_rules() -> None:
    client, tmp, original_outputs = _client_with_temp_outputs()
    try:
        csv = _golden_bias_csv()
        create = client.post(
            "/jobs",
            files={"file": ("golden_bias_smoke.csv", csv, "text/csv")},
            data={"user_id": "golden_user"},
        )
        assert create.status_code == 202
        job_id = create.json()["job"]["job_id"]
        terminal = _wait_for_terminal(client, job_id, timeout_seconds=30.0)
        assert terminal["job"]["execution_status"] == "COMPLETED"

        trace_response = client.get(f"/jobs/{job_id}/trace?offset=0&limit=5000")
        assert trace_response.status_code == 200
        rows = trace_response.json()["data"]["rows"]
        assert len(rows) > 0

        rule_fired: dict[str, bool] = {
            "REVENGE_AFTER_LOSS": False,
            "OVERTRADING_HOURLY_CAP": False,
            "LOSS_AVERSION_PAYOFF_PROXY": False,
        }
        for row in rows:
            hits = row.get("rule_hits", [])
            if not isinstance(hits, list):
                continue
            for hit in hits:
                if not isinstance(hit, dict):
                    continue
                rule_id = hit.get("rule_id")
                fired = bool(hit.get("fired"))
                if rule_id in rule_fired and fired:
                    rule_fired[str(rule_id)] = True

        assert rule_fired["REVENGE_AFTER_LOSS"] is True
        assert rule_fired["OVERTRADING_HOURLY_CAP"] is True
        assert rule_fired["LOSS_AVERSION_PAYOFF_PROXY"] is True

        moments_response = client.get(f"/jobs/{job_id}/moments")
        assert moments_response.status_code == 200
        moments = moments_response.json()["data"]["moments"]
        overtrading_moment = next((row for row in moments if row.get("bias_category") == "overtrading"), None)
        assert overtrading_moment is not None
        explanation = str(overtrading_moment.get("explanation_human", ""))
        assert "far more frequently than normal" in explanation
        assert "skipped during cooldown" in explanation.lower()
    finally:
        main_module.OUTPUTS_DIR = original_outputs
        tmp.cleanup()


def test_trade_inspector_returns_one_trade_with_raw_row_flags_and_decision() -> None:
    client, tmp, original_outputs = _client_with_temp_outputs()
    try:
        csv = _golden_bias_csv()
        create = client.post(
            "/jobs",
            files={"file": ("golden_bias_smoke.csv", csv, "text/csv")},
            data={"user_id": "inspector_user"},
        )
        assert create.status_code == 202
        job_id = create.json()["job"]["job_id"]
        terminal = _wait_for_terminal(client, job_id, timeout_seconds=30.0)
        assert terminal["job"]["execution_status"] == "COMPLETED"

        response = client.get(f"/jobs/{job_id}/trade/21")
        assert response.status_code == 200
        payload = response.json()
        assert payload["ok"] is True
        trade = payload["data"]["trade"]
        assert trade["trade_id"] == 21
        assert isinstance(trade["raw_input_row"], dict)
        assert trade["derived_flags"]["is_revenge"] is True
        assert trade["decision"]["decision"] in {"KEEP", "SKIP"}
        assert trade["decision"]["reason"] is not None
        assert trade["counterfactual"]["actual_pnl"] is not None
        assert trade["counterfactual"]["simulated_pnl"] is not None
        assert trade["counterfactual"]["delta_pnl"] is not None
        assert isinstance(trade["counterfactual_mechanics"], dict)
        assert {
            "mechanism",
            "scale_factor",
            "size_usd_before",
            "size_usd_after",
            "cap_used",
        } <= set(trade["counterfactual_mechanics"].keys())
        assert isinstance(trade["explanation_plain_english"], str)
        assert trade["decision"]["triggering_prior_trade"] is not None
        assert isinstance(trade["evidence"]["rule_hits"], list)

        out_of_range = client.get(f"/jobs/{job_id}/trade/999999")
        assert out_of_range.status_code == 404
        out_payload = out_of_range.json()
        assert out_payload["ok"] is False
        assert out_payload["error"]["code"] == "TRADE_NOT_FOUND"
    finally:
        main_module.OUTPUTS_DIR = original_outputs
        tmp.cleanup()


def test_trade_voice_happy_path_generates_audio_and_get_streams() -> None:
    client, tmp, original_outputs = _client_with_temp_outputs()
    original_generate_trade_coach = main_module.generate_trade_coach_via_vertex
    original_synthesize = main_module.synthesize_with_elevenlabs
    try:
        csv = _calm_csv_slice()
        create = client.post(
            "/jobs",
            files={"file": ("voice_source.csv", csv, "text/csv")},
            data={"user_id": "voice_user"},
        )
        assert create.status_code == 202
        job_id = create.json()["job"]["job_id"]
        terminal = _wait_for_terminal(client, job_id)
        assert terminal["job"]["execution_status"] == "COMPLETED"

        trade_id = 0
        trade_response = client.get(f"/jobs/{job_id}/trade/{trade_id}")
        assert trade_response.status_code == 200
        trade_payload = trade_response.json()["data"]["trade"]
        metric_refs = main_module._trade_metric_refs(trade_payload)
        label = str(trade_payload["label"]).upper()

        def _fake_trade_vertex(_: dict) -> dict:
            return {
                "version": 1,
                "trade_id": trade_id,
                "label": label,
                "llm_explanation": "Hold discipline after emotionally charged losses.",
                "actionable_fix": "Reduce size to your rolling median for next setup.",
                "confidence_note": "Derived from deterministic replay metrics only.",
                "metric_refs": metric_refs,
            }

        main_module.generate_trade_coach_via_vertex = _fake_trade_vertex
        main_module.synthesize_with_elevenlabs = lambda _text: b"fake-mp3-bytes"

        post = client.post(f"/jobs/{job_id}/trade/{trade_id}/voice?provider=elevenlabs")
        assert post.status_code == 200
        post_payload = post.json()
        assert post_payload["ok"] is True
        assert post_payload["data"]["voice"]["provider"] == "elevenlabs"

        audio_path = Path(tmp.name) / "outputs" / job_id / f"trade_coach_voice_{trade_id}.mp3"
        assert audio_path.exists()
        assert audio_path.read_bytes() == b"fake-mp3-bytes"

        get_audio = client.get(f"/jobs/{job_id}/trade/{trade_id}/voice")
        assert get_audio.status_code == 200
        assert get_audio.headers.get("content-type", "").startswith("audio/mpeg")
        assert get_audio.content == b"fake-mp3-bytes"
    finally:
        main_module.generate_trade_coach_via_vertex = original_generate_trade_coach
        main_module.synthesize_with_elevenlabs = original_synthesize
        main_module.OUTPUTS_DIR = original_outputs
        tmp.cleanup()


def test_trade_voice_provider_failure_returns_502_and_error_artifact() -> None:
    client, tmp, original_outputs = _client_with_temp_outputs()
    original_generate_trade_coach = main_module.generate_trade_coach_via_vertex
    original_synthesize = main_module.synthesize_with_elevenlabs
    try:
        csv = _calm_csv_slice()
        create = client.post(
            "/jobs",
            files={"file": ("voice_failure_source.csv", csv, "text/csv")},
            data={"user_id": "voice_user"},
        )
        assert create.status_code == 202
        job_id = create.json()["job"]["job_id"]
        terminal = _wait_for_terminal(client, job_id)
        assert terminal["job"]["execution_status"] == "COMPLETED"

        trade_id = 0
        trade_response = client.get(f"/jobs/{job_id}/trade/{trade_id}")
        assert trade_response.status_code == 200
        trade_payload = trade_response.json()["data"]["trade"]
        metric_refs = main_module._trade_metric_refs(trade_payload)
        label = str(trade_payload["label"]).upper()

        def _fake_trade_vertex(_: dict) -> dict:
            return {
                "version": 1,
                "trade_id": trade_id,
                "label": label,
                "llm_explanation": "Do not chase losses.",
                "actionable_fix": "Use a strict cooldown after losses.",
                "confidence_note": "Derived from deterministic replay metrics only.",
                "metric_refs": metric_refs,
            }

        def _raise_synth(_: str) -> bytes:
            raise main_module.VoiceProviderError("voice provider timeout")

        main_module.generate_trade_coach_via_vertex = _fake_trade_vertex
        main_module.synthesize_with_elevenlabs = _raise_synth

        post = client.post(f"/jobs/{job_id}/trade/{trade_id}/voice?provider=elevenlabs")
        assert post.status_code == 502
        post_payload = post.json()
        assert post_payload["ok"] is False
        assert post_payload["error"]["code"] == "TRADE_VOICE_GENERATION_FAILED"

        error_path = Path(tmp.name) / "outputs" / job_id / f"trade_coach_voice_error_{trade_id}.json"
        assert error_path.exists()
    finally:
        main_module.generate_trade_coach_via_vertex = original_generate_trade_coach
        main_module.synthesize_with_elevenlabs = original_synthesize
        main_module.OUTPUTS_DIR = original_outputs
        tmp.cleanup()


def test_trade_voice_force_true_recovers_after_cached_trade_coach_failure() -> None:
    client, tmp, original_outputs = _client_with_temp_outputs()
    original_generate_trade_coach = main_module.generate_trade_coach_via_vertex
    original_synthesize = main_module.synthesize_with_elevenlabs
    try:
        csv = _calm_csv_slice()
        create = client.post(
            "/jobs",
            files={"file": ("voice_force_recovery_source.csv", csv, "text/csv")},
            data={"user_id": "voice_user"},
        )
        assert create.status_code == 202
        job_id = create.json()["job"]["job_id"]
        terminal = _wait_for_terminal(client, job_id)
        assert terminal["job"]["execution_status"] == "COMPLETED"

        trade_id = 0
        trade_response = client.get(f"/jobs/{job_id}/trade/{trade_id}")
        assert trade_response.status_code == 200
        trade_payload = trade_response.json()["data"]["trade"]
        metric_refs = main_module._trade_metric_refs(trade_payload)
        label = str(trade_payload["label"]).upper()

        calls = {"count": 0}

        def _flaky_trade_vertex(_: dict) -> dict:
            calls["count"] += 1
            if calls["count"] == 1:
                raise RuntimeError("forced first failure")
            return {
                "version": 1,
                "trade_id": trade_id,
                "label": label,
                "llm_explanation": "Keep composure after losses.",
                "actionable_fix": "Use your median size until momentum stabilizes.",
                "confidence_note": "Derived from deterministic replay metrics only.",
                "metric_refs": metric_refs,
            }

        main_module.generate_trade_coach_via_vertex = _flaky_trade_vertex
        main_module.synthesize_with_elevenlabs = lambda _text: b"recovered-mp3-bytes"

        first = client.post(f"/jobs/{job_id}/trade/{trade_id}/voice?provider=elevenlabs&force=false")
        assert first.status_code == 502
        assert first.json()["error"]["code"] == "TRADE_COACH_GENERATION_FAILED"

        second = client.post(f"/jobs/{job_id}/trade/{trade_id}/voice?provider=elevenlabs&force=true")
        assert second.status_code == 200
        second_payload = second.json()
        assert second_payload["ok"] is True
        assert second_payload["data"]["voice"]["provider"] == "elevenlabs"

        audio_path = Path(tmp.name) / "outputs" / job_id / f"trade_coach_voice_{trade_id}.mp3"
        assert audio_path.exists()
        assert audio_path.read_bytes() == b"recovered-mp3-bytes"
    finally:
        main_module.generate_trade_coach_via_vertex = original_generate_trade_coach
        main_module.synthesize_with_elevenlabs = original_synthesize
        main_module.OUTPUTS_DIR = original_outputs
        tmp.cleanup()


def test_journal_transcribe_happy_path_persists_transcript_artifact() -> None:
    client, tmp, original_outputs = _client_with_temp_outputs()
    original_transcribe = main_module.transcribe_with_gradium
    try:
        csv = _calm_csv_slice()
        create = client.post(
            "/jobs",
            files={"file": ("journal_voice_source.csv", csv, "text/csv")},
            data={"user_id": "journal_user"},
        )
        assert create.status_code == 202
        job_id = create.json()["job"]["job_id"]
        terminal = _wait_for_terminal(client, job_id)
        assert terminal["job"]["execution_status"] == "COMPLETED"

        main_module.transcribe_with_gradium = lambda _bytes, mime_type: {
            "provider": "gradium",
            "transcript": f"Transcript for {mime_type}",
            "raw": {"ok": True},
        }

        response = client.post(
            f"/jobs/{job_id}/journal/transcribe",
            files={"audio": ("note.wav", b"riff-bytes", "audio/wav")},
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["ok"] is True
        assert payload["data"]["provider"] == "gradium"
        assert payload["data"]["transcript"] == "Transcript for audio/wav"

        transcript_files = list((Path(tmp.name) / "outputs" / job_id).glob("journal_transcript_*.json"))
        assert transcript_files, "expected at least one persisted transcript artifact"
    finally:
        main_module.transcribe_with_gradium = original_transcribe
        main_module.OUTPUTS_DIR = original_outputs
        tmp.cleanup()
