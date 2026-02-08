from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

import app.main as main_module
from .conftest import wait_for_terminal


def _dataset_csv(name: str) -> str:
    path = Path(__file__).resolve().parents[3] / "trading_datasets" / name
    return path.read_text(encoding="utf-8")


def _create_completed_job(client: TestClient, *, dataset_name: str, user_id: str) -> str:
    create = client.post(
        "/jobs",
        files={"file": (dataset_name, _dataset_csv(dataset_name), "text/csv")},
        data={"user_id": user_id, "run_async": "false"},
    )
    assert create.status_code == 202
    job_id = create.json()["job"]["job_id"]
    terminal = wait_for_terminal(client, job_id, timeout_seconds=90.0)
    assert terminal["job"]["execution_status"] == "COMPLETED"
    return job_id


def test_gate_phase7_coach_success_schema_locked_on_real_dataset(
    api_env: tuple[TestClient, object, object],
) -> None:
    client, _, _ = api_env
    job_id = _create_completed_job(
        client,
        dataset_name="overtrader.csv",
        user_id="phase7_coach_success",
    )

    original = main_module.generate_coach_via_vertex
    captured_payload: dict | None = None
    try:
        def _fake_vertex(payload: dict) -> dict:
            nonlocal captured_payload
            captured_payload = dict(payload)
            move_review = payload.get("move_review") or []
            return {
                "version": 1,
                "headline": "Policy replay highlights concentrated overtrading risk.",
                "diagnosis": [
                    {
                        "bias": "OVERTRADING",
                        "severity": 4,
                        "evidence": [
                            "Overtrading rate was 98.0 and top move impact was 954.5107623451."
                        ],
                        "metric_refs": [
                            {"name": "overtrading_rate", "value": 0.98, "unit": "ratio"},
                            {"name": "top_move_impact", "value": 954.5107623451, "unit": "usd"},
                        ],
                    }
                ],
                "plan": [
                    {
                        "title": "Enforce cooldown after bursts",
                        "steps": [
                            "Set a hard trades-per-hour cap.",
                            "Pause entries for 30 minutes after threshold breach.",
                        ],
                        "time_horizon": "NEXT_SESSION",
                    }
                ],
                "do_next_session": [
                    "Track hourly trade count in real time.",
                    "Stop taking entries once cooldown triggers.",
                ],
                "disclaimer": "Coaching is post-hoc and does not alter deterministic engine outputs.",
                "move_review": move_review,
            }

        main_module.generate_coach_via_vertex = _fake_vertex

        response = client.post(f"/jobs/{job_id}/coach")
        assert response.status_code == 200
        body = response.json()
        assert body["ok"] is True
        coach = body["data"]["coach"]
        assert coach["version"] == 1
        assert isinstance(coach["move_review"], list)
        assert len(coach["move_review"]) == 3
        assert captured_payload is not None
        deterministic = captured_payload.get("move_review") or []
        assert len(deterministic) == 3
        assert coach["move_review"] == deterministic

        # Ensure persisted artifact can be read back through GET endpoint.
        get_response = client.get(f"/jobs/{job_id}/coach")
        assert get_response.status_code == 200
        get_body = get_response.json()
        assert get_body["ok"] is True
        assert get_body["data"]["coach"]["move_review"] == deterministic
    finally:
        main_module.generate_coach_via_vertex = original


def test_gate_phase7_coach_forced_failure_structured_on_real_dataset(
    api_env: tuple[TestClient, object, object],
) -> None:
    client, _, _ = api_env
    job_id = _create_completed_job(
        client,
        dataset_name="revenge_trader.csv",
        user_id="phase7_coach_failure",
    )

    original = main_module.generate_coach_via_vertex
    try:
        def _raise_vertex(_: dict) -> dict:
            raise RuntimeError("forced phase7 vertex failure")

        main_module.generate_coach_via_vertex = _raise_vertex

        response = client.post(f"/jobs/{job_id}/coach")
        assert response.status_code == 502
        body = response.json()
        assert body["ok"] is False
        assert body["error"]["code"] == "COACH_GENERATION_FAILED"
        assert "coach_error" in body["data"]
        assert body["data"]["coach_error"]["error_type"] in {"RuntimeError", "CoachGenerationError"}
        assert "forced phase7 vertex failure" in body["data"]["coach_error"]["error_message"]

        get_response = client.get(f"/jobs/{job_id}/coach")
        assert get_response.status_code == 409
        get_body = get_response.json()
        assert get_body["ok"] is False
        assert get_body["error"]["code"] == "COACH_FAILED"
        assert "coach_error" in get_body["data"]
    finally:
        main_module.generate_coach_via_vertex = original

