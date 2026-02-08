from __future__ import annotations

import time
from pathlib import Path

from fastapi.testclient import TestClient

from .conftest import wait_for_terminal


TESTDATA = Path(__file__).resolve().parents[3] / "docs" / "testdata"
CHECKLIST = Path(__file__).resolve().parents[3] / "docs" / "EXECUTION_CHECKLIST.md"
PLAN20 = Path(__file__).resolve().parents[3] / "docs" / "PLAN20.md"


def _fixture_csv(name: str) -> str:
    return (TESTDATA / name).read_text(encoding="utf-8")


def _create_job(client: TestClient, *, fixture_name: str, user_id: str, timeout: float = 180.0) -> tuple[str, dict]:
    create = client.post(
        "/jobs",
        files={"file": (fixture_name, _fixture_csv(fixture_name), "text/csv")},
        data={"user_id": user_id, "run_async": "false"},
    )
    assert create.status_code == 202
    job_id = create.json()["job"]["job_id"]
    terminal = wait_for_terminal(client, job_id, timeout_seconds=timeout)
    return job_id, terminal


def test_gate_phase20_unseen_scale_and_rubric_contract_real_csv(
    api_env: tuple[TestClient, Path, object],
) -> None:
    client, _, _ = api_env

    # Behavioral insight + creativity via mixed-bias selector fixture.
    bias_job_id, bias_terminal = _create_job(
        client,
        fixture_name="F23_phase18_selector.csv",
        user_id="phase20-rubric-bias",
        timeout=180.0,
    )
    assert bias_terminal["job"]["execution_status"] == "COMPLETED"
    bias_summary = client.get(f"/jobs/{bias_job_id}/summary").json()["data"]
    rates = bias_summary["bias_rates"]
    assert rates["revenge_rate"] > 0.0
    assert rates["overtrading_rate"] > 0.0
    assert rates["loss_aversion_rate"] > 0.0
    bias_moments = client.get(f"/jobs/{bias_job_id}/moments").json()["data"]["moments"]
    categories = [row["bias_category"] for row in bias_moments]
    assert categories == ["revenge", "overtrading", "loss_aversion"]

    # Performance/scalability via unseen 20x-like fixture.
    t0 = time.time()
    unseen_job_id, unseen_terminal = _create_job(
        client,
        fixture_name="F25_phase20_unseen_scale.csv",
        user_id="phase20-rubric-unseen",
        timeout=240.0,
    )
    elapsed = time.time() - t0
    assert unseen_terminal["job"]["execution_status"] == "COMPLETED"
    assert elapsed <= 30.0

    unseen_summary = client.get(f"/jobs/{unseen_job_id}/summary").json()["data"]
    assert unseen_summary["headline"] == "WINNER"
    assert unseen_summary["delta_pnl"] == 5676.603000000003
    assert unseen_summary["cost_of_bias"] == 5676.603000000003

    series = client.get(f"/jobs/{unseen_job_id}/counterfactual/series?max_points=2000").json()["data"]["points"]
    assert len(series) == 2000
    assert series[0]["timestamp"] == "2025-03-25T09:00:00"
    assert series[-1]["timestamp"] == "2025-03-25T22:19:40"


def test_gate_phase20_docs_contract_present() -> None:
    checklist = CHECKLIST.read_text(encoding="utf-8")
    plan20 = PLAN20.read_text(encoding="utf-8")
    assert "Phase 20 - Final Rubric Gate TDD" in checklist
    assert "F25_phase20_unseen_scale.csv" in checklist
    assert "F25_phase20_unseen_scale.csv" in plan20
    assert "F23_phase18_selector.csv" in plan20
