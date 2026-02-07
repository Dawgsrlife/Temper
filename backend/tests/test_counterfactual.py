from pathlib import Path

import pandas as pd

from app.counterfactual import CounterfactualEngine
from app.detective import BiasDetective
from app.normalizer import DataNormalizer


def _ts(values: list[str]) -> pd.Series:
    return pd.to_datetime(pd.Series(values))


def test_daily_max_loss_breach_trade_allowed_then_block_same_day_and_reset_next_day() -> None:
    df = pd.DataFrame(
        {
            "timestamp": _ts(
                [
                    "2026-01-01 09:30:00",
                    "2026-01-01 09:31:00",
                    "2026-01-01 09:32:00",
                    "2026-01-01 09:33:00",
                    "2026-01-02 09:30:00",
                ]
            ),
            "pnl": [50.0, -180.0, 20.0, 30.0, 40.0],
            "is_revenge": [False, False, False, False, False],
            "is_overtrading": [False, False, False, False, False],
            "is_loss_aversion": [False, False, False, False, False],
        }
    )

    out, summary = CounterfactualEngine(df, daily_max_loss=100.0).run()

    assert out["simulated_pnl"].tolist() == [50.0, -180.0, 0.0, 0.0, 40.0]
    assert out["is_blocked_risk"].tolist() == [False, False, True, True, False]
    assert out["blocked_reason"].tolist() == [
        "NONE",
        "NONE",
        "DAILY_MAX_LOSS",
        "DAILY_MAX_LOSS",
        "NONE",
    ]
    assert out["simulated_daily_pnl"].tolist() == [50.0, -130.0, -130.0, -130.0, 40.0]
    assert out["checkmated_day"].tolist() == [True, True, True, True, False]

    assert summary["blocked_risk_count"] == 2
    assert summary["outcome"] == "CHECKMATED"
    assert summary["actual_total_pnl"] == -40.0
    assert summary["simulated_total_pnl"] == -90.0
    assert summary["cost_of_bias"] == 50.0


def test_bias_blocking_happens_before_daily_loss_logic() -> None:
    df = pd.DataFrame(
        {
            "timestamp": _ts(
                [
                    "2026-01-01 09:30:00",
                    "2026-01-01 09:31:00",
                    "2026-01-01 09:32:00",
                    "2026-01-01 09:33:00",
                ]
            ),
            "pnl": [-200.0, -30.0, -80.0, 10.0],
            "is_revenge": [True, False, False, False],
            "is_overtrading": [False, False, False, False],
            "is_loss_aversion": [False, False, False, False],
        }
    )

    out, summary = CounterfactualEngine(df, daily_max_loss=100.0).run()

    # Trade 1 is blocked by bias and must not contribute to risk breach.
    # Breach happens on trade 3 (allowed), trade 4 is then blocked by risk.
    assert out["is_blocked_bias"].tolist() == [True, False, False, False]
    assert out["is_blocked_risk"].tolist() == [False, False, False, True]
    assert out["simulated_pnl"].tolist() == [0.0, -30.0, -80.0, 0.0]
    assert out["blocked_reason"].tolist() == ["BIAS", "NONE", "NONE", "DAILY_MAX_LOSS"]
    assert summary["blocked_bias_count"] == 1
    assert summary["blocked_risk_count"] == 1


def test_missing_flag_columns_default_to_false() -> None:
    df = pd.DataFrame(
        {
            "timestamp": _ts(["2026-01-01 09:30:00", "2026-01-01 09:31:00"]),
            "pnl": [10.0, -20.0],
        }
    )

    out, summary = CounterfactualEngine(df, daily_max_loss=1000.0).run()

    assert out["is_blocked_bias"].tolist() == [False, False]
    assert out["is_blocked_risk"].tolist() == [False, False]
    assert out["blocked_reason"].tolist() == ["NONE", "NONE"]
    assert out["simulated_pnl"].tolist() == [10.0, -20.0]
    assert summary["blocked_bias_count"] == 0
    assert summary["blocked_risk_count"] == 0


def test_judge_fixtures_pipeline_contract() -> None:
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
        "cost_of_bias",
        "blocked_bias_count",
        "blocked_risk_count",
        "outcome",
    }

    for name in names:
        normalizer = DataNormalizer(source=datasets_dir / name, dayfirst=False)
        normalized = normalizer.normalize()
        flagged = BiasDetective(normalized).detect()

        out1, summary1 = CounterfactualEngine(flagged, daily_max_loss=1000.0).run()
        out2, summary2 = CounterfactualEngine(flagged, daily_max_loss=1000.0).run()

        assert len(out1) == len(normalized)
        assert expected_df_cols.issubset(set(out1.columns))
        assert expected_summary_keys.issubset(set(summary1.keys()))
        assert set(out1["blocked_reason"].unique()).issubset(
            {"NONE", "BIAS", "DAILY_MAX_LOSS"}
        )

        # Deterministic contract: same input -> same dataframe outputs + summary.
        pd.testing.assert_series_equal(
            out1["simulated_pnl"], out2["simulated_pnl"], check_names=False
        )
        pd.testing.assert_series_equal(
            out1["simulated_equity"], out2["simulated_equity"], check_names=False
        )
        assert summary1 == summary2
