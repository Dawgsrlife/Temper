from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi.testclient import TestClient

import app.main as main_module


def _client_with_temp_outputs():
    tmp = tempfile.TemporaryDirectory()
    out_dir = Path(tmp.name) / "outputs"
    out_dir.mkdir(parents=True, exist_ok=True)

    original_outputs = main_module.OUTPUTS_DIR
    main_module.OUTPUTS_DIR = out_dir
    client = TestClient(main_module.app)
    return client, tmp, original_outputs


def test_create_job_completes_and_review_is_fetchable() -> None:
    client, tmp, original_outputs = _client_with_temp_outputs()
    try:
        csv = (
            "timestamp,asset,price,size_usd,side,pnl\n"
            "2026-01-01T09:30:00,BTC,100000,1000,Buy,10\n"
            "2026-01-01T09:31:00,BTC,100100,1200,Sell,-5\n"
        )
        response = client.post(
            "/jobs?user_id=user_api_success",
            content=csv,
            headers={"content-type": "text/csv"},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "COMPLETED"
        job_id = body["job_id"]

        job_res = client.get(f"/jobs/{job_id}")
        assert job_res.status_code == 200
        job = job_res.json()
        assert job["status"] == "COMPLETED"
        assert job["user_id"] == "user_api_success"

        review_res = client.get(f"/jobs/{job_id}/review")
        assert review_res.status_code == 200
        review = review_res.json()
        assert review["execution_status"] == "COMPLETED"
        assert review["headline"] in {"WINNER", "DRAW", "RESIGN", "CHECKMATED"}

        cf_res = client.get(f"/jobs/{job_id}/counterfactual")
        assert cf_res.status_code == 200
        assert "simulated_pnl" in cf_res.text
    finally:
        main_module.OUTPUTS_DIR = original_outputs
        tmp.cleanup()


def test_create_job_invalid_csv_sets_failed_status_with_error() -> None:
    client, tmp, original_outputs = _client_with_temp_outputs()
    try:
        bad_csv = "asset,pnl\nBTC,10\nETH,-5\n"
        response = client.post(
            "/jobs?user_id=user_api_fail",
            content=bad_csv,
            headers={"content-type": "text/csv"},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "FAILED"
        job_id = body["job_id"]

        job_res = client.get(f"/jobs/{job_id}")
        assert job_res.status_code == 200
        job = job_res.json()
        assert job["status"] == "FAILED"
        assert job["summary"]["error_type"] != ""
        assert job["summary"]["error_message"] != ""

        review_res = client.get(f"/jobs/{job_id}/review")
        assert review_res.status_code == 200
        review = review_res.json()
        assert review["execution_status"] == "FAILED"
        assert review["error_type"] != ""
        assert review["error_message"] != ""
    finally:
        main_module.OUTPUTS_DIR = original_outputs
        tmp.cleanup()
