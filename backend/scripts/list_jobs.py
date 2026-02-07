from __future__ import annotations

import argparse
from pathlib import Path
import sys

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.job_store import LocalJobStore


def main() -> int:
    parser = argparse.ArgumentParser(description="List persisted local analysis jobs.")
    parser.add_argument("--user_id", required=False, default=None, help="Filter by user id.")
    parser.add_argument("--limit", type=int, default=20, help="Max jobs to show.")
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[2]
    store = LocalJobStore(root / "backend" / "outputs")
    jobs = store.list_jobs(user_id=args.user_id, limit=args.limit)

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
