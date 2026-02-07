from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.job_store import JobRecord, LocalJobStore


def _list_with_skip_count(
    store: LocalJobStore,
    *,
    user_id: str | None = None,
    limit: int | None = None,
) -> tuple[list[JobRecord], int]:
    records: list[JobRecord] = []
    skipped = 0
    for path in store.base_dir.glob("*/job.json"):
        try:
            payload = json.loads(path.read_text())
            record = JobRecord.from_dict(payload)
        except Exception:
            skipped += 1
            continue
        if user_id is not None and record.user_id != user_id:
            continue
        records.append(record)

    records.sort(key=lambda r: r.created_at, reverse=True)
    if limit is not None:
        records = records[:limit]
    return records, skipped


def main() -> int:
    parser = argparse.ArgumentParser(description="List persisted local analysis jobs.")
    parser.add_argument("--user_id", required=False, default=None, help="Filter by user id.")
    parser.add_argument("--limit", type=int, default=20, help="Max jobs to show.")
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[2]
    store = LocalJobStore(root / "backend" / "outputs")
    jobs, skipped = _list_with_skip_count(store, user_id=args.user_id, limit=args.limit)
    if skipped > 0:
        print(f"WARNING: skipped {skipped} corrupt job records")

    if not jobs:
        print("No jobs found.")
        return 0

    print("job_id | created_at | user_id | status | outcome | delta_pnl | badge_counts")
    print("-" * 120)
    for job in jobs:
        outcome = job.summary.get("outcome", "")
        delta = job.summary.get("delta_pnl", "")
        badge_counts = job.summary.get("badge_counts", {})
        print(
            f"{job.job_id} | {job.created_at} | {job.user_id or '-'} | "
            f"{job.status} | {outcome} | {delta} | {badge_counts}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
