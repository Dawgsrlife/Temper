"""
Temper – Local Job Store

Storage-agnostic job record model with a local filesystem implementation.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
from typing import Any


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def file_sha256(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


@dataclass
class JobRecord:
    job_id: str
    user_id: str | None
    created_at: str
    engine_version: str
    input_sha256: str
    status: str
    artifacts: dict[str, str]
    summary: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @staticmethod
    def from_dict(payload: dict[str, Any]) -> "JobRecord":
        return JobRecord(
            job_id=str(payload["job_id"]),
            user_id=payload.get("user_id"),
            created_at=str(payload["created_at"]),
            engine_version=str(payload["engine_version"]),
            input_sha256=str(payload["input_sha256"]),
            status=str(payload["status"]),
            artifacts=dict(payload.get("artifacts", {})),
            summary=dict(payload.get("summary", {})),
        )


class LocalJobStore:
    def __init__(self, base_dir: str | Path) -> None:
        self.base_dir = Path(base_dir)
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def _job_dir(self, job_id: str) -> Path:
        return self.base_dir / job_id

    def _job_file(self, job_id: str) -> Path:
        return self._job_dir(job_id) / "job.json"

    def write(self, record: JobRecord, *, job_dir: str | Path | None = None) -> Path:
        target_dir = Path(job_dir) if job_dir is not None else self._job_dir(record.job_id)
        target_dir.mkdir(parents=True, exist_ok=True)
        target_file = target_dir / "job.json"
        target_file.write_text(json.dumps(record.to_dict(), indent=2, sort_keys=True) + "\n")
        return target_file

    def read(self, job_id: str) -> JobRecord:
        payload = json.loads(self._job_file(job_id).read_text())
        return JobRecord.from_dict(payload)

    def read_path(self, path: str | Path) -> JobRecord:
        payload = json.loads(Path(path).read_text())
        return JobRecord.from_dict(payload)

    def list_jobs(self, *, user_id: str | None = None, limit: int | None = None) -> list[JobRecord]:
        records: list[JobRecord] = []
        for path in self.base_dir.glob("*/job.json"):
            try:
                record = self.read_path(path)
            except Exception:
                continue
            if user_id is not None and record.user_id != user_id:
                continue
            records.append(record)

        records.sort(key=lambda r: r.created_at, reverse=True)
        if limit is not None:
            return records[:limit]
        return records
