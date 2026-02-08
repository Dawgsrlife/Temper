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
    assert summary["delta_pnl"] == -50.0
    assert summary["cost_of_bias"] == 0.0


def test_bias_adjustments_apply_before_daily_loss_logic() -> None:
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

    # Trade 1 is bias-adjusted (rescaled) but still contributes to daily running pnl.
    # Because loss is still large, risk breach happens immediately and later trades are risk-blocked.
    assert out["is_blocked_bias"].tolist() == [True, False, False, False]
    assert out["is_blocked_risk"].tolist() == [False, True, True, True]
    assert out["simulated_pnl"].tolist() == [-200.0, 0.0, 0.0, 0.0]
    assert out["blocked_reason"].tolist() == ["BIAS", "DAILY_MAX_LOSS", "DAILY_MAX_LOSS", "DAILY_MAX_LOSS"]
    assert summary["blocked_bias_count"] == 1
    assert summary["blocked_risk_count"] == 3


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


def test_counterfactual_invariants() -> None:
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
            "pnl": [10.0, -120.0, 20.0, 15.0, 5.0],
            "is_revenge": [False, False, False, False, False],
            "is_overtrading": [False, False, False, False, False],
        }
    )

    out, _ = CounterfactualEngine(df, daily_max_loss=100.0).run()

    risk_blocked = out["blocked_reason"] == "DAILY_MAX_LOSS"
    assert (out.loc[risk_blocked, "simulated_pnl"] == 0.0).all()
    assert (out["is_blocked_bias"] == out["blocked_reason"].eq("BIAS")).all()
    assert (out["is_blocked_risk"] == out["blocked_reason"].eq("DAILY_MAX_LOSS")).all()
    assert out["replay_deferred"].notna().all()
    assert out["replay_rescaled"].notna().all()
    assert out["replay_loss_capped"].notna().all()

    # Breach trade is allowed: first day breach row must not be risk-blocked.
    day = out["timestamp"].dt.floor("D")
    breach_rows = out[(out["simulated_daily_pnl"] <= -100.0) & (out["simulated_pnl"] != 0)]
    if not breach_rows.empty:
        first_breach_idx = breach_rows.index.min()
        assert out.loc[first_breach_idx, "is_blocked_risk"] == False


def test_cost_metric_sign_behavior() -> None:
    better_df = pd.DataFrame(
        {
            "timestamp": _ts(
                [
                    "2026-01-01 09:30:00",
                    "2026-01-01 09:31:00",
                    "2026-01-01 09:32:00",
                    "2026-01-01 09:33:00",
                ]
            ),
            "pnl": [-50.0, -200.0, 15.0, 10.0],
            "is_revenge": [False, False, False, False],
            "is_overtrading": [False, False, False, False],
            "is_loss_aversion": [False, True, False, False],
        }
    )
    _, better_summary = CounterfactualEngine(better_df, daily_max_loss=1000.0).run()
    assert better_summary["delta_pnl"] > 0
    assert better_summary["cost_of_bias"] == better_summary["delta_pnl"]

    worse_df = pd.DataFrame(
        {
            "timestamp": _ts(
                [
                    "2026-01-01 09:30:00",
                    "2026-01-01 09:31:00",
                    "2026-01-01 09:32:00",
                ]
            ),
            "pnl": [20.0, -200.0, 10.0],
            "is_revenge": [False, False, False],
            "is_overtrading": [False, False, False],
        }
    )
    _, worse_summary = CounterfactualEngine(worse_df, daily_max_loss=100.0).run()
    assert worse_summary["delta_pnl"] < 0
    assert worse_summary["cost_of_bias"] == 0.0


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
        "delta_pnl",
        "cost_of_bias",
        "blocked_bias_count",
        "blocked_risk_count",
        "daily_max_loss_used",
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


def test_counterfactual_rejects_nat_timestamp() -> None:
    df = pd.DataFrame(
        {
            "timestamp": _ts(
                [
                    "2026-01-01 09:30:00",
                    "2026-01-01 09:31:00",
                ]
            ),
            "pnl": [10.0, -20.0],
            "is_revenge": [False, False],
            "is_overtrading": [False, False],
        }
    )
    df.loc[1, "timestamp"] = pd.NaT

    try:
        CounterfactualEngine(df, daily_max_loss=1000.0).run()
        assert False, "Expected ValueError when timestamp contains NaT."
    except ValueError as exc:
        assert "must not contain NaT" in str(exc)


def test_counterfactual_rejects_nan_pnl() -> None:
    df = pd.DataFrame(
        {
            "timestamp": _ts(
                [
                    "2026-01-01 09:30:00",
                    "2026-01-01 09:31:00",
                ]
            ),
            "pnl": [10.0, float("nan")],
            "is_revenge": [False, False],
            "is_overtrading": [False, False],
        }
    )

    try:
        CounterfactualEngine(df, daily_max_loss=1000.0).run()
        assert False, "Expected ValueError when pnl contains NaN."
    except ValueError as exc:
        assert "finite numeric values" in str(exc)


def test_counterfactual_requires_positive_finite_daily_max_loss() -> None:
    df = pd.DataFrame(
        {
            "timestamp": _ts(
                [
                    "2026-01-01 09:30:00",
                    "2026-01-01 09:31:00",
                ]
            ),
            "pnl": [10.0, -20.0],
            "is_revenge": [False, False],
            "is_overtrading": [False, False],
        }
    )

    for invalid in [0.0, -1.0, float("nan"), float("inf"), float("-inf")]:
        try:
            CounterfactualEngine(df, daily_max_loss=invalid)
            assert False, f"Expected ValueError for invalid daily_max_loss={invalid!r}."
        except ValueError as exc:
            assert "finite value > 0" in str(exc)
