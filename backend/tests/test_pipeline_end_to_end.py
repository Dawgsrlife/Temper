from __future__ import annotations

from pathlib import Path
import time

from app.counterfactual import CounterfactualEngine
from app.detective import BiasDetective
from app.normalizer import DataNormalizer


def test_pipeline_end_to_end_judge_defaults() -> None:
    root = Path(__file__).resolve().parents[2]
    datasets_dir = root / "trading_datasets"
    names = [
        "calm_trader.csv",
        "loss_averse_trader.csv",
        "overtrader.csv",
        "revenge_trader.csv",
    ]

    expected_df_cols = {
        "simulated_pnl",
        "simulated_equity",
        "simulated_daily_pnl",
        "is_blocked_bias",
        "is_blocked_risk",
        "blocked_reason",
        "checkmated_day",
    }
    expected_summary_keys = {
        "actual_total_pnl",
        "simulated_total_pnl",
        "delta_pnl",
        "cost_of_bias",
        "blocked_bias_count",
        "blocked_risk_count",
        "daily_max_loss_used",
        "outcome",
    }

    started = time.perf_counter()

    for name in names:
        normalized = DataNormalizer(source=datasets_dir / name, dayfirst=False).normalize()
        flagged = BiasDetective(normalized).detect()
        simulated, summary = CounterfactualEngine(flagged).run()

        assert len(simulated) == len(normalized)
        assert expected_df_cols.issubset(set(simulated.columns))
        assert expected_summary_keys.issubset(set(summary.keys()))
        assert simulated["simulated_equity"].notna().all()

    elapsed_seconds = time.perf_counter() - started
    # Runtime sanity check for judge-sized fixtures (roughly 10k rows each).
    assert elapsed_seconds < 30.0
