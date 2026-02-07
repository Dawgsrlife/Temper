from __future__ import annotations

import math

import pandas as pd

from app.detective import BiasDetective, BiasThresholds


def _base_df() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "timestamp": pd.to_datetime(
                [
                    "2026-01-01 09:30:00",
                    "2026-01-01 09:31:00",
                    "2026-01-01 09:32:00",
                ]
            ),
            "asset": ["AAPL", "AAPL", "AAPL"],
            "price": [100.0, 101.0, 102.0],
            "size_usd": [1000.0, 900.0, 1100.0],
            "side": ["Buy", "Sell", "Buy"],
            "pnl": [10.0, -20.0, 30.0],
        }
    )


def test_detective_rejects_unsorted_input() -> None:
    df = _base_df().iloc[[1, 0, 2]].reset_index(drop=True)

    try:
        BiasDetective(df).detect()
        assert False, "Expected ValueError for unsorted detective input."
    except ValueError as exc:
        assert "pre-sorted deterministically" in str(exc)


def test_detective_rejects_nat_timestamp() -> None:
    df = _base_df()
    df.loc[1, "timestamp"] = pd.NaT

    try:
        BiasDetective(df).detect()
        assert False, "Expected ValueError when timestamp contains NaT."
    except ValueError as exc:
        assert "must not contain NaT" in str(exc)


def test_detective_rejects_equal_timestamp_tie_order_violation() -> None:
    df = pd.DataFrame(
        {
            "timestamp": pd.to_datetime(
                [
                    "2026-01-01 09:30:00",
                    "2026-01-01 09:30:00",
                    "2026-01-01 09:31:00",
                ]
            ),
            "asset": ["ZZZ", "AAA", "AAA"],
            "price": [100.0, 100.0, 101.0],
            "size_usd": [500.0, 500.0, 500.0],
            "side": ["Buy", "Buy", "Buy"],
            "pnl": [1.0, 1.0, 1.0],
        }
    )

    try:
        BiasDetective(df).detect()
        assert False, "Expected ValueError for deterministic tie-order violation."
    except ValueError as exc:
        assert "pre-sorted deterministically" in str(exc)


def test_thresholds_validate_positive_finite_domains() -> None:
    invalid_configs = [
        {"revenge_time_window_minutes": 0},
        {"overtrading_trade_threshold": 0},
        {"revenge_size_multiplier": 0.0},
        {"loss_aversion_loss_to_win_multiplier": -1.0},
        {"revenge_min_prev_loss_abs": float("inf")},
        {"revenge_rolling_median_multiplier": math.nan},
    ]

    for kwargs in invalid_configs:
        try:
            BiasThresholds(**kwargs)
            assert False, f"Expected ValueError for invalid thresholds: {kwargs}"
        except ValueError:
            pass
