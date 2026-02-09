from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from .conftest import wait_for_terminal


def _fixture_csv() -> str:
    path = Path(__file__).resolve().parents[3] / "docs" / "testdata" / "F14_phase11_heatmap.csv"
    return path.read_text(encoding="utf-8")


def test_gate_phase11_heatmap_contract_with_real_csv(
    api_env: tuple[TestClient, object, object],
) -> None:
    client, _, _ = api_env

    create = client.post(
        "/jobs",
        files={"file": ("F14_phase11_heatmap.csv", _fixture_csv(), "text/csv")},
        data={"user_id": "phase11-user", "run_async": "false"},
    )
    assert create.status_code == 202
    job_id = create.json()["job"]["job_id"]
    terminal = wait_for_terminal(client, job_id, timeout_seconds=30.0)
    assert terminal["job"]["execution_status"] == "COMPLETED"

    # Summary sanity locks baseline economics for this fixture.
    summary = client.get(f"/jobs/{job_id}/summary")
    assert summary.status_code == 200
    summary_body = summary.json()
    assert summary_body["ok"] is True
    data = summary_body["data"]
    assert data["delta_pnl"] == 1180.0
    assert data["cost_of_bias"] == 1180.0
    assert data["bias_rates"]["loss_aversion_rate"] == 2.0 / 7.0

    heatmap = client.get(f"/jobs/{job_id}/counterfactual/heatmap?granularity=hour")
    assert heatmap.status_code == 200
    heatmap_body = heatmap.json()
    assert heatmap_body["ok"] is True
    payload = heatmap_body["data"]

    assert payload["granularity"] == "hour"
    assert payload["total_cells"] == 3
    cells = payload["cells"]
    assert len(cells) == 3

    # 09:00 hour bucket
    c0 = cells[0]
    assert c0["bucket_start"] == "2025-03-15T09:00:00"
    assert c0["trade_count"] == 3
    assert c0["modified_count"] == 1
    assert c0["bias_count"] == 1
    assert c0["actual_pnl"] == -530.0
    assert c0["policy_replay_pnl"] == -90.0
    assert c0["impact_abs_total"] == 440.0
    assert c0["bias_breakdown"] == {
        "loss_aversion": 1,
        "revenge": 0,
        "overtrading": 0,
    }

    # 10:00 hour bucket
    c1 = cells[1]
    assert c1["bucket_start"] == "2025-03-15T10:00:00"
    assert c1["trade_count"] == 2
    assert c1["modified_count"] == 1
    assert c1["bias_count"] == 1
    assert c1["actual_pnl"] == -820.0
    assert c1["policy_replay_pnl"] == -80.0
    assert c1["impact_abs_total"] == 740.0
    assert c1["bias_breakdown"] == {
        "loss_aversion": 1,
        "revenge": 0,
        "overtrading": 0,
    }

    # 11:00 hour bucket
    c2 = cells[2]
    assert c2["bucket_start"] == "2025-03-15T11:00:00"
    assert c2["trade_count"] == 2
    assert c2["modified_count"] == 0
    assert c2["bias_count"] == 0
    assert c2["actual_pnl"] == 50.0
    assert c2["policy_replay_pnl"] == 50.0
    assert c2["impact_abs_total"] == 0.0
    assert c2["bias_breakdown"] == {
        "loss_aversion": 0,
        "revenge": 0,
        "overtrading": 0,
    }

    totals = payload["totals"]
    assert totals["trade_count"] == 7
    assert totals["modified_count"] == 2
    assert totals["bias_count"] == 2
    assert totals["actual_pnl"] == -1300.0
    assert totals["policy_replay_pnl"] == -120.0
    assert totals["impact_abs_total"] == 1180.0
