from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from .conftest import wait_for_terminal


def _fixture_csv(name: str) -> str:
    path = Path(__file__).resolve().parents[3] / "docs" / "testdata" / name
    return path.read_text(encoding="utf-8")


def _create_completed_job(client: TestClient, *, name: str, user_id: str) -> str:
    create = client.post(
        "/jobs",
        files={"file": (name, _fixture_csv(name), "text/csv")},
        data={"user_id": user_id, "run_async": "false"},
    )
    assert create.status_code == 202
    job_id = create.json()["job"]["job_id"]
    terminal = wait_for_terminal(client, job_id, timeout_seconds=45.0)
    assert terminal["job"]["execution_status"] == "COMPLETED"
    return job_id


def _fired_hit(moment: dict, rule_id: str) -> dict:
    hits = moment.get("rule_hits") or []
    for hit in hits:
        if isinstance(hit, dict) and hit.get("fired") and hit.get("rule_id") == rule_id:
            return hit
    raise AssertionError(f"missing fired rule hit: {rule_id}")


def test_gate_phase13_deterministic_move_explanations_with_real_csvs(
    api_env: tuple[TestClient, object, object],
) -> None:
    client, _, _ = api_env

    # Revenge anchor fixture.
    revenge_job = _create_completed_job(
        client,
        name="F17_phase12_resign.csv",
        user_id="phase13-revenge",
    )
    revenge_moments = client.get(f"/jobs/{revenge_job}/moments")
    assert revenge_moments.status_code == 200
    revenge_top = revenge_moments.json()["data"]["moments"][0]
    assert revenge_top["reason"] == "REVENGE_SIZE_RESCALED"
    assert revenge_top["reason_label"] == "Revenge sizing"
    assert (
        revenge_top["explanation_human"]
        == "You just had a big loss (-$500.00) and increased size to +$600,000.00, so replay scaled exposure to 2.0000%."
    )
    revenge_hit = _fired_hit(revenge_top, "REVENGE_AFTER_LOSS")
    assert revenge_hit["inputs"]["prev_trade_pnl"] == -500.0
    assert revenge_hit["inputs"]["minutes_since_prev_trade"] == 2.0
    assert revenge_hit["inputs"]["size_multiplier"] == 12.0

    # Overtrading anchor fixture.
    overtrading_job = _create_completed_job(
        client,
        name="F18_phase13_overtrading.csv",
        user_id="phase13-overtrading",
    )
    overtrading_moments = client.get(f"/jobs/{overtrading_job}/moments")
    assert overtrading_moments.status_code == 200
    overtrading_top = overtrading_moments.json()["data"]["moments"][0]
    assert overtrading_top["reason"] == "OVERTRADING_COOLDOWN_SKIP"
    assert overtrading_top["reason_label"] == "Overtrading (cooldown)"
    assert (
        overtrading_top["explanation_human"]
        == "You were trading far more frequently than normal, so this trade was skipped during cooldown (details: 205 trades in last hour, threshold: 200)."
    )
    overtrading_hit = _fired_hit(overtrading_top, "OVERTRADING_HOURLY_CAP")
    assert overtrading_hit["inputs"]["rolling_trade_count_1h"] == 205.0
    assert overtrading_hit["thresholds"]["overtrading_trade_threshold"] == 200

    # Loss-aversion anchor fixture.
    loss_job = _create_completed_job(
        client,
        name="F04_loss_aversion.csv",
        user_id="phase13-loss-aversion",
    )
    loss_moments = client.get(f"/jobs/{loss_job}/moments")
    assert loss_moments.status_code == 200
    loss_top = loss_moments.json()["data"]["moments"][0]
    assert loss_top["reason"] == "LOSS_AVERSION_CAPPED"
    assert loss_top["reason_label"] == "Loss aversion (downside capped)"
    assert (
        loss_top["explanation_human"]
        == "This loss was much larger than your typical win, so replay kept the same price move but scaled exposure to 7.000000% to cap downside near -$140.00."
    )
    loss_proxy_hit = _fired_hit(loss_top, "LOSS_AVERSION_PAYOFF_PROXY")
    assert loss_proxy_hit["inputs"]["median_win_pnl"] == 35.0
    assert loss_proxy_hit["inputs"]["loss_cap_value"] == 140.0
    assert loss_proxy_hit["inputs"]["loss_abs_pnl"] == 2000.0

    # Dedicated deterministic move review endpoint (no LLM).
    move_review = client.get(f"/jobs/{loss_job}/move-review")
    assert move_review.status_code == 200
    move_review_body = move_review.json()
    assert move_review_body["ok"] is True
    rows = move_review_body["data"]["move_review"]
    assert len(rows) == 3
    assert rows[0]["label"] == "MEGABLUNDER"
    assert isinstance(rows[0]["explanation"], str) and rows[0]["explanation"]
    metric_names = [m["name"] for m in rows[0]["metric_refs"]]
    assert metric_names == ["impact_abs", "impact_p995", "blocked_reason"]
