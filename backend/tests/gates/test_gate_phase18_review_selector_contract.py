from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from .conftest import wait_for_terminal


FIXTURE = Path(__file__).resolve().parents[3] / "docs" / "testdata" / "F23_phase18_selector.csv"
POLICY_DOC = Path(__file__).resolve().parents[3] / "docs" / "REVIEW_SELECTOR_POLICY.md"


def _fixture_csv() -> str:
    return FIXTURE.read_text(encoding="utf-8")


def _create_completed_job(client: TestClient, *, user_id: str) -> str:
    create = client.post(
        "/jobs",
        files={"file": ("F23_phase18_selector.csv", _fixture_csv(), "text/csv")},
        data={"user_id": user_id, "run_async": "false"},
    )
    assert create.status_code == 202
    job_id = create.json()["job"]["job_id"]
    terminal = wait_for_terminal(client, job_id, timeout_seconds=120.0)
    assert terminal["job"]["execution_status"] == "COMPLETED"
    return job_id


def test_gate_phase18_diversity_selection_real_csv(
    api_env: tuple[TestClient, Path, object],
) -> None:
    client, _, _ = api_env
    job_id = _create_completed_job(client, user_id="phase18-diversity")

    moments_resp = client.get(f"/jobs/{job_id}/moments")
    assert moments_resp.status_code == 200
    moments = moments_resp.json()["data"]["moments"]
    assert len(moments) == 3

    categories = [str(m.get("bias_category")) for m in moments]
    assert categories == ["revenge", "overtrading", "loss_aversion"]
    assert len(set(categories)) >= 2


def test_gate_phase18_inspector_anchor_contract_real_csv(
    api_env: tuple[TestClient, Path, object],
) -> None:
    client, _, _ = api_env
    job_id = _create_completed_job(client, user_id="phase18-inspector")

    moments = client.get(f"/jobs/{job_id}/moments").json()["data"]["moments"]
    first = moments[0]
    trade_idx = int(first["trace_trade_id"])

    trade_resp = client.get(f"/jobs/{job_id}/trade/{trade_idx}")
    assert trade_resp.status_code == 200
    trade = trade_resp.json()["data"]["trade"]

    assert str(trade["raw_input_row"]["asset"]) == str(first["asset"])
    assert str(trade["raw_input_row"]["timestamp"]).startswith(str(first["timestamp"]))


def test_gate_phase18_human_explanation_and_evidence_contract_real_csv(
    api_env: tuple[TestClient, Path, object],
) -> None:
    client, _, _ = api_env
    job_id = _create_completed_job(client, user_id="phase18-explain")

    moments = client.get(f"/jobs/{job_id}/moments").json()["data"]["moments"]
    assert len(moments) == 3

    for moment in moments:
        explanation = str(moment.get("explanation_human") or "")
        assert explanation.strip() != ""
        # Human-first contract: avoid leaking quantile jargon in first-line explanation.
        assert "p95" not in explanation.lower()
        assert "p85" not in explanation.lower()

        evidence = moment.get("evidence")
        assert isinstance(evidence, dict)
        assert isinstance(evidence.get("rule_signature"), str)
        refs = evidence.get("metric_refs")
        assert isinstance(refs, list) and len(refs) > 0


def test_gate_phase18_selector_policy_doc_present() -> None:
    assert POLICY_DOC.exists(), "docs/REVIEW_SELECTOR_POLICY.md must exist"
    text = POLICY_DOC.read_text(encoding="utf-8")
    assert "diversity" in text.lower()
    assert "revenge" in text.lower()
    assert "overtrading" in text.lower()
    assert "loss aversion" in text.lower()
