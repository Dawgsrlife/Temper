from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

import app.main as main_module
from .conftest import wait_for_terminal


def _fixture_csv() -> str:
    path = Path(__file__).resolve().parents[3] / "docs" / "testdata" / "F13_phase10_recording.csv"
    return path.read_text(encoding="utf-8")


def test_gate_phase10_recording_readiness_with_real_csv(
    api_env: tuple[TestClient, object, object],
) -> None:
    client, _, _ = api_env
    create = client.post(
        "/jobs",
        files={"file": ("F13_phase10_recording.csv", _fixture_csv(), "text/csv")},
        data={"user_id": "phase10-recording", "run_async": "false"},
    )
    assert create.status_code == 202
    job_id = create.json()["job"]["job_id"]

    terminal = wait_for_terminal(client, job_id, timeout_seconds=30.0)
    assert terminal["job"]["execution_status"] == "COMPLETED"

    summary_response = client.get(f"/jobs/{job_id}/summary")
    assert summary_response.status_code == 200
    summary_body = summary_response.json()
    assert summary_body["ok"] is True
    summary = summary_body["data"]
    assert summary["headline"] == "WINNER"
    assert summary["delta_pnl"] == 3220.0
    assert summary["cost_of_bias"] == 3220.0
    assert summary["bias_rates"]["loss_aversion_rate"] == 0.2
    assert len(summary["top_moments"]) == 3
    assert summary["top_moments"][0]["label"] == "MEGABLUNDER"
    assert summary["top_moments"][0]["asset"] == "GOOG"
    assert summary["top_moments"][0]["impact"] == 2860.0

    review_response = client.get(f"/jobs/{job_id}/review")
    assert review_response.status_code == 200
    review_body = review_response.json()
    assert review_body["ok"] is True
    review = review_body["data"]["review"]
    assert isinstance(review.get("recommendations"), list)
    assert review["recommendations"][0] == "Bias-impacted trades: 20.00% across 10 trades."

    series_response = client.get(f"/jobs/{job_id}/counterfactual/series?max_points=5")
    assert series_response.status_code == 200
    series_body = series_response.json()
    assert series_body["ok"] is True
    points = series_body["data"]["points"]
    markers = series_body["data"]["markers"]
    assert len(points) == 5
    assert points[0]["timestamp"] == "2025-03-14T09:00:00"
    assert points[0]["actual_equity"] == 100.0
    assert points[0]["simulated_equity"] == 100.0
    assert points[-1]["timestamp"] == "2025-03-14T09:17:00"
    assert points[-1]["actual_equity"] == -2330.0
    assert points[-1]["simulated_equity"] == 890.0
    assert len(markers) == 3
    assert markers[0]["trade_grade"] == "MEGABLUNDER"
    assert markers[0]["reason_label"] == "Loss aversion (downside capped)"

    moments_response = client.get(f"/jobs/{job_id}/moments")
    assert moments_response.status_code == 200
    moments_body = moments_response.json()
    assert moments_body["ok"] is True
    moments = moments_body["data"]["moments"]
    assert len(moments) == 3
    first = moments[0]
    assert first["trade_grade"] == "MEGABLUNDER"
    assert first["decision"] == "KEEP"
    assert first["reason"] == "LOSS_AVERSION_CAPPED"
    assert first["counterfactual_mechanics"]["mechanism"] == "EXPOSURE_SCALING"
    assert first["counterfactual_mechanics"]["scale_factor"] == 0.0466666667
    assert first["counterfactual_mechanics"]["cap_used"] == 140.0
    assert "scaled exposure" in first["explanation_human"]
    assert "rule_hits" in first and isinstance(first["rule_hits"], list) and first["rule_hits"]

    trade_index = int(first["trace_trade_id"])
    trade_response = client.get(f"/jobs/{job_id}/trade/{trade_index}")
    assert trade_response.status_code == 200
    trade_body = trade_response.json()
    assert trade_body["ok"] is True
    trade = trade_body["data"]["trade"]
    assert trade["decision"]["reason"] == "LOSS_AVERSION_CAPPED"
    assert trade["counterfactual"]["actual_pnl"] == -3000.0
    assert trade["counterfactual"]["simulated_pnl"] == -140.0
    assert trade["counterfactual"]["delta_pnl"] == 2860.0

    original_vertex = main_module.generate_coach_via_vertex
    try:
        def _fake_vertex(payload: dict) -> dict:
            move_review = payload.get("move_review") or []
            loss_rate = float((payload.get("bias_rates") or {}).get("loss_aversion_rate") or 0.0)
            cost_of_bias = float(payload.get("cost_of_bias") or 0.0)
            return {
                "version": 1,
                "headline": "Coach plan generated from deterministic replay metrics.",
                "diagnosis": [
                    {
                        "bias": "LOSS_AVERSION",
                        "severity": 4,
                        "evidence": [
                            f"loss_aversion_rate is {loss_rate:.3f} and cost_of_bias is {cost_of_bias:.1f} usd."
                        ],
                        "metric_refs": [
                            {"name": "loss_aversion_rate", "value": loss_rate, "unit": "ratio"},
                            {"name": "cost_of_bias", "value": cost_of_bias, "unit": "usd"},
                        ],
                    }
                ],
                "plan": [
                    {
                        "title": f"Reduce loss-aversion rate from {loss_rate * 100.0:.1f}%",
                        "steps": [
                            "Set a fixed loss cap for outsized downside events.",
                            "Review top move receipts after each session.",
                        ],
                        "time_horizon": "NEXT_SESSION",
                    }
                ],
                "do_next_session": [
                    "Apply the loss cap before opening positions.",
                    "Stop trading after two capped losses.",
                ],
                "disclaimer": "Coach is post-hoc and cannot alter deterministic facts.",
                "move_review": move_review,
            }

        main_module.generate_coach_via_vertex = _fake_vertex
        coach_post = client.post(f"/jobs/{job_id}/coach")
        assert coach_post.status_code == 200
        coach_body = coach_post.json()
        assert coach_body["ok"] is True
        coach = coach_body["data"]["coach"]
        assert len(coach["move_review"]) == 3
        assert coach["move_review"][0]["label"] == "MEGABLUNDER"
        assert coach["diagnosis"][0]["metric_refs"][0]["value"] == 0.2
        assert coach["diagnosis"][0]["metric_refs"][1]["value"] == 3220.0
        assert "20.0%" in coach["plan"][0]["title"]

        coach_get = client.get(f"/jobs/{job_id}/coach")
        assert coach_get.status_code == 200
        coach_get_body = coach_get.json()
        assert coach_get_body["ok"] is True
        assert len(coach_get_body["data"]["coach"]["move_review"]) == 3
    finally:
        main_module.generate_coach_via_vertex = original_vertex

    history = client.get("/users/phase10-recording/jobs?limit=1")
    assert history.status_code == 200
    history_body = history.json()
    assert history_body["ok"] is True
    assert history_body["data"]["count"] >= 1
    assert history_body["data"]["jobs"][0]["job_id"] == job_id
