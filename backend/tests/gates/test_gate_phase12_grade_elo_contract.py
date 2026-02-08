from __future__ import annotations

import time
from pathlib import Path

from fastapi.testclient import TestClient

from .conftest import wait_for_terminal


def _fixture_csv(name: str) -> str:
    path = Path(__file__).resolve().parents[3] / "docs" / "testdata" / name
    return path.read_text(encoding="utf-8")


def test_gate_phase12_grade_and_elo_contract_with_real_csvs(
    api_env: tuple[TestClient, object, object],
) -> None:
    client, _, _ = api_env
    user_id = "phase12-user"

    scenarios = [
        {
            "name": "F15_phase12_draw.csv",
            "expected_outcome": "DRAW",
            "expected_delta_pnl": 0.0,
            "expected_elo_delta": 4.0,
            "expected_top_label": "INACCURACY",
        },
        {
            "name": "F16_phase12_winner.csv",
            "expected_outcome": "WINNER",
            "expected_delta_pnl": 2880.0,
            "expected_elo_delta": 8.0,
            "expected_top_label": "MEGABLUNDER",
        },
        {
            "name": "F17_phase12_resign.csv",
            "expected_outcome": "RESIGN",
            "expected_delta_pnl": -522.0,
            "expected_elo_delta": -8.0,
            "expected_top_label": "MISS",
        },
    ]

    created: list[dict[str, object]] = []
    for scenario in scenarios:
        create = client.post(
            "/jobs",
            files={"file": (scenario["name"], _fixture_csv(str(scenario["name"])), "text/csv")},
            data={"user_id": user_id, "run_async": "false"},
        )
        assert create.status_code == 202
        job_id = create.json()["job"]["job_id"]
        terminal = wait_for_terminal(client, job_id, timeout_seconds=30.0)
        assert terminal["job"]["execution_status"] == "COMPLETED"

        summary = client.get(f"/jobs/{job_id}/summary")
        assert summary.status_code == 200
        summary_body = summary.json()
        assert summary_body["ok"] is True
        data = summary_body["data"]
        assert data["headline"] == scenario["expected_outcome"]
        assert data["delta_pnl"] == scenario["expected_delta_pnl"]
        assert data["top_moments"][0]["label"] == scenario["expected_top_label"]

        created.append(
            {
                "job_id": job_id,
                "expected_outcome": scenario["expected_outcome"],
                "expected_elo_delta": scenario["expected_elo_delta"],
            }
        )
        # Ensure deterministic chronological ordering in /api/history.
        time.sleep(1.05)

    # Per-job ELO endpoint should expose deterministic chess/ELO mapping.
    for item in created:
        elo_resp = client.get(f"/jobs/{item['job_id']}/elo")
        assert elo_resp.status_code == 200
        elo_body = elo_resp.json()
        assert elo_body["ok"] is True
        elo = elo_body["data"]["elo"]
        assert elo_body["data"]["outcome"] == item["expected_outcome"]
        assert elo["base"] == 1200.0
        assert elo["delta"] == item["expected_elo_delta"]
        assert elo["projected"] == 1200.0 + item["expected_elo_delta"]

    history = client.get(f"/api/history?userId={user_id}&limit=10")
    assert history.status_code == 200
    history_body = history.json()
    reports = history_body["reports"]
    assert len(reports) == 3

    # Reports are newest-first in API payload.
    by_session = {report["sessionId"]: report for report in reports}
    for item in created:
        report = by_session[item["job_id"]]
        assert report["eloDelta"] == item["expected_elo_delta"]

    current = history_body["currentElo"]
    assert current["sessionsPlayed"] == 3
    assert current["rating"] == 1204.0
    assert current["peakRating"] == 1212.0
