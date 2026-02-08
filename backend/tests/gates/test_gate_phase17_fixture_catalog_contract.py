from __future__ import annotations

import hashlib
from pathlib import Path

from fastapi.testclient import TestClient

from .conftest import wait_for_terminal


TESTDATA = Path(__file__).resolve().parents[3] / "docs" / "testdata"
CATALOG_DOC = Path(__file__).resolve().parents[3] / "docs" / "FIXTURE_CATALOG.md"


FIXTURE_EXPECTATIONS = {
    "F01_core_replay.csv": {"status": "COMPLETED", "headline": "WINNER", "delta": 9900.0, "moments_len": 3},
    "F02_overtrading_burst.csv": {"status": "COMPLETED", "headline": "DRAW", "delta": 0.0, "moments_len": 3},
    "F03_revenge_episode.csv": {"status": "COMPLETED", "headline": "DRAW", "delta": 0.0, "moments_len": 3},
    "F04_loss_aversion.csv": {"status": "COMPLETED", "headline": "WINNER", "delta": 1860.0, "moments_len": 3},
    "F05_malformed.csv": {"status": "FAILED", "headline": None, "delta": 0.0, "moments_status": 409, "moments_code": "COUNTERFACTUAL_NOT_READY"},
    "F06_timeline_dense.csv": {"status": "COMPLETED", "headline": "DRAW", "delta": 0.0, "moments_len": 3},
    "F07_alias_contract.csv": {"status": "COMPLETED", "headline": "DRAW", "delta": 0.0, "moments_len": 3},
    "F08_20x_scale_hint.csv": {"status": "COMPLETED", "headline": "DRAW", "delta": 0.0, "moments_len": 3},
}


def _fixture_csv(name: str) -> str:
    return (TESTDATA / name).read_text(encoding="utf-8")


def _create_job(client: TestClient, *, fixture_name: str, user_id: str) -> str:
    response = client.post(
        "/jobs",
        files={"file": (fixture_name, _fixture_csv(fixture_name), "text/csv")},
        data={"user_id": user_id, "run_async": "false"},
    )
    assert response.status_code == 202
    job_id = response.json()["job"]["job_id"]
    return job_id


def test_gate_phase17_fixture_matrix_validity_real_csv(
    api_env: tuple[TestClient, Path, object],
) -> None:
    client, _, _ = api_env

    for fixture_name, expected in FIXTURE_EXPECTATIONS.items():
        job_id = _create_job(client, fixture_name=fixture_name, user_id=f"phase17-{fixture_name}")
        terminal = wait_for_terminal(client, job_id, timeout_seconds=60.0)
        assert terminal["job"]["execution_status"] == expected["status"]

        summary_resp = client.get(f"/jobs/{job_id}/summary")
        assert summary_resp.status_code == 200
        summary_data = summary_resp.json()["data"]
        assert summary_data["headline"] == expected["headline"]
        assert summary_data["delta_pnl"] == expected["delta"]

        moments_resp = client.get(f"/jobs/{job_id}/moments")
        if expected["status"] == "FAILED":
            assert moments_resp.status_code == expected["moments_status"]
            body = moments_resp.json()
            assert body["error"]["code"] == expected["moments_code"]
            assert body["data"]["moments"] == []
        else:
            assert moments_resp.status_code == 200
            moments = moments_resp.json()["data"]["moments"]
            assert len(moments) == expected["moments_len"]


def test_gate_phase17_determinism_audit_real_csv(
    api_env: tuple[TestClient, Path, object],
) -> None:
    client, outputs_dir, _ = api_env

    fixture = "F22_phase17_determinism.csv"
    job_id_1 = _create_job(client, fixture_name=fixture, user_id="phase17-determinism-a")
    wait_for_terminal(client, job_id_1, timeout_seconds=60.0)

    job_id_2 = _create_job(client, fixture_name=fixture, user_id="phase17-determinism-b")
    wait_for_terminal(client, job_id_2, timeout_seconds=60.0)

    summary_1 = client.get(f"/jobs/{job_id_1}/summary").json()["data"]
    summary_2 = client.get(f"/jobs/{job_id_2}/summary").json()["data"]
    moments_1 = client.get(f"/jobs/{job_id_1}/moments").json()["data"]["moments"]
    moments_2 = client.get(f"/jobs/{job_id_2}/moments").json()["data"]["moments"]

    assert summary_1 == summary_2
    assert moments_1 == moments_2
    assert summary_1["headline"] == "WINNER"
    assert summary_1["delta_pnl"] == 6360.0
    assert summary_1["cost_of_bias"] == 6360.0
    assert summary_1["bias_rates"]["loss_aversion_rate"] == 0.2222222222222222

    p1 = outputs_dir / job_id_1
    p2 = outputs_dir / job_id_2
    for artifact in ["counterfactual.csv", "review.json"]:
        h1 = hashlib.sha256((p1 / artifact).read_bytes()).hexdigest()
        h2 = hashlib.sha256((p2 / artifact).read_bytes()).hexdigest()
        assert h1 == h2, f"artifact hash drifted for {artifact}"


def test_gate_phase17_fixture_catalog_doc_present() -> None:
    assert CATALOG_DOC.exists(), "docs/FIXTURE_CATALOG.md must exist"
    text = CATALOG_DOC.read_text(encoding="utf-8")
    for name in [
        "F01_core_replay.csv",
        "F05_malformed.csv",
        "F08_20x_scale_hint.csv",
        "F22_phase17_determinism.csv",
    ]:
        assert name in text
