from __future__ import annotations

from pathlib import Path
import tempfile
import time

import pandas as pd

from app.counterfactual import CounterfactualEngine
from app.detective import BiasDetective
from app.normalizer import DataNormalizer
from app.review import apply_trade_grades
from app.risk import recommend_daily_max_loss


def test_shuffle_invariance_counterfactual_outputs() -> None:
    root = Path(__file__).resolve().parents[2]
    csv_path = root / "trading_datasets" / "calm_trader.csv"

    normalized = DataNormalizer(source=csv_path, dayfirst=False).normalize()
    flagged = BiasDetective(normalized).detect().copy()
    flagged["trade_id"] = range(len(flagged))
    daily_max_loss = recommend_daily_max_loss(normalized)

    base_out, base_summary = CounterfactualEngine(
        flagged,
        daily_max_loss=daily_max_loss,
    ).run()
    base_out, _ = apply_trade_grades(base_out, base_summary)

    shuffled = flagged.sample(frac=1.0, random_state=42).reset_index(drop=True)
    shuffled_out, shuffled_summary = CounterfactualEngine(
        shuffled,
        daily_max_loss=daily_max_loss,
    ).run()
    shuffled_out, _ = apply_trade_grades(shuffled_out, shuffled_summary)

    assert base_summary == shuffled_summary

    compare_cols = [
        "simulated_pnl",
        "is_blocked_bias",
        "is_blocked_risk",
        "blocked_reason",
        "checkmated_day",
        "trade_grade",
        "special_tags",
    ]

    base_aligned = base_out.sort_values("trade_id")[compare_cols].reset_index(drop=True)
    shuffled_aligned = shuffled_out.sort_values("trade_id")[compare_cols].reset_index(
        drop=True
    )
    pd.testing.assert_frame_equal(base_aligned, shuffled_aligned)


def test_20x_dataset_runtime_smoke() -> None:
    root = Path(__file__).resolve().parents[2]
    csv_path = root / "trading_datasets" / "calm_trader.csv"

    started = time.perf_counter()
    normalized = DataNormalizer(source=csv_path, dayfirst=False).normalize()
    large_df = pd.concat([normalized] * 20, ignore_index=True).sort_values(
        ["timestamp", "asset", "side", "price", "size_usd", "pnl"],
        kind="mergesort",
    ).reset_index(drop=True)

    flagged = BiasDetective(large_df).detect()
    out, summary = CounterfactualEngine(flagged).run()
    elapsed_seconds = time.perf_counter() - started

    assert len(large_df) == 200_000
    assert len(out) == 200_000
    assert "simulated_pnl" in out.columns
    assert "outcome" in summary
    assert elapsed_seconds < 60.0


def test_judge_schema_without_balance_still_runs() -> None:
    root = Path(__file__).resolve().parents[2]
    csv_path = root / "trading_datasets" / "calm_trader.csv"

    raw = pd.read_csv(csv_path)
    raw_no_balance = raw.drop(columns=["balance"])

    with tempfile.TemporaryDirectory() as tmp_dir:
        temp_csv = Path(tmp_dir) / "calm_no_balance.csv"
        raw_no_balance.to_csv(temp_csv, index=False)

        normalized = DataNormalizer(source=temp_csv, dayfirst=False).normalize()
        flagged = BiasDetective(normalized).detect()
        out, summary = CounterfactualEngine(flagged).run()

    required = {"timestamp", "asset", "price", "size_usd", "side", "pnl"}
    assert required.issubset(set(normalized.columns))
    assert "balance" not in normalized.columns
    assert len(out) == len(normalized)
    assert "outcome" in summary
