from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
import tempfile
import time

import pandas as pd

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.counterfactual import CounterfactualEngine
from app.detective import BiasDetective
from app.normalizer import DataNormalizer
from app.review import build_trade_review
from app.risk import recommend_daily_max_loss


def _rows_per_sec(rows: int, seconds: float) -> float:
    return (rows / seconds) if seconds > 0 else 0.0


def main() -> int:
    parser = argparse.ArgumentParser(description="Benchmark backend pipeline stages.")
    parser.add_argument("--input", required=True, help="Input CSV path.")
    parser.add_argument("--k_repeat", type=int, default=1, help="Repeat input K times.")
    parser.add_argument(
        "--out",
        default="backend/outputs/bench.json",
        help="Output JSON path for benchmark metrics.",
    )
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[2]
    input_path = Path(args.input)
    if not input_path.is_absolute():
        input_path = root / input_path
    out_path = Path(args.out)
    if not out_path.is_absolute():
        out_path = root / out_path
    out_path.parent.mkdir(parents=True, exist_ok=True)

    stages: dict[str, dict[str, float]] = {}
    total_start = time.perf_counter()

    load_start = time.perf_counter()
    raw = pd.read_csv(input_path)
    stages["load_csv"] = {
        "seconds": time.perf_counter() - load_start,
        "rows": float(len(raw)),
    }

    repeat_start = time.perf_counter()
    repeated = pd.concat([raw] * args.k_repeat, ignore_index=True) if args.k_repeat > 1 else raw
    stages["repeat_in_memory"] = {
        "seconds": time.perf_counter() - repeat_start,
        "rows": float(len(repeated)),
    }

    with tempfile.TemporaryDirectory() as tmp_dir:
        temp_csv = Path(tmp_dir) / "bench_input.csv"
        write_start = time.perf_counter()
        repeated.to_csv(temp_csv, index=False)
        stages["write_temp_input"] = {
            "seconds": time.perf_counter() - write_start,
            "rows": float(len(repeated)),
        }

        normalize_start = time.perf_counter()
        normalized = DataNormalizer(source=temp_csv, dayfirst=False).normalize()
        stages["normalize"] = {
            "seconds": time.perf_counter() - normalize_start,
            "rows": float(len(normalized)),
        }

    detect_start = time.perf_counter()
    flagged = BiasDetective(normalized).detect()
    stages["detect"] = {
        "seconds": time.perf_counter() - detect_start,
        "rows": float(len(flagged)),
    }

    risk_start = time.perf_counter()
    daily_max_loss = recommend_daily_max_loss(normalized)
    stages["risk_recommend"] = {
        "seconds": time.perf_counter() - risk_start,
        "rows": float(len(normalized)),
    }

    cf_start = time.perf_counter()
    counterfactual, summary = CounterfactualEngine(flagged, daily_max_loss=daily_max_loss).run()
    stages["counterfactual"] = {
        "seconds": time.perf_counter() - cf_start,
        "rows": float(len(counterfactual)),
    }

    review_start = time.perf_counter()
    review = build_trade_review(counterfactual, summary)
    stages["review"] = {
        "seconds": time.perf_counter() - review_start,
        "rows": float(len(counterfactual)),
    }

    total_seconds = time.perf_counter() - total_start
    rows = len(counterfactual)
    slowest_stage = max(
        (name for name in stages.keys()),
        key=lambda name: stages[name]["seconds"],
    )

    bench = {
        "input": str(input_path),
        "k_repeat": int(args.k_repeat),
        "rows": rows,
        "daily_max_loss_used": float(daily_max_loss),
        "total_seconds": total_seconds,
        "total_rows_per_second": _rows_per_sec(rows, total_seconds),
        "slowest_stage": slowest_stage,
        "stages": {
            name: {
                "seconds": data["seconds"],
                "rows": int(data["rows"]),
                "rows_per_second": _rows_per_sec(int(data["rows"]), data["seconds"]),
            }
            for name, data in stages.items()
        },
        "summary": {
            "outcome": str(summary["outcome"]),
            "delta_pnl": float(summary["delta_pnl"]),
            "cost_of_bias": float(summary["cost_of_bias"]),
        },
        "review_headline": str(review["headline"]),
    }

    out_path.write_text(json.dumps(bench, indent=2, sort_keys=True) + "\n")

    print("Benchmark results")
    print("=" * 72)
    print(f"input: {input_path}")
    print(f"rows: {rows} (k_repeat={args.k_repeat})")
    print(f"total_seconds: {total_seconds:.4f}")
    print(f"total_rows_per_second: {bench['total_rows_per_second']:.2f}")
    print(f"slowest_stage: {slowest_stage}")
    print("\nstage timings:")
    for name, data in bench["stages"].items():
        print(
            f"  {name:16s} "
            f"seconds={data['seconds']:.4f} "
            f"rows/sec={data['rows_per_second']:.2f}"
        )
    print(f"\nwrote: {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
