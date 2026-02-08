from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

import app.main as main_module
from .conftest import wait_for_terminal


TESTDATA = Path(__file__).resolve().parents[3] / "docs" / "testdata"
SCRIPT_PATH = Path(__file__).resolve().parents[3] / "backend" / "scripts" / "judge_demo.sh"


def _fixture_csv(name: str) -> str:
    return (TESTDATA / name).read_text(encoding="utf-8")


def _create_completed_job(client: TestClient, *, fixture_name: str, user_id: str) -> str:
    create = client.post(
        "/jobs",
        files={"file": (fixture_name, _fixture_csv(fixture_name), "text/csv")},
        data={"user_id": user_id, "run_async": "false"},
    )
    assert create.status_code == 202
    job_id = create.json()["job"]["job_id"]
    terminal = wait_for_terminal(client, job_id, timeout_seconds=90.0)
    assert terminal["job"]["execution_status"] == "COMPLETED"
    return job_id


def test_gate_phase19_happy_path_real_fixture_contract(
    api_env: tuple[TestClient, Path, object],
) -> None:
    client, _, _ = api_env
    original_vertex = main_module.generate_coach_via_vertex
    try:
        job_id = _create_completed_job(
            client,
            fixture_name="F24_phase19_judge.csv",
            user_id="phase19-happy",
        )

        summary = client.get(f"/jobs/{job_id}/summary")
        assert summary.status_code == 200
        summary_data = summary.json()["data"]
        assert summary_data["headline"] == "WINNER"
        assert summary_data["delta_pnl"] == 66.0
        assert summary_data["cost_of_bias"] == 66.0
        assert summary_data["bias_rates"]["loss_aversion_rate"] == 1.0 / 12.0

        series = client.get(f"/jobs/{job_id}/counterfactual/series?max_points=6")
        assert series.status_code == 200
        points = series.json()["data"]["points"]
        assert len(points) == 6

        moments = client.get(f"/jobs/{job_id}/moments")
        assert moments.status_code == 200
        moment_rows = moments.json()["data"]["moments"]
        assert len(moment_rows) == 3
        assert moment_rows[0]["trade_grade"] == "MEGABLUNDER"
        assert moment_rows[0]["asset"] == "GOOG"

        first_trade_idx = int(moment_rows[0]["trace_trade_id"])
        trade = client.get(f"/jobs/{job_id}/trade/{first_trade_idx}")
        assert trade.status_code == 200
        trade_data = trade.json()["data"]["trade"]
        assert trade_data["decision"]["reason"] == "LOSS_AVERSION_CAPPED"

        def _fake_vertex(payload: dict) -> dict:
            move_review = payload.get("move_review") or []
            return {
                "version": 1,
                "headline": "Coach summary for phase19.",
                "diagnosis": [
                    {
                        "bias": "LOSS_AVERSION",
                        "severity": 3,
                        "evidence": ["cost_of_bias=70.0 with one outsized loss."],
                        "metric_refs": [{"name": "cost_of_bias", "value": 70.0, "unit": "usd"}],
                    }
                ],
                "plan": [
                    {
                        "title": "Use tighter downside cap near your median win profile",
                        "steps": ["Apply stop-loss cap", "Review outsized losses"],
                        "time_horizon": "NEXT_SESSION",
                    }
                ],
                "do_next_session": ["Use predefined downside cap before each trade."],
                "disclaimer": "Post-hoc coach; deterministic facts unchanged.",
                "move_review": move_review,
            }

        main_module.generate_coach_via_vertex = _fake_vertex

        coach_post = client.post(f"/jobs/{job_id}/coach")
        assert coach_post.status_code == 200
        coach = coach_post.json()["data"]["coach"]
        assert len(coach["move_review"]) == 3
        assert coach["plan"][0]["title"].startswith("Use tighter downside cap")

        coach_get = client.get(f"/jobs/{job_id}/coach")
        assert coach_get.status_code == 200
        coach_ref = coach_get.json()["data"]["coach"]["move_review"][0]["metric_refs"][0]
        assert coach_ref["name"] == "impact_abs"
        assert coach_ref["value"] == 66.0

        history = client.get("/users/phase19-happy/jobs?limit=1")
        assert history.status_code == 200
        jobs = history.json()["data"]["jobs"]
        assert jobs and jobs[0]["job_id"] == job_id
    finally:
        main_module.generate_coach_via_vertex = original_vertex


def test_gate_phase19_failure_path_real_fixture_contract(
    api_env: tuple[TestClient, Path, object],
) -> None:
    client, _, _ = api_env

    create = client.post(
        "/jobs",
        files={"file": ("F05_malformed.csv", _fixture_csv("F05_malformed.csv"), "text/csv")},
        data={"user_id": "phase19-fail", "run_async": "false"},
    )
    assert create.status_code == 202
    job_id = create.json()["job"]["job_id"]

    terminal = wait_for_terminal(client, job_id, timeout_seconds=90.0)
    assert terminal["job"]["execution_status"] == "FAILED"
    assert terminal["data"]["error_type"] == "ValueError"
    assert "Timestamp parsing failed" in str(terminal["data"]["error_message"])


def test_gate_phase19_judge_demo_script_contract_text() -> None:
    text = SCRIPT_PATH.read_text(encoding="utf-8")
    # Happy path output requirement.
    assert "personalized_evidence:" in text
    # Failure path output requirement.
    assert "error_type" in text
    assert "error_message" in text
