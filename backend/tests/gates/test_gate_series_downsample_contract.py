from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from .conftest import wait_for_terminal


def _fixture_csv(name: str) -> str:
    path = Path(__file__).resolve().parents[3] / "docs" / "testdata" / name
    return path.read_text(encoding="utf-8")


def test_gate_series_small_max_points_returns_non_empty_downsample(
    api_env: tuple[TestClient, object, object],
) -> None:
    client, _, _ = api_env
    create = client.post(
        "/jobs",
        files={"file": ("F06_timeline_dense.csv", _fixture_csv("F06_timeline_dense.csv"), "text/csv")},
        data={"user_id": "series_downsample_user", "run_async": "false"},
    )
    assert create.status_code == 202
    job_id = create.json()["job"]["job_id"]
    terminal = wait_for_terminal(client, job_id, timeout_seconds=30.0)
    assert terminal["job"]["execution_status"] == "COMPLETED"

    full = client.get(f"/jobs/{job_id}/counterfactual/series?max_points=2000")
    assert full.status_code == 200
    full_payload = full.json()
    assert full_payload["ok"] is True
    full_points = full_payload["data"]["points"]
    assert len(full_points) == 12

    # Contract lock: small max_points should still return a usable downsample,
    # not an empty/error payload.
    small = client.get(f"/jobs/{job_id}/counterfactual/series?max_points=4")
    assert small.status_code == 200
    small_payload = small.json()
    assert small_payload["ok"] is True
    small_points = small_payload["data"]["points"]
    assert len(small_points) == 4

    # Preserve time boundaries for chart continuity.
    assert small_points[0]["timestamp"] == full_points[0]["timestamp"]
    assert small_points[-1]["timestamp"] == full_points[-1]["timestamp"]

