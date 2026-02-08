from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from .conftest import wait_for_terminal


def _dataset_csv(name: str) -> str:
    path = Path(__file__).resolve().parents[3] / "trading_datasets" / name
    return path.read_text(encoding="utf-8")


def _run_job(client: TestClient, *, user_id: str, dataset_name: str) -> tuple[str, dict]:
    create = client.post(
        "/jobs",
        files={"file": (dataset_name, _dataset_csv(dataset_name), "text/csv")},
        data={"user_id": user_id, "run_async": "false"},
    )
    assert create.status_code == 202
    job_id = create.json()["job"]["job_id"]
    terminal = wait_for_terminal(client, job_id, timeout_seconds=60.0)
    assert terminal["job"]["execution_status"] == "COMPLETED"
    summary = client.get(f"/jobs/{job_id}/summary")
    assert summary.status_code == 200
    summary_payload = summary.json()
    assert summary_payload["ok"] is True
    return job_id, summary_payload["data"]


def test_gate_phase6_overtrader_profile_shows_overtrading_dominance(
    api_env: tuple[TestClient, object, object],
) -> None:
    client, _, _ = api_env
    job_id, summary = _run_job(client, user_id="phase6_over", dataset_name="overtrader.csv")
    rates = summary.get("bias_rates") or {}
    over = float(rates.get("overtrading_rate") or 0.0)
    revenge = float(rates.get("revenge_rate") or 0.0)
    loss = float(rates.get("loss_aversion_rate") or 0.0)

    # Real-world expectation by eye for the provided overtrader dataset:
    # overtrading should dominate materially.
    assert over >= 0.80
    assert over > revenge
    assert over > loss

    moments = client.get(f"/jobs/{job_id}/moments")
    assert moments.status_code == 200
    rows = moments.json()["data"]["moments"]
    assert len(rows) > 0
    top_reason = str(rows[0].get("reason") or "")
    assert "OVERTRADING" in top_reason


def test_gate_phase6_revenge_profile_exposes_revenge_signal(
    api_env: tuple[TestClient, object, object],
) -> None:
    client, _, _ = api_env
    job_id, summary = _run_job(client, user_id="phase6_rev", dataset_name="revenge_trader.csv")
    rates = summary.get("bias_rates") or {}
    revenge = float(rates.get("revenge_rate") or 0.0)

    # Expected by eye: revenge dataset should show non-trivial revenge rate.
    assert revenge >= 0.003

    moments = client.get(f"/jobs/{job_id}/moments")
    assert moments.status_code == 200
    rows = moments.json()["data"]["moments"]
    assert len(rows) > 0
    top_reason = str(rows[0].get("reason") or "")
    assert "REVENGE" in top_reason or revenge > 0.005


def test_gate_phase6_loss_averse_vs_calm_profile_separation(
    api_env: tuple[TestClient, object, object],
) -> None:
    client, _, _ = api_env
    _, loss_summary = _run_job(client, user_id="phase6_loss", dataset_name="loss_averse_trader.csv")
    _, calm_summary = _run_job(client, user_id="phase6_calm", dataset_name="calm_trader.csv")

    loss_rates = loss_summary.get("bias_rates") or {}
    calm_rates = calm_summary.get("bias_rates") or {}

    loss_loss_aversion = float(loss_rates.get("loss_aversion_rate") or 0.0)
    calm_loss_aversion = float(calm_rates.get("loss_aversion_rate") or 0.0)
    calm_any = float(calm_rates.get("any_bias_rate") or 0.0)

    # Expected by eye:
    # - loss_averse profile has clearly higher loss_aversion than calm profile.
    # - calm profile remains low-bias overall.
    assert loss_loss_aversion >= 0.08
    assert loss_loss_aversion > calm_loss_aversion
    assert calm_any <= 0.15

