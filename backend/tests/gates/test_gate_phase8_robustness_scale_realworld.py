from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from .conftest import wait_for_terminal


def _fixture_csv(name: str) -> str:
    path = Path(__file__).resolve().parents[3] / "docs" / "testdata" / name
    return path.read_text(encoding="utf-8")


def _run_completed_job(client: TestClient, *, fixture_name: str, user_id: str) -> tuple[str, dict]:
    create = client.post(
        "/jobs",
        files={"file": (fixture_name, _fixture_csv(fixture_name), "text/csv")},
        data={"user_id": user_id, "run_async": "false"},
    )
    assert create.status_code == 202
    job_id = create.json()["job"]["job_id"]
    terminal = wait_for_terminal(client, job_id, timeout_seconds=60.0)
    assert terminal["job"]["execution_status"] == "COMPLETED"
    summary = client.get(f"/jobs/{job_id}/summary")
    assert summary.status_code == 200
    payload = summary.json()
    assert payload["ok"] is True
    return job_id, payload["data"]


def test_gate_phase8_scale_fixture_has_bounded_series_and_no_data_quality_flags(
    api_env: tuple[TestClient, object, object],
) -> None:
    client, _, _ = api_env
    job_id, summary = _run_completed_job(
        client,
        fixture_name="F10_phase8_scale.csv",
        user_id="phase8_scale_user",
    )

    # By-eye expectation for this synthetic balanced fixture:
    # near-neutral replay with no anomalies.
    assert summary.get("headline") == "DRAW"
    assert float(summary.get("delta_pnl") or 0.0) == 0.0
    assert float(summary.get("cost_of_bias") or 0.0) == 0.0
    assert summary.get("data_quality_flags") in ([], None)

    series_200 = client.get(f"/jobs/{job_id}/counterfactual/series?max_points=200")
    assert series_200.status_code == 200
    payload_200 = series_200.json()
    assert payload_200["ok"] is True
    data_200 = payload_200["data"]
    assert data_200["total_points"] == 240
    assert data_200["returned_points"] == 200
    assert len(data_200["points"]) == 200

    series_4 = client.get(f"/jobs/{job_id}/counterfactual/series?max_points=4")
    assert series_4.status_code == 200
    payload_4 = series_4.json()
    assert payload_4["ok"] is True
    data_4 = payload_4["data"]
    assert data_4["returned_points"] == 4
    assert len(data_4["points"]) == 4

    moments = client.get(f"/jobs/{job_id}/moments")
    assert moments.status_code == 200
    moments_payload = moments.json()
    assert moments_payload["ok"] is True
    rows = moments_payload["data"]["moments"]
    assert len(rows) == 3
    assert rows[0].get("reason") == "NO_BLOCK"


def test_gate_phase8_robust_fixture_surfaces_expected_anomalies_and_stays_stable(
    api_env: tuple[TestClient, object, object],
) -> None:
    client, _, _ = api_env
    job_id, summary = _run_completed_job(
        client,
        fixture_name="F11_phase8_robust.csv",
        user_id="phase8_robust_user",
    )

    # By-eye expectation for malformed-but-processable fixture:
    # should complete, surface deterministic anomaly counts, and keep API stable.
    assert summary.get("headline") == "WINNER"
    assert float(summary.get("delta_pnl") or 0.0) == 102880.0
    assert float(summary.get("cost_of_bias") or 0.0) == 102880.0

    flags = summary.get("data_quality_flags") or []
    by_code = {str(item.get("code")): int(item.get("count") or 0) for item in flags if isinstance(item, dict)}
    assert by_code.get("MISSING_FIELDS") == 2
    assert by_code.get("ASSET_MISSING") == 1
    assert by_code.get("INCOMPLETE_FOR_BIAS_METRICS") == 1
    assert by_code.get("IMPLIED_NOTIONAL_TOO_HIGH") == 1
    assert by_code.get("PNL_TO_BALANCE_OUTLIER") == 1

    series = client.get(f"/jobs/{job_id}/counterfactual/series?max_points=200")
    assert series.status_code == 200
    series_payload = series.json()
    assert series_payload["ok"] is True
    series_data = series_payload["data"]
    assert series_data["total_points"] == 7
    assert series_data["returned_points"] == 7
    assert len(series_data["points"]) == 7

    moments = client.get(f"/jobs/{job_id}/moments")
    assert moments.status_code == 200
    moments_payload = moments.json()
    assert moments_payload["ok"] is True
    rows = moments_payload["data"]["moments"]
    assert len(rows) == 3
    assert rows[0].get("reason") == "LOSS_AVERSION_CAPPED"

