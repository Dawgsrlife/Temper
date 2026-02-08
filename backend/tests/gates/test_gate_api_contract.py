from __future__ import annotations

from fastapi.testclient import TestClient

from .conftest import golden_bias_csv, wait_for_terminal


def _primary_rule_from_reason(reason: str | None) -> str | None:
    mapping = {
        "OVERTRADING_COOLDOWN_SKIP": "OVERTRADING_COOLDOWN_SKIP_REPLAY",
        "REVENGE_SIZE_RESCALED": "REVENGE_SIZE_RESCALE_REPLAY",
        "LOSS_AVERSION_CAPPED": "LOSS_AVERSION_CAP_REPLAY",
        "DAILY_MAX_LOSS_STOP": "DAILY_MAX_LOSS_STOP",
    }
    if reason is None:
        return None
    return mapping.get(reason)


def test_gate_api_contract_moments_trade_and_series_are_consistent(
    api_env: tuple[TestClient, object, object],
) -> None:
    client, _, _ = api_env
    create = client.post(
        "/jobs",
        files={"file": ("golden_bias_smoke.csv", golden_bias_csv(), "text/csv")},
        data={"user_id": "gate_api_user"},
    )
    assert create.status_code == 202
    job_id = create.json()["job"]["job_id"]

    terminal = wait_for_terminal(client, job_id, timeout_seconds=30.0)
    assert terminal["job"]["execution_status"] == "COMPLETED"

    series = client.get(f"/jobs/{job_id}/counterfactual/series?max_points=300")
    assert series.status_code == 200
    series_payload = series.json()
    assert series_payload["ok"] is True
    assert len(series_payload["data"]["points"]) > 0
    assert isinstance(series_payload["data"]["markers"], list)

    moments_response = client.get(f"/jobs/{job_id}/moments")
    assert moments_response.status_code == 200
    moments_payload = moments_response.json()
    assert moments_payload["ok"] is True
    moments = moments_payload["data"]["moments"]
    assert isinstance(moments, list)
    assert len(moments) > 0
    assert len(moments) <= 3

    for moment in moments:
        for key in (
            "timestamp",
            "asset",
            "trade_grade",
            "decision",
            "reason",
            "rule_hits",
            "counterfactual_mechanics",
        ):
            assert key in moment

        mechanics = moment["counterfactual_mechanics"]
        assert isinstance(mechanics, dict)
        for mechanics_key in (
            "mechanism",
            "scale_factor",
            "size_usd_before",
            "size_usd_after",
            "quantity_before",
            "quantity_after",
            "cap_used",
        ):
            assert mechanics_key in mechanics

        reason = moment.get("reason")
        expected_primary = _primary_rule_from_reason(reason if isinstance(reason, str) else None)
        if expected_primary is not None:
            fired_rule_ids = {
                str(hit.get("rule_id"))
                for hit in moment.get("rule_hits", [])
                if isinstance(hit, dict) and bool(hit.get("fired"))
            }
            assert expected_primary in fired_rule_ids

        if mechanics.get("mechanism") == "EXPOSURE_SCALING" and mechanics.get("size_usd_before") is not None:
            assert mechanics.get("scale_factor") is not None
            assert mechanics.get("size_usd_after") is not None

        trace_trade_id = moment.get("trace_trade_id")
        assert isinstance(trace_trade_id, int)
        trade_response = client.get(f"/jobs/{job_id}/trade/{trace_trade_id}")
        assert trade_response.status_code == 200
        trade_payload = trade_response.json()
        assert trade_payload["ok"] is True
        trade = trade_payload["data"]["trade"]
        assert trade["trade_id"] == trace_trade_id
        assert trade["decision"]["reason"] == moment.get("reason")
        assert trade["counterfactual_mechanics"]["mechanism"] == mechanics.get("mechanism")

