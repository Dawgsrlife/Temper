from __future__ import annotations

import tempfile
import time
from pathlib import Path

from fastapi.testclient import TestClient

import app.main as main_module


def _fixture_csv() -> str:
    path = Path(__file__).resolve().parents[3] / "docs" / "testdata" / "F12_phase9_demo.csv"
    return path.read_text(encoding="utf-8")


def _wait_for_terminal(client: TestClient, job_id: str, timeout_seconds: float = 20.0) -> dict:
    deadline = time.time() + timeout_seconds
    last_payload: dict | None = None
    while time.time() < deadline:
        response = client.get(f"/jobs/{job_id}")
        assert response.status_code == 200
        payload = response.json()
        last_payload = payload
        status = payload["job"]["execution_status"]
        if status in {"COMPLETED", "FAILED", "TIMEOUT"}:
            return payload
        time.sleep(0.1)
    raise AssertionError(f"job {job_id} did not reach terminal status; last={last_payload}")


class _BrokenSupabaseStore:
    def upsert_job(self, row: dict) -> None:
        _ = row

    def replace_job_artifacts(self, job_id: str, artifacts: dict[str, str]) -> None:
        _ = (job_id, artifacts)

    def list_jobs_for_user(self, *, user_id: str, limit: int) -> list[dict]:
        raise main_module.SupabaseSyncError("phase9: supabase unavailable")


def test_gate_phase9_judge_demo_contract_real_csv_with_local_history_fallback() -> None:
    original_outputs = main_module.OUTPUTS_DIR
    original_supabase_store = main_module._supabase_store
    original_vertex = main_module.generate_coach_via_vertex
    with tempfile.TemporaryDirectory() as tmp:
        outputs_dir = Path(tmp) / "outputs"
        outputs_dir.mkdir(parents=True, exist_ok=True)
        try:
            main_module.OUTPUTS_DIR = outputs_dir
            main_module._supabase_store = lambda: _BrokenSupabaseStore()

            def _fake_vertex(payload: dict) -> dict:
                move_review = payload.get("move_review") or []
                return {
                    "version": 1,
                    "headline": "Policy replay generated from deterministic facts.",
                    "diagnosis": [
                        {
                            "bias": "LOSS_AVERSION",
                            "severity": 3,
                            "evidence": [
                                "Loss-aversion intervention reduced cost_of_bias by 70.0 usd."
                            ],
                            "metric_refs": [
                                {"name": "cost_of_bias", "value": 70.0, "unit": "usd"}
                            ],
                        }
                    ],
                    "plan": [
                        {
                            "title": "Apply stop-loss cap consistently",
                            "steps": [
                                "Use the capped-loss rule during the next session.",
                                "Review loss-to-win imbalance after session close.",
                            ],
                            "time_horizon": "NEXT_SESSION",
                        }
                    ],
                    "do_next_session": [
                        "Keep size stable after losses.",
                        "Check top 3 move explanations before opening new positions.",
                    ],
                    "disclaimer": "Coaching is post-hoc and does not change deterministic outputs.",
                    "move_review": move_review,
                }

            main_module.generate_coach_via_vertex = _fake_vertex

            client = TestClient(main_module.app)
            create = client.post(
                "/jobs",
                files={"file": ("F12_phase9_demo.csv", _fixture_csv(), "text/csv")},
                data={"user_id": "phase9-demo-user", "run_async": "false"},
            )
            assert create.status_code == 202
            create_body = create.json()
            assert create_body["ok"] is True
            job_id = create_body["job"]["job_id"]
            assert isinstance(job_id, str) and job_id

            terminal = _wait_for_terminal(client, job_id)
            assert terminal["job"]["execution_status"] == "COMPLETED"

            summary = client.get(f"/jobs/{job_id}/summary")
            assert summary.status_code == 200
            summary_body = summary.json()
            assert summary_body["ok"] is True
            data = summary_body["data"]
            assert data["headline"] == "WINNER"
            assert data["delta_pnl"] == 70.0
            assert data["cost_of_bias"] == 70.0
            assert data["bias_rates"]["loss_aversion_rate"] == 1.0 / 12.0
            assert len(data["top_moments"]) == 3
            assert data["top_moments"][0]["label"] == "MEGABLUNDER"
            assert data["top_moments"][0]["asset"] == "GOOG"
            assert data["top_moments"][0]["impact"] == 70.0

            review = client.get(f"/jobs/{job_id}/review")
            assert review.status_code == 200
            review_body = review.json()
            assert review_body["ok"] is True
            top_moments = review_body["data"]["review"]["top_moments"]
            assert len(top_moments) == 3

            coach_post = client.post(f"/jobs/{job_id}/coach")
            assert coach_post.status_code == 200
            coach_post_body = coach_post.json()
            assert coach_post_body["ok"] is True
            coach = coach_post_body["data"]["coach"]
            assert len(coach["move_review"]) == 3
            assert coach["move_review"][0]["label"] == "MEGABLUNDER"

            coach_get = client.get(f"/jobs/{job_id}/coach")
            assert coach_get.status_code == 200
            coach_get_body = coach_get.json()
            assert coach_get_body["ok"] is True
            assert len(coach_get_body["data"]["coach"]["move_review"]) == 3

            # Phase 9 contract: history endpoint must still work when Supabase is down.
            history = client.get("/users/phase9-demo-user/jobs?limit=1")
            assert history.status_code == 200
            history_body = history.json()
            assert history_body["ok"] is True
            assert history_body["data"]["count"] >= 1
            assert history_body["data"]["jobs"][0]["job_id"] == job_id
        finally:
            main_module.OUTPUTS_DIR = original_outputs
            main_module._supabase_store = original_supabase_store
            main_module.generate_coach_via_vertex = original_vertex
