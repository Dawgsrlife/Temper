from __future__ import annotations

import hmac
import os
from hashlib import sha256
from pathlib import Path

from fastapi.testclient import TestClient

import app.main as main_module
from .conftest import wait_for_terminal


TESTDATA_DIR = Path(__file__).resolve().parents[3] / "docs" / "testdata"


def _fixture_bytes(name: str = "F20_phase15_uploadthing.csv") -> bytes:
    return (TESTDATA_DIR / name).read_bytes()


def _signature(secret: str, *, user_id: str, file_key: str, original_filename: str) -> str:
    payload = f"{user_id}:{file_key}:{original_filename}".encode("utf-8")
    return hmac.new(secret.encode("utf-8"), payload, sha256).hexdigest()


def _set_uploadthing_secret(value: str) -> str | None:
    previous = os.environ.get("UPLOADTHING_SECRET")
    os.environ["UPLOADTHING_SECRET"] = value
    return previous


def _restore_uploadthing_secret(previous: str | None) -> None:
    if previous is None:
        os.environ.pop("UPLOADTHING_SECRET", None)
    else:
        os.environ["UPLOADTHING_SECRET"] = previous


def test_gate_phase15_uploadthing_ingest_and_supabase_lifecycle(
    api_env: tuple[TestClient, Path, object],
) -> None:
    client, _, fake_supabase = api_env

    secret_prev = _set_uploadthing_secret("phase15-secret")
    original_download = main_module._download_uploadthing_bytes
    try:
        main_module._download_uploadthing_bytes = lambda file_key: _fixture_bytes("F20_phase15_uploadthing.csv")

        user_id = "phase15-uploadthing-user"
        file_key = "demo/f20"
        original_filename = "F20_phase15_uploadthing.csv"
        signature = _signature(
            "phase15-secret",
            user_id=user_id,
            file_key=file_key,
            original_filename=original_filename,
        )

        response = client.post(
            "/jobs/from-uploadthing",
            json={
                "user_id": user_id,
                "file_key": file_key,
                "original_filename": original_filename,
                "run_async": False,
            },
            headers={main_module.UPLOADTHING_SIGNATURE_HEADER: signature},
        )

        assert response.status_code == 202
        body = response.json()
        assert body["ok"] is True
        job_id = body["job"]["job_id"]
        upload = body["job"].get("upload") or {}
        assert upload.get("source") == "uploadthing"
        assert upload.get("file_key") == file_key
        assert upload.get("original_filename") == original_filename
        assert upload.get("byte_size") == len(_fixture_bytes("F20_phase15_uploadthing.csv"))
        assert upload.get("input_sha256") == sha256(_fixture_bytes("F20_phase15_uploadthing.csv")).hexdigest()

        terminal = wait_for_terminal(client, job_id, timeout_seconds=45.0)
        assert terminal["job"]["execution_status"] == "COMPLETED"

        summary_resp = client.get(f"/jobs/{job_id}/summary")
        assert summary_resp.status_code == 200
        summary_data = summary_resp.json()["data"]
        assert summary_data["delta_pnl"] == 0.0
        assert summary_data["cost_of_bias"] == 0.0
        assert summary_data["bias_rates"]["any_bias_rate"] == 0.0

        transitions = [
            row.get("status")
            for row in fake_supabase.upsert_history
            if row.get("id") == job_id
        ]
        assert "PENDING" in transitions
        assert "RUNNING" in transitions
        assert "COMPLETED" in transitions
        assert fake_supabase.artifacts.get(job_id)

        list_resp = client.get(f"/users/{user_id}/jobs")
        assert list_resp.status_code == 200
        jobs = list_resp.json()["data"]["jobs"]
        assert jobs
        assert jobs[0]["job_id"] == job_id
        assert jobs[0]["upload"]["source"] == "uploadthing"
        assert jobs[0]["upload"]["file_key"] == file_key
    finally:
        main_module._download_uploadthing_bytes = original_download
        _restore_uploadthing_secret(secret_prev)


