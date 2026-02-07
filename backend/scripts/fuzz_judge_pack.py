from __future__ import annotations

from pathlib import Path
import json
import os
import subprocess
import sys

import numpy as np
import pandas as pd


def main() -> int:
    root = Path(__file__).resolve().parents[2]
    base_input = root / "trading_datasets" / "calm_trader.csv"
    fuzz_input = root / "backend" / "outputs" / "calm_fuzzed.csv"
    out_dir = root / "backend" / "outputs" / "fuzz_pack"
    out_dir.mkdir(parents=True, exist_ok=True)

    rng = np.random.default_rng(42)
    df = pd.read_csv(base_input)

    if "balance" in df.columns:
        df = df.drop(columns=["balance"])

    n_rows = len(df)
    n_inject = max(1, int(round(n_rows * 0.005)))

    asset_idx = rng.choice(n_rows, size=n_inject, replace=False)
    price_idx = rng.choice(n_rows, size=n_inject, replace=False)

    if "asset" in df.columns:
        df.loc[asset_idx, "asset"] = ""
    if "entry_price" in df.columns:
        df.loc[price_idx, "entry_price"] = 0.0

    ts = pd.to_datetime(df["timestamp"], errors="coerce")
    df["_day"] = ts.dt.floor("D")
    # Shuffle ordering inside each day to emulate messy upload order.
    df = (
        df.groupby("_day", group_keys=False, sort=False)
        .sample(frac=1.0, random_state=42)
        .drop(columns=["_day"])
        .reset_index(drop=True)
    )
    df.to_csv(fuzz_input, index=False)

    cmd = [
        str(root / "backend" / "venv" / "bin" / "python"),
        str(root / "backend" / "scripts" / "judge_pack.py"),
        "--input",
        str(fuzz_input),
        "--out_dir",
        str(out_dir),
    ]
    env = os.environ.copy()
    env["PYTHONPATH"] = "backend"
    subprocess.run(cmd, cwd=root, env=env, check=True)

    quality = json.loads((out_dir / "data_quality.json").read_text())
    review = json.loads((out_dir / "review.json").read_text())
    metrics = json.loads((out_dir / "runtime_metrics.json").read_text())

    assert len(quality.get("warnings", [])) > 0
    assert len(review.get("data_quality_warnings", [])) > 0
    assert metrics.get("data_quality", {}).get("quality_flags", {}).get("has_warnings") is True

    print("PASS: fuzz judge pack completed with expected quality warnings")
    print(f"warnings_count={len(quality.get('warnings', []))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
