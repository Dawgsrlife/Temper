from __future__ import annotations

import json
import tempfile
import time
from pathlib import Path

from fastapi.testclient import TestClient

import app.main as main_module

TERMINAL = {"COMPLETED", "FAILED", "TIMEOUT"}


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