def test_gate_phase15_uploadthing_invalid_signature_rejected(
    api_env: tuple[TestClient, Path, object],
) -> None:
    client, outputs_dir, fake_supabase = api_env

    secret_prev = _set_uploadthing_secret("phase15-secret")
    original_download = main_module._download_uploadthing_bytes
    try:
        main_module._download_uploadthing_bytes = lambda file_key: _fixture_bytes("F20_phase15_uploadthing.csv")

        response = client.post(
            "/jobs/from-uploadthing",
            json={
                "user_id": "phase15-invalid-signature",
                "file_key": "demo/f20-invalid",
                "original_filename": "F20_phase15_uploadthing.csv",
                "run_async": False,
            },
            headers={main_module.UPLOADTHING_SIGNATURE_HEADER: "deadbeef"},
        )

        assert response.status_code == 401
        body = response.json()
        assert body["ok"] is False
        assert body["error"]["code"] == "INVALID_UPLOADTHING_SIGNATURE"

        assert fake_supabase.upsert_history == []
        assert list(outputs_dir.glob("*")) == []
    finally:
        main_module._download_uploadthing_bytes = original_download
        _restore_uploadthing_secret(secret_prev)


def test_gate_phase15_coach_status_persisted_after_generation(
    api_env: tuple[TestClient, Path, object],
) -> None:
    client, _, fake_supabase = api_env

    secret_prev = _set_uploadthing_secret("phase15-secret")
    original_download = main_module._download_uploadthing_bytes
    original_vertex = main_module.generate_coach_via_vertex
    try:
        # Use F19 here because deterministic move-review generation requires richer review thresholds.
        main_module._download_uploadthing_bytes = lambda file_key: _fixture_bytes("F19_phase14_personalization.csv")

        user_id = "phase15-coach-user"
        file_key = "demo/f20-coach"
        original_filename = "F19_phase14_personalization.csv"
        signature = _signature(
            "phase15-secret",
            user_id=user_id,
            file_key=file_key,
            original_filename=original_filename,
        )

        create = client.post(
            "/jobs/from-uploadthing",
            json={
                "user_id": user_id,
                "file_key": file_key,
                "original_filename": original_filename,
                "run_async": False,
            },
            headers={main_module.UPLOADTHING_SIGNATURE_HEADER: signature},
        )
        assert create.status_code == 202
        job_id = create.json()["job"]["job_id"]
        terminal = wait_for_terminal(client, job_id, timeout_seconds=45.0)
        assert terminal["job"]["execution_status"] == "COMPLETED"

        def _fake_vertex(payload: dict) -> dict:
            move_review = payload.get("move_review") or []
            return {
                "version": 1,
                "headline": "Post-hoc coaching generated.",
                "diagnosis": [
                    {
                        "bias": "OVERTRADING",
                        "severity": 2,
                        "evidence": ["any_bias_rate=0.0 with stable cadence across the session."],
                        "metric_refs": [{"name": "any_bias_rate", "value": 0.0, "unit": "rate"}],
                    }
                ],
                "plan": [
                    {
                        "title": "Maintain current discipline profile",
                        "steps": ["Keep cadence stable", "Keep risk sizing stable"],
                        "time_horizon": "NEXT_SESSION",
                    }
                ],
                "do_next_session": ["Repeat current process."],
                "disclaimer": "Coach is post-hoc and cannot alter deterministic facts.",
                "move_review": move_review,
            }

        main_module.generate_coach_via_vertex = _fake_vertex

        coach_resp = client.post(f"/jobs/{job_id}/coach")
        assert coach_resp.status_code == 200
        coach = coach_resp.json()["data"]["coach"]
        assert len(coach["move_review"]) == 3

        row = fake_supabase.jobs[job_id]
        assert row.get("coach_status") == "COMPLETED"
        assert row.get("coach_error_type") in (None, "")
        assert "coach_json" in fake_supabase.artifacts.get(job_id, {})
    finally:
        main_module._download_uploadthing_bytes = original_download
        main_module.generate_coach_via_vertex = original_vertex
        _restore_uploadthing_secret(secret_prev)
