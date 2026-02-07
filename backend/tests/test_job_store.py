from __future__ import annotations

from pathlib import Path
import tempfile

from app.job_store import JobRecord, LocalJobStore, file_sha256


def test_job_record_input_hash_determinism() -> None:
    with tempfile.TemporaryDirectory() as tmp_dir:
        p = Path(tmp_dir) / "input.csv"
        p.write_text("a,b\n1,2\n")

        first = file_sha256(p)
        second = file_sha256(p)
        assert first == second

        p.write_text("a,b\n1,3\n")
        third = file_sha256(p)
        assert third != first


def test_job_write_read_roundtrip() -> None:
    with tempfile.TemporaryDirectory() as tmp_dir:
        store = LocalJobStore(tmp_dir)
        record = JobRecord(
            job_id="job_test",
            user_id="user_123",
            created_at="2026-02-07T12:00:00+00:00",
            engine_version="abc123",
            input_sha256="deadbeef",
            status="COMPLETED",
            artifacts={"review.json": "/tmp/review.json"},
            summary={"outcome": "WINNER", "delta_pnl": 42.0, "badge_counts": {"GOOD": 1}},
        )
        store.write(record)
        loaded = store.read("job_test")

        assert loaded.job_id == record.job_id
        assert loaded.user_id == record.user_id
        assert loaded.created_at == record.created_at
        assert loaded.engine_version == record.engine_version
        assert loaded.input_sha256 == record.input_sha256
        assert loaded.status == record.status
        assert loaded.artifacts == record.artifacts
        assert loaded.summary == record.summary
