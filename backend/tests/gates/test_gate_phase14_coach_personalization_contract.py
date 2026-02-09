from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

import app.main as main_module
from app.job_store import JobRecord, utc_now_iso
from .conftest import wait_for_terminal


def _fixture_csv(name: str) -> str:
    path = Path(__file__).resolve().parents[3] / "docs" / "testdata" / name
    return path.read_text(encoding="utf-8")


def _create_completed_job(client: TestClient, *, fixture_name: str, user_id: str) -> str:
    create = client.post(
        "/jobs",
        files={"file": (fixture_name, _fixture_csv(fixture_name), "text/csv")},
        data={"user_id": user_id, "run_async": "false"},
    )
    assert create.status_code == 202
    job_id = create.json()["job"]["job_id"]
    terminal = wait_for_terminal(client, job_id, timeout_seconds=45.0)
    assert terminal["job"]["execution_status"] == "COMPLETED"
    return job_id


def test_gate_phase14_coach_personalization_on_real_fixture(
    api_env: tuple[TestClient, object, object],
) -> None:
    client, _, _ = api_env
    job_id = _create_completed_job(
        client,
        fixture_name="F19_phase14_personalization.csv",
        user_id="phase14-coach-happy",
    )

    original = main_module.generate_coach_via_vertex
    captured_payload: dict | None = None
    try:
        def _fake_vertex(payload: dict) -> dict:
            nonlocal captured_payload
            captured_payload = dict(payload)
            derived = payload.get("derived_stats")
            thresholds = payload.get("thresholds")
            if not isinstance(derived, dict) or not isinstance(thresholds, dict):
                raise AssertionError("missing derived_stats/thresholds in coach payload")
            if "trades_per_hour_p95" not in derived:
                raise AssertionError("missing trades_per_hour_p95 for personalization")
            if "loss_abs_p85" not in thresholds:
                raise AssertionError("missing loss_abs_p85 threshold for personalization")

            move_review = payload.get("move_review") or []
            loss_ratio = float(derived.get("loss_to_win_ratio") or 0.0)
            hourly_cap = float(derived.get("trades_per_hour_p95") or 0.0)
            loss_cap = float(thresholds.get("loss_abs_p85") or 0.0)

            return {
                "version": 1,
                "headline": "Coach plan generated from deterministic session metrics.",
                "diagnosis": [
                    {
                        "bias": "LOSS_AVERSION",
                        "severity": 4,
                        "evidence": [
                            f"loss_to_win_ratio is {loss_ratio:.3f} and hourly cap baseline is {hourly_cap:.1f} trades."
                        ],
                        "metric_refs": [
                            {"name": "loss_to_win_ratio", "value": loss_ratio, "unit": "ratio"},
                            {"name": "trades_per_hour_p95", "value": hourly_cap, "unit": "trades_per_hour"},
                            {"name": "loss_abs_p85", "value": loss_cap, "unit": "usd"},
                        ],
                    }
                ],
                "plan": [
                    {
                        "title": f"Cap losses near ${loss_cap:.0f} and keep <= {hourly_cap:.0f} trades/hour",
                        "steps": [
                            "Set a hard per-trade downside cap.",
                            "Use a cooldown once hourly cadence approaches threshold.",
                        ],
                        "time_horizon": "NEXT_SESSION",
                    }
                ],
                "do_next_session": [
                    "Apply the cap before opening positions.",
                    "Stop entries when trade cadence exceeds threshold.",
                ],
                "disclaimer": "Coach is post-hoc and cannot alter deterministic facts.",
                "move_review": move_review,
            }

        main_module.generate_coach_via_vertex = _fake_vertex

        post = client.post(f"/jobs/{job_id}/coach")
        assert post.status_code == 200
        body = post.json()
        assert body["ok"] is True
        coach = body["data"]["coach"]
        assert len(coach["move_review"]) == 3
        assert captured_payload is not None
        assert coach["move_review"] == (captured_payload.get("move_review") or [])
        assert "trades/hour" in coach["plan"][0]["title"]
        assert "$" in coach["plan"][0]["title"]
        assert coach["diagnosis"][0]["metric_refs"][0]["name"] == "loss_to_win_ratio"

        get_resp = client.get(f"/jobs/{job_id}/coach")
        assert get_resp.status_code == 200
        get_body = get_resp.json()
        assert get_body["ok"] is True
        assert get_body["data"]["coach"]["move_review"] == coach["move_review"]
    finally:
        main_module.generate_coach_via_vertex = original


def test_gate_phase14_coach_numeric_drift_rejection(
    api_env: tuple[TestClient, object, object],
) -> None:
    client, _, _ = api_env
    job_id = _create_completed_job(
        client,
        fixture_name="F19_phase14_personalization.csv",
        user_id="phase14-coach-drift",
    )

    original = main_module.generate_coach_via_vertex
    try:
        def _drift_vertex(payload: dict) -> dict:
            move_review = payload.get("move_review") or []
            mutated = [dict(row) for row in move_review]
            if mutated and isinstance(mutated[0].get("metric_refs"), list) and mutated[0]["metric_refs"]:
                ref0 = dict(mutated[0]["metric_refs"][0])
                # Deliberate numeric drift.
                ref0["value"] = float(ref0["value"]) + 1.0
                refs = list(mutated[0]["metric_refs"])
                refs[0] = ref0
                mutated[0]["metric_refs"] = refs
            return {
                "version": 1,
                "headline": "Drifted output",
                "diagnosis": [
                    {
                        "bias": "LOSS_AVERSION",
                        "severity": 3,
                        "evidence": ["metric drift test 1.0"],
                        "metric_refs": [{"name": "x", "value": 1.0, "unit": "u"}],
                    }
                ],
                "plan": [
                    {"title": "plan", "steps": ["step"], "time_horizon": "NEXT_SESSION"}
                ],
                "do_next_session": ["step"],
                "disclaimer": "post-hoc",
                "move_review": mutated,
            }

        main_module.generate_coach_via_vertex = _drift_vertex
        post = client.post(f"/jobs/{job_id}/coach")
        assert post.status_code == 502
        body = post.json()
        assert body["ok"] is False
        assert body["error"]["code"] == "COACH_GENERATION_FAILED"
        assert "metric value drifted" in body["error"]["details"]["error_message"]

        get_resp = client.get(f"/jobs/{job_id}/coach")
        assert get_resp.status_code == 409
        get_body = get_resp.json()
        assert get_body["ok"] is False
        assert get_body["error"]["code"] == "COACH_FAILED"
    finally:
        main_module.generate_coach_via_vertex = original


def test_gate_phase14_coach_not_ready_guard(
    api_env: tuple[TestClient, object, object],
) -> None:
    client, outputs_dir, _ = api_env
    job_id = "phase14-pending-job"
    record = JobRecord(
        job_id=job_id,
        user_id="phase14-not-ready",
        created_at=utc_now_iso(),
        engine_version="test",
        input_sha256="0" * 64,
        status="RUNNING",
        artifacts={},
        upload=None,
        summary={},
    )
    main_module._store().write(record, job_dir=outputs_dir / job_id)

    response = client.post(f"/jobs/{job_id}/coach")
    assert response.status_code == 409
    body = response.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "JOB_NOT_READY"
