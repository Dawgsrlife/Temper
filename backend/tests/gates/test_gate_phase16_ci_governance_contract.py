from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from .conftest import wait_for_terminal


FIXTURE = Path(__file__).resolve().parents[3] / "docs" / "testdata" / "F21_phase16_governance.csv"
POLICY_DOC = Path(__file__).resolve().parents[3] / "docs" / "GOLDEN_CHANGE_POLICY.md"


def _fixture_csv() -> str:
    return FIXTURE.read_text(encoding="utf-8")


def _create_completed_job(client: TestClient, *, user_id: str) -> str:
    create = client.post(
        "/jobs",
        files={"file": ("F21_phase16_governance.csv", _fixture_csv(), "text/csv")},
        data={"user_id": user_id, "run_async": "false"},
    )
    assert create.status_code == 202
    job_id = create.json()["job"]["job_id"]
    terminal = wait_for_terminal(client, job_id, timeout_seconds=45.0)
    assert terminal["job"]["execution_status"] == "COMPLETED"
    return job_id


def test_gate_phase16_semantic_protection_real_csv(
    api_env: tuple[TestClient, Path, object],
) -> None:
    client, _, _ = api_env
    job_id = _create_completed_job(client, user_id="phase16-semantic")

    summary = client.get(f"/jobs/{job_id}/summary").json()["data"]
    assert summary["headline"] == "WINNER"
    assert summary["delta_pnl"] == 6210.0
    assert summary["cost_of_bias"] == 6210.0
    assert summary["bias_rates"]["loss_aversion_rate"] == 0.25

    # /trade/{idx} is zero-based over trace rows; idx=3 maps to trade_id=4 in fixture.
    trade = client.get(f"/jobs/{job_id}/trade/3").json()["data"]["trade"]
    assert trade["decision"]["reason"] == "LOSS_AVERSION_CAPPED"
    assert trade["decision"]["reason_label"] == "Loss aversion (downside capped)"
    assert trade["counterfactual_mechanics"]["mechanism"] == "EXPOSURE_SCALING"
    assert trade["counterfactual_mechanics"]["scale_factor"] == 0.02
    assert trade["counterfactual_mechanics"]["cap_used"] == 120.0
    assert trade["counterfactual"]["actual_pnl"] == -6000.0
    assert trade["counterfactual"]["simulated_pnl"] == -120.0


def test_gate_phase16_payload_shape_protection_real_csv(
    api_env: tuple[TestClient, Path, object],
) -> None:
    client, _, _ = api_env
    job_id = _create_completed_job(client, user_id="phase16-shape")

    moments = client.get(f"/jobs/{job_id}/moments").json()["data"]["moments"]
    assert len(moments) >= 3

    required_moment_keys = {
        "timestamp",
        "asset",
        "trade_grade",
        "reason",
        "reason_label",
        "decision",
        "counterfactual_mechanics",
        "evidence",
        "explanation_human",
    }
    for moment in moments[:3]:
        missing = required_moment_keys.difference(moment.keys())
        assert not missing, f"moments payload missing keys: {sorted(missing)}"
        mechanics = moment["counterfactual_mechanics"]
        assert isinstance(mechanics, dict)
        assert "mechanism" in mechanics

    trade = client.get(f"/jobs/{job_id}/trade/3").json()["data"]["trade"]
    assert isinstance(trade.get("counterfactual_mechanics"), dict)
    assert trade["counterfactual_mechanics"].get("mechanism") == "EXPOSURE_SCALING"


def test_gate_phase16_golden_update_policy_doc_present() -> None:
    assert POLICY_DOC.exists(), "docs/GOLDEN_CHANGE_POLICY.md must exist"
    text = POLICY_DOC.read_text(encoding="utf-8")
    assert "failing test" in text.lower()
    assert "fix" in text.lower()
    assert "golden" in text.lower()
    assert "same pr" in text.lower() or "same commit" in text.lower()
