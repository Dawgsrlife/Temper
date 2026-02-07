from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import tempfile


def _run_judge_pack(args: list[str], *, cwd: Path) -> subprocess.CompletedProcess[str]:
    cmd = [
        str(cwd / "backend" / "venv" / "bin" / "python"),
        str(cwd / "backend" / "scripts" / "judge_pack.py"),
        *args,
    ]
    env = os.environ.copy()
    env["PYTHONPATH"] = "backend"
    return subprocess.run(
        cmd,
        cwd=cwd,
        env=env,
        text=True,
        capture_output=True,
    )


def test_judge_pack_failure_writes_failed_job_record() -> None:
    root = Path(__file__).resolve().parents[2]
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        bad_input = tmp_path / "bad.csv"
        bad_input.write_text("asset,pnl\nBTC,10\nETH,-5\n")

        out_dir = tmp_path / "failed_pack"
        result = _run_judge_pack(
            ["--input", str(bad_input), "--out_dir", str(out_dir), "--user_id", "u_failed"],
            cwd=root,
        )
        assert result.returncode == 1

        job = json.loads((out_dir / "job.json").read_text())
        review = json.loads((out_dir / "review.json").read_text())
        metrics = json.loads((out_dir / "runtime_metrics.json").read_text())

        assert job["status"] == "FAILED"
        assert job["summary"]["error_type"] != ""
        assert job["summary"]["error_message"] != ""
        assert review["execution_status"] == "FAILED"
        assert review["headline"] is None
        assert metrics["execution_status"] == "FAILED"
        assert metrics["error_type"] != ""


def test_judge_pack_timeout_writes_timeout_job_record() -> None:
    root = Path(__file__).resolve().parents[2]
    input_csv = root / "trading_datasets" / "calm_trader.csv"

    with tempfile.TemporaryDirectory() as tmp_dir:
        out_dir = Path(tmp_dir) / "timeout_pack"
        result = _run_judge_pack(
            [
                "--input",
                str(input_csv),
                "--out_dir",
                str(out_dir),
                "--max_seconds",
                "0",
                "--user_id",
                "u_timeout",
            ],
            cwd=root,
        )
        assert result.returncode == 1

        job = json.loads((out_dir / "job.json").read_text())
        review = json.loads((out_dir / "review.json").read_text())
        metrics = json.loads((out_dir / "runtime_metrics.json").read_text())

        assert job["status"] == "TIMEOUT"
        assert job["summary"]["error_type"] == "TimeoutError"
        assert review["execution_status"] == "TIMEOUT"
        assert review["headline"] is None
        assert metrics["execution_status"] == "TIMEOUT"
