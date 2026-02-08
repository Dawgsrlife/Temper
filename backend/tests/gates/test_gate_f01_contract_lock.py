from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from .conftest import wait_for_terminal


def _f01_csv() -> str:
    path = Path(__file__).resolve().parents[3] / "docs" / "testdata" / "F01_core_replay.csv"
    return path.read_text(encoding="utf-8")


def _assert_close(actual: float | None, expected: float, tol: float = 1e-6) -> None:
    if actual is None:
        raise AssertionError(f"expected {expected}, got None")
    if abs(float(actual) - float(expected)) > tol:
        raise AssertionError(f"expected {expected}, got {actual}")


def test_gate_f01_baseline_summary_and_top_moment_contract(
    api_env: tuple[TestClient, object, object],
) -> None:
    client, _, _ = api_env

    create = client.post(
        "/jobs",
        files={"file": ("F01_core_replay.csv", _f01_csv(), "text/csv")},
        data={"user_id": "gate_f01_user", "run_async": "false"},
    )
    assert create.status_code == 202
    job_id = create.json()["job"]["job_id"]

    terminal = wait_for_terminal(client, job_id, timeout_seconds=30.0)
    assert terminal["job"]["execution_status"] == "COMPLETED"

    summary = client.get(f"/jobs/{job_id}/summary")
    assert summary.status_code == 200
    summary_payload = summary.json()
    assert summary_payload["ok"] is True
    data = summary_payload["data"]

    _assert_close(data.get("delta_pnl"), 9900.0)
    _assert_close(data.get("cost_of_bias"), 9900.0)
    assert data.get("headline") == "WINNER"
    assert isinstance(data.get("top_moments"), list)
    assert len(data["top_moments"]) > 0

    moments = client.get(f"/jobs/{job_id}/moments")
    assert moments.status_code == 200
    moments_payload = moments.json()
    assert moments_payload["ok"] is True
    rows = moments_payload["data"]["moments"]
    assert len(rows) == 3

    first = rows[0]
    # This locks the current deterministic behavior for F01.
    assert first["asset"] == "NVDA"
    assert first["reason"] == "LOSS_AVERSION_CAPPED"
    _assert_close(first.get("pnl"), -10000.0)
    _assert_close(first.get("simulated_pnl"), -300.0)
    _assert_close(first.get("impact_abs"), 9700.0)


def test_gate_trade_inspector_is_zero_based_trace_index(
    api_env: tuple[TestClient, object, object],
) -> None:
    client, _, _ = api_env

    create = client.post(
        "/jobs",
        files={"file": ("F01_core_replay.csv", _f01_csv(), "text/csv")},
        data={"user_id": "gate_trade_index_user", "run_async": "false"},
    )
    assert create.status_code == 202
    job_id = create.json()["job"]["job_id"]
    terminal = wait_for_terminal(client, job_id, timeout_seconds=30.0)
    assert terminal["job"]["execution_status"] == "COMPLETED"

    trade0 = client.get(f"/jobs/{job_id}/trade/0")
    assert trade0.status_code == 200
    trade0_payload = trade0.json()["data"]["trade"]
    assert trade0_payload["trade_id"] == 0
    assert trade0_payload["raw_input_row"]["trade_id"] == 1

    trade5 = client.get(f"/jobs/{job_id}/trade/5")
    assert trade5.status_code == 200
    trade5_payload = trade5.json()["data"]["trade"]
    assert trade5_payload["trade_id"] == 5
    assert trade5_payload["raw_input_row"]["trade_id"] == 6

    out_of_range = client.get(f"/jobs/{job_id}/trade/6")
    assert out_of_range.status_code == 404
    out_payload = out_of_range.json()
    assert out_payload["ok"] is False
    assert out_payload["error"]["code"] == "TRADE_NOT_FOUND"

