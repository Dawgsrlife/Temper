from __future__ import annotations

from fastapi.testclient import TestClient

from .conftest import wait_for_terminal


def _anomaly_csv() -> str:
    return (
        "timestamp,asset,entry_price,quantity,side,profit_loss,balance\n"
        "2026-01-01T09:30:00,BTC,100,1,Buy,10,1000\n"
        "2026-01-01T09:31:00,,100,2,Sell,-5,900\n"
        "2026-01-01T09:32:00,ETH,100,,Buy,15,800\n"
        "2026-01-01T09:33:00,SOL,100,1,Sell,,700\n"
        "2026-01-01T09:34:00,DOGE,100000,5000,Buy,-3000000,100\n"
    )


def test_gate_data_anomalies_are_flagged_and_api_shape_is_stable(
    api_env: tuple[TestClient, object, object],
) -> None:
    client, _, _ = api_env
    create = client.post(
        "/jobs",
        files={"file": ("anomaly.csv", _anomaly_csv(), "text/csv")},
        data={"user_id": "gate_robustness_user"},
    )
    assert create.status_code == 202
    job_id = create.json()["job"]["job_id"]

    terminal = wait_for_terminal(client, job_id)
    assert terminal["job"]["execution_status"] == "COMPLETED"

    summary = client.get(f"/jobs/{job_id}/summary")
    assert summary.status_code == 200
    payload = summary.json()
    assert payload["ok"] is True
    flags = payload["data"]["data_quality_flags"]
    codes = {str(item.get("code")) for item in flags if isinstance(item, dict)}
    assert "MISSING_FIELDS" in codes
    assert "ASSET_MISSING" in codes
    assert "INCOMPLETE_FOR_BIAS_METRICS" in codes
    assert "IMPLIED_NOTIONAL_TOO_HIGH" in codes
    assert "PNL_TO_BALANCE_OUTLIER" in codes

    series = client.get(f"/jobs/{job_id}/counterfactual/series?max_points=200")
    assert series.status_code == 200
    series_payload = series.json()
    assert series_payload["ok"] is True
    assert isinstance(series_payload["data"]["points"], list)
    assert len(series_payload["data"]["points"]) > 0

    moments = client.get(f"/jobs/{job_id}/moments")
    assert moments.status_code == 200
    moments_payload = moments.json()
    assert moments_payload["ok"] is True
    assert isinstance(moments_payload["data"]["moments"], list)

