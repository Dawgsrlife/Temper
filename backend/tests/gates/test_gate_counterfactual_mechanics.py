from __future__ import annotations

import math

import pandas as pd

from app.counterfactual import CounterfactualEngine


def _ts(values: list[str]) -> pd.Series:
    return pd.to_datetime(pd.Series(values))


def test_gate_mechanics_consistency_exposure_scaling() -> None:
    df = pd.DataFrame(
        {
            "timestamp": _ts(
                [
                    "2026-01-01 09:30:00",
                    "2026-01-01 09:31:00",
                    "2026-01-01 09:32:00",
                ]
            ),
            "asset": ["AAPL", "AAPL", "AAPL"],
            "side": ["Buy", "Buy", "Buy"],
            "pnl": [53.155, -23_677_221.0, 12.0],
            "size_usd": [100.0, 29_600_593.0, 120.0],
            "is_revenge": [False, False, False],
            "is_overtrading": [False, False, False],
            "is_loss_aversion": [False, True, False],
        }
    )

    out, _ = CounterfactualEngine(df, daily_max_loss=1_000_000_000.0).run()
    capped = out.iloc[1]
    cap_value = float(capped["replay_loss_cap_value"])
    scale = float(capped["replay_effective_scale"])
    simulated_pnl = float(capped["simulated_pnl"])
    pnl = float(capped["pnl"])

    assert bool(capped["replay_loss_capped"]) is True
    assert scale > 0.0
    assert scale <= 1.0
    assert math.isclose(simulated_pnl, pnl * scale, rel_tol=0.0, abs_tol=1e-6)
    assert abs(simulated_pnl) <= cap_value + 1e-6
    assert float(capped["simulated_size_usd"]) > 0.0


def test_gate_overtrading_semantics_are_conservative_skip() -> None:
    df = pd.DataFrame(
        {
            "timestamp": _ts(
                [
                    "2026-01-01 09:30:00",
                    "2026-01-01 09:31:00",
                    "2026-01-01 09:32:00",
                ]
            ),
            "pnl": [10.0, -40.0, 5.0],
            "is_revenge": [False, False, False],
            "is_overtrading": [False, True, False],
            "is_loss_aversion": [False, False, False],
        }
    )

    out, _ = CounterfactualEngine(df, daily_max_loss=10_000.0).run()
    overtrade_row = out.iloc[1]

    assert bool(overtrade_row["replay_deferred"]) is True
    assert int(overtrade_row["replay_deferred_target_index"]) == -1
    assert float(overtrade_row["simulated_pnl"]) == 0.0
    assert str(overtrade_row["blocked_reason"]) == "BIAS"

