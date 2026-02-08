from __future__ import annotations

from typing import Any

from app.db import get_supabase
from app.job_store import utc_now_iso


class SupabaseSyncError(Exception):
    pass


class SupabaseJobRepository:
    def __init__(self) -> None:
        self._client_factory = get_supabase

    def _client(self) -> Any:
        try:
            return self._client_factory()
        except Exception as exc:
            raise SupabaseSyncError(f"supabase client unavailable: {exc}") from exc

    def upsert_job(self, row: dict[str, Any]) -> None:
        try:
            self._client().table("jobs").upsert(row, on_conflict="id").execute()
        except Exception as exc:
            raise SupabaseSyncError(f"jobs upsert failed: {exc}") from exc

    def replace_job_artifacts(self, job_id: str, artifacts: dict[str, str]) -> None:
        try:
            client = self._client()
            client.table("job_artifacts").delete().eq("job_id", job_id).execute()
            rows = [
                {
                    "job_id": job_id,
                    "type": artifact_type,
                    "storage_path": storage_path,
                    "created_at": utc_now_iso(),
                }
                for artifact_type, storage_path in artifacts.items()
            ]
            if rows:
                client.table("job_artifacts").insert(rows).execute()
        except Exception as exc:
            raise SupabaseSyncError(f"job_artifacts replace failed: {exc}") from exc

    def list_jobs_for_user(self, *, user_id: str, limit: int) -> list[dict[str, Any]]:
        try:
            response = (
                self._client()
                .table("jobs")
                .select("*")
                .eq("user_id", user_id)
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
            )
        except Exception as exc:
            raise SupabaseSyncError(f"jobs list failed: {exc}") from exc

        data = getattr(response, "data", None)
        if not isinstance(data, list):
            return []
        return [dict(item) for item in data]
