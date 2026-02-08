from __future__ import annotations

import time

from fastapi.testclient import TestClient

from .conftest import golden_bias_csv, wait_for_terminal


def _wait_for_api_terminal(client: TestClient, job_id: str, timeout_seconds: float = 20.0) -> dict:
    deadline = time.time() + timeout_seconds
    last_payload: dict | None = None
    while time.time() < deadline:
        response = client.get(f"/api/jobs/{job_id}")
        assert response.status_code == 200
        payload = response.json()
        last_payload = payload
        if payload.get("status") in {"COMPLETED", "FAILED"}:
            return payload
        time.sleep(0.1)
    raise AssertionError(f"api job {job_id} did not reach terminal status; last={last_payload}")


def test_gate_api_alias_upload_analyze_and_history_contract(
    api_env: tuple[TestClient, object, object],
) -> None:
    client, _, _ = api_env

    upload = client.post(
        "/api/upload",
        files={"file": ("golden_bias_smoke.csv", golden_bias_csv(), "text/csv")},
        data={"userId": "alias_user"},
    )
    assert upload.status_code == 202
    upload_payload = upload.json()
    assert isinstance(upload_payload.get("jobId"), str)
    job_id = upload_payload["jobId"]
    assert upload_payload.get("status") == "PENDING"
    assert isinstance(upload_payload.get("validRows"), int)
    assert isinstance(upload_payload.get("parseErrors"), list)

    analyze = client.post("/api/analyze", json={"jobId": job_id})
    assert analyze.status_code == 200
    analyze_payload = analyze.json()
    assert analyze_payload.get("jobId") == job_id
    assert analyze_payload.get("status") in {"PROCESSING", "COMPLETED", "FAILED"}

    wait_for_terminal(client, job_id, timeout_seconds=30.0)
    api_terminal = _wait_for_api_terminal(client, job_id, timeout_seconds=10.0)
    assert api_terminal["status"] == "COMPLETED"
    assert api_terminal.get("sessionIds") == [job_id]

    summary = client.get(f"/jobs/{job_id}/summary")
    assert summary.status_code == 200
    summary_payload = summary.json()
    assert summary_payload["ok"] is True
    assert "headline" in summary_payload["data"]
    assert "delta_pnl" in summary_payload["data"]

    moments = client.get(f"/jobs/{job_id}/moments")
    assert moments.status_code == 200
    moments_payload = moments.json()
    assert moments_payload["ok"] is True
    assert isinstance(moments_payload["data"].get("moments"), list)
    assert len(moments_payload["data"]["moments"]) > 0

    first_trade_id = moments_payload["data"]["moments"][0].get("trace_trade_id")
    assert isinstance(first_trade_id, int)

    trade = client.get(f"/jobs/{job_id}/trade/{first_trade_id}")
    assert trade.status_code == 200
    trade_payload = trade.json()
    assert trade_payload["ok"] is True
    assert trade_payload["data"]["trade"]["trade_id"] == first_trade_id

    history = client.get("/api/history?userId=alias_user&limit=10")
    assert history.status_code == 200
    history_payload = history.json()
    assert isinstance(history_payload.get("reports"), list)
    assert len(history_payload["reports"]) >= 1
    assert history_payload["reports"][0]["sessionId"] == job_id
    assert "currentElo" in history_payload
