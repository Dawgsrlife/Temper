from __future__ import annotations

import argparse
from dataclasses import asdict
from hashlib import sha256
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time

import pandas as pd

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.counterfactual import CounterfactualEngine
from app.data_quality import evaluate_data_quality
from app.detective import BiasDetective, BiasThresholds
from app.normalizer import DataNormalizer
from app.review import build_trade_review
from app.risk import (
    DEFAULT_BALANCE_BASE_FRACTION,
    DEFAULT_BALANCE_CAP_FRACTION,
    DEFAULT_DAY_TOTAL_BASE_QUANTILE,
    DEFAULT_INTRADAY_BASE_QUANTILE,
    DEFAULT_INTRADAY_CAP_MULTIPLIER,
    DEFAULT_MIN_DAILY_MAX_LOSS,
    DEFAULT_SAFETY_BUFFER,
    recommend_daily_max_loss,
)


def _sha256_file(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _canonical_sort(df: pd.DataFrame) -> pd.DataFrame:
    sort_cols = [
        col
        for col in (
            "timestamp",
            "asset",
            "side",
            "price",
            "size_usd",
            "pnl",
            "simulated_pnl",
            "simulated_equity",
            "blocked_reason",
            "is_revenge",
            "is_overtrading",
            "is_loss_aversion",
            "is_blocked_bias",
            "is_blocked_risk",
            "checkmated_day",
        )
        if col in df.columns
    ]
    if not sort_cols:
        return df.copy()
    return df.sort_values(sort_cols, kind="mergesort").reset_index(drop=True)


def _write_csv(df: pd.DataFrame, path: Path) -> None:
    stable = _canonical_sort(df)
    stable.to_csv(
        path,
        index=False,
        float_format="%.10f",
        date_format="%Y-%m-%dT%H:%M:%S",
    )


def _git_meta(root: Path) -> tuple[str, str]:
    commit = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    dirty = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    return commit, ("DIRTY" if dirty else "CLEAN")


def _build_policy_text(
    *,
    rows: int,
    recommended_daily_max_loss: float,
    used_daily_max_loss: float,
    summary: dict[str, float | int | str],
    bias_rates: dict[str, float],
    data_quality: dict[str, object],
    root: Path,
) -> str:
    commit, dirty = _git_meta(root)
    lines = [
        "Temper Judge Pack Policy Report",
        "=" * 80,
        f"rows: {rows}",
        f"git_commit: {commit}",
        f"git_state: {dirty}",
        "",
        "BiasThresholds:",
    ]
    for key, value in asdict(BiasThresholds()).items():
        lines.append(f"  {key}: {value}")

    lines.extend(
        [
            "",
            "Risk Recommender Parameters:",
            f"  min_daily_max_loss: {DEFAULT_MIN_DAILY_MAX_LOSS}",
            f"  safety_buffer: {DEFAULT_SAFETY_BUFFER}",
            f"  day_total_base_quantile: {DEFAULT_DAY_TOTAL_BASE_QUANTILE}",
            f"  intraday_base_quantile: {DEFAULT_INTRADAY_BASE_QUANTILE}",
            f"  balance_base_fraction: {DEFAULT_BALANCE_BASE_FRACTION}",
            f"  balance_cap_fraction: {DEFAULT_BALANCE_CAP_FRACTION}",
            f"  intraday_cap_multiplier: {DEFAULT_INTRADAY_CAP_MULTIPLIER}",
            "",
            "Run Metrics:",
            f"  recommended_daily_max_loss: {recommended_daily_max_loss:.6f}",
            f"  used_daily_max_loss: {used_daily_max_loss:.6f}",
            f"  bias_rates.revenge: {bias_rates['revenge'] * 100:.2f}%",
            f"  bias_rates.overtrading: {bias_rates['overtrading'] * 100:.2f}%",
            f"  bias_rates.loss_aversion: {bias_rates['loss_aversion'] * 100:.2f}%",
            f"  summary.actual_total_pnl: {float(summary['actual_total_pnl']):.6f}",
            f"  summary.simulated_total_pnl: {float(summary['simulated_total_pnl']):.6f}",
            f"  summary.delta_pnl: {float(summary['delta_pnl']):.6f}",
            f"  summary.cost_of_bias: {float(summary['cost_of_bias']):.6f}",
            f"  summary.blocked_bias_count: {int(summary['blocked_bias_count'])}",
            f"  summary.blocked_risk_count: {int(summary['blocked_risk_count'])}",
            f"  summary.outcome: {summary['outcome']}",
            "",
            "Data Quality:",
            f"  warnings_count: {len(data_quality.get('warnings', []))}",
            f"  missing_asset_pct: {float(data_quality['metrics']['missing_asset_pct']):.2f}%",
            f"  nonpositive_price_pct: {float(data_quality['metrics']['nonpositive_price_pct']):.2f}%",
            f"  nonpositive_size_usd_pct: {float(data_quality['metrics']['nonpositive_size_usd_pct']):.2f}%",
            f"  nat_timestamp_pct: {float(data_quality['metrics']['nat_timestamp_pct']):.2f}%",
            f"  duplicate_timestamp_pct: {float(data_quality['metrics']['duplicate_timestamp_pct']):.2f}%",
            f"  out_of_order_rows_pct: {float(data_quality['metrics']['out_of_order_rows_pct']):.2f}%",
            f"  pnl_non_numeric_coercions_pct: {float(data_quality['metrics']['pnl_non_numeric_coercions_pct']):.2f}%",
        ]
    )
    for warning in data_quality.get("warnings", []):
        lines.append(f"  warning: {warning}")
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Build deterministic judge-pack artifacts.")
    parser.add_argument("--input", required=True, help="Input CSV path.")
    parser.add_argument("--out_dir", required=True, help="Output directory for artifacts.")
    parser.add_argument("--daily_max_loss", type=float, default=None, help="Override daily max loss.")
    parser.add_argument("--k_repeat", type=int, default=1, help="Repeat input K times in-memory.")
    parser.add_argument("--seed", type=int, default=42, help="Optional seed (reserved).")
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[2]
    input_path = Path(args.input)
    if not input_path.is_absolute():
        input_path = root / input_path
    out_dir = Path(args.out_dir)
    if not out_dir.is_absolute():
        out_dir = root / out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    stage_seconds: dict[str, float] = {}
    t0 = time.perf_counter()

    raw_start = time.perf_counter()
    raw = pd.read_csv(input_path)
    if args.k_repeat > 1:
        raw = pd.concat([raw] * args.k_repeat, ignore_index=True)
    stage_seconds["load_and_repeat"] = time.perf_counter() - raw_start

    quality_start = time.perf_counter()
    data_quality = evaluate_data_quality(raw, dayfirst=False)
    stage_seconds["data_quality"] = time.perf_counter() - quality_start

    with tempfile.TemporaryDirectory() as tmp_dir:
        working_input = Path(tmp_dir) / "judge_pack_input.csv"
        raw.to_csv(working_input, index=False)

        normalize_start = time.perf_counter()
        normalized = DataNormalizer(source=working_input, dayfirst=False).normalize()
        stage_seconds["normalize"] = time.perf_counter() - normalize_start

    detect_start = time.perf_counter()
    flagged = BiasDetective(normalized).detect()
    stage_seconds["detect"] = time.perf_counter() - detect_start

    risk_start = time.perf_counter()
    recommended_daily_max_loss = recommend_daily_max_loss(normalized)
    used_daily_max_loss = (
        float(args.daily_max_loss)
        if args.daily_max_loss is not None
        else recommended_daily_max_loss
    )
    stage_seconds["risk_recommend"] = time.perf_counter() - risk_start

    cf_start = time.perf_counter()
    counterfactual, summary = CounterfactualEngine(
        flagged,
        daily_max_loss=used_daily_max_loss,
    ).run()
    stage_seconds["counterfactual"] = time.perf_counter() - cf_start

    review_start = time.perf_counter()
    review = build_trade_review(
        counterfactual,
        summary,
        data_quality_warnings=list(data_quality.get("warnings", [])),
    )
    stage_seconds["review"] = time.perf_counter() - review_start

    write_start = time.perf_counter()
    normalized_path = out_dir / "normalized.csv"
    flagged_path = out_dir / "flagged.csv"
    counterfactual_path = out_dir / "counterfactual.csv"
    review_path = out_dir / "review.json"
    policy_path = out_dir / "policy_report.txt"
    quality_path = out_dir / "data_quality.json"
    metrics_path = out_dir / "runtime_metrics.json"

    _write_csv(normalized, normalized_path)
    _write_csv(flagged, flagged_path)
    _write_csv(counterfactual, counterfactual_path)
    review_path.write_text(json.dumps(review, indent=2, sort_keys=True) + "\n")
    quality_path.write_text(json.dumps(data_quality, indent=2, sort_keys=True) + "\n")

    bias_rates = {
        "revenge": float(flagged["is_revenge"].mean()),
        "overtrading": float(flagged["is_overtrading"].mean()),
        "loss_aversion": float(flagged["is_loss_aversion"].mean()),
    }
    policy_text = _build_policy_text(
        rows=len(counterfactual),
        recommended_daily_max_loss=recommended_daily_max_loss,
        used_daily_max_loss=used_daily_max_loss,
        summary=summary,
        bias_rates=bias_rates,
        data_quality=data_quality,
        root=root,
    )
    policy_path.write_text(policy_text)
    stage_seconds["write_artifacts"] = time.perf_counter() - write_start

    artifact_hashes = {
        "normalized.csv": _sha256_file(normalized_path),
        "flagged.csv": _sha256_file(flagged_path),
        "counterfactual.csv": _sha256_file(counterfactual_path),
        "review.json": _sha256_file(review_path),
        "policy_report.txt": _sha256_file(policy_path),
        "data_quality.json": _sha256_file(quality_path),
    }

    total_seconds = time.perf_counter() - t0
    runtime_metrics = {
        "input": str(input_path),
        "out_dir": str(out_dir),
        "seed": int(args.seed),
        "k_repeat": int(args.k_repeat),
        "rows": int(len(counterfactual)),
        "recommended_daily_max_loss": float(recommended_daily_max_loss),
        "used_daily_max_loss": float(used_daily_max_loss),
        "total_seconds": total_seconds,
        "rows_per_second": (len(counterfactual) / total_seconds) if total_seconds > 0 else 0.0,
        "stage_seconds": stage_seconds,
        "artifact_hashes": artifact_hashes,
        "data_quality": data_quality,
        "summary": {
            "actual_total_pnl": float(summary["actual_total_pnl"]),
            "simulated_total_pnl": float(summary["simulated_total_pnl"]),
            "delta_pnl": float(summary["delta_pnl"]),
            "cost_of_bias": float(summary["cost_of_bias"]),
            "blocked_bias_count": int(summary["blocked_bias_count"]),
            "blocked_risk_count": int(summary["blocked_risk_count"]),
            "outcome": str(summary["outcome"]),
        },
    }
    metrics_path.write_text(json.dumps(runtime_metrics, indent=2, sort_keys=True) + "\n")

    print(f"Wrote judge pack to: {out_dir}")
    print(f"rows={len(counterfactual)} total_seconds={total_seconds:.4f}")
    print("artifact hashes:")
    for name, digest in runtime_metrics["artifact_hashes"].items():
        print(f"  {name}: {digest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
