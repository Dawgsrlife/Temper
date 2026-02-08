from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.counterfactual import run_counterfactual_replay


def assert_close(actual: float | None, expected: float, *, tol: float = 1e-6, label: str) -> None:
    if actual is None:
        raise AssertionError(f"{label} expected {expected}, got None")
    if abs(float(actual) - float(expected)) > tol:
        raise AssertionError(f"{label} expected {expected}, got {actual}")


@dataclass(frozen=True)
class PolicyConfig:
    revenge_time_window_minutes: int = 15
    revenge_size_multiplier: float = 2.5
    revenge_min_prev_loss_abs: float = 400.0
    revenge_rolling_median_multiplier: float = 2.0
    revenge_baseline_window_trades: int = 5

    loss_aversion_loss_to_win_multiplier: float = 4.0

    overtrading_trade_threshold: int = 5
    overtrading_window_hours: int = 1
    cooldown_minutes: int = 30


def config_dict() -> dict[str, Any]:
    c = PolicyConfig()
    return {
        "revenge_time_window_minutes": c.revenge_time_window_minutes,
        "revenge_size_multiplier": c.revenge_size_multiplier,
        "revenge_min_prev_loss_abs": c.revenge_min_prev_loss_abs,
        "revenge_rolling_median_multiplier": c.revenge_rolling_median_multiplier,
        "revenge_baseline_window_trades": c.revenge_baseline_window_trades,
        "loss_aversion_loss_to_win_multiplier": c.loss_aversion_loss_to_win_multiplier,
        "overtrading_trade_threshold": c.overtrading_trade_threshold,
        "overtrading_window_hours": c.overtrading_window_hours,
        "cooldown_minutes": c.cooldown_minutes,
    }


def make_rows_fixture() -> list[dict[str, Any]]:
    return [
        dict(
            trade_id=1,
            timestamp="2025-03-01T22:40:00",
            asset="MSFT",
            side="BUY",
            quantity=10.0,
            entry_price=1000.0,
            exit_price=1006.0,
            profit_loss=60.0,
            balance=10_000.0,
        ),
        dict(
            trade_id=2,
            timestamp="2025-03-01T22:41:00",
            asset="MSFT",
            side="BUY",
            quantity=12.0,
            entry_price=1000.0,
            exit_price=999.0,
            profit_loss=-12.0,
            balance=9_900.0,
        ),
        dict(
            trade_id=3,
            timestamp="2025-03-01T22:42:00",
            asset="MSFT",
            side="BUY",
            quantity=11.0,
            entry_price=1000.0,
            exit_price=999.0,
            profit_loss=-11.0,
            balance=9_800.0,
        ),
        dict(
            trade_id=4,
            timestamp="2025-03-01T22:42:30",
            asset="MSFT",
            side="BUY",
            quantity=50.0,
            entry_price=1000.0,
            exit_price=990.0,
            profit_loss=-500.0,
            balance=9_500.0,
        ),
        dict(
            trade_id=5,
            timestamp="2025-03-01T22:43:00",
            asset="AMZN",
            side="BUY",
            quantity=600.0,
            entry_price=1000.0,
            exit_price=1001.6666666667,
            profit_loss=1000.0,
            balance=9_000.0,
        ),
        dict(
            trade_id=6,
            timestamp="2025-03-04T11:25:00",
            asset="NVDA",
            side="BUY",
            quantity=500.0,
            entry_price=1000.0,
            exit_price=952.6455570,
            profit_loss=-23677221.51100451,
            balance=14_168.0,
        ),
        dict(
            trade_id=7,
            timestamp="2025-03-05T10:00:00",
            asset="AAPL",
            side="BUY",
            quantity=1.0,
            entry_price=100.0,
            exit_price=99.0,
            profit_loss=-1.0,
            balance=10_000.0,
        ),
        dict(
            trade_id=8,
            timestamp="2025-03-05T10:05:00",
            asset="AAPL",
            side="BUY",
            quantity=1.0,
            entry_price=100.0,
            exit_price=99.0,
            profit_loss=-1.0,
            balance=9_999.0,
        ),
        dict(
            trade_id=9,
            timestamp="2025-03-05T10:10:00",
            asset="AAPL",
            side="BUY",
            quantity=1.0,
            entry_price=100.0,
            exit_price=99.0,
            profit_loss=-1.0,
            balance=9_998.0,
        ),
        dict(
            trade_id=10,
            timestamp="2025-03-05T10:15:00",
            asset="AAPL",
            side="BUY",
            quantity=1.0,
            entry_price=100.0,
            exit_price=99.0,
            profit_loss=-1.0,
            balance=9_997.0,
        ),
        dict(
            trade_id=11,
            timestamp="2025-03-05T10:20:00",
            asset="AAPL",
            side="BUY",
            quantity=1.0,
            entry_price=100.0,
            exit_price=99.0,
            profit_loss=-1.0,
            balance=9_996.0,
        ),
        dict(
            trade_id=12,
            timestamp="2025-03-05T10:25:00",
            asset="AAPL",
            side="BUY",
            quantity=1.0,
            entry_price=100.0,
            exit_price=200.0,
            profit_loss=-100.0,
            balance=9_995.0,
        ),
        dict(
            trade_id=13,
            timestamp="2025-03-06T09:30:00",
            asset="",
            side="SELL",
            quantity=5.0,
            entry_price=100.0,
            exit_price=90.0,
            profit_loss=-50.0,
            balance=10_000.0,
        ),
        dict(
            trade_id=14,
            timestamp="2025-03-06T09:31:00",
            asset="TSLA",
            side="BUY",
            quantity=None,
            entry_price=1000.0,
            exit_price=1001.0,
            profit_loss=-10.0,
            balance=10_000.0,
        ),
        dict(
            trade_id=15,
            timestamp="2025-03-06T09:32:00",
            asset="GOOG",
            side="BUY",
            quantity=1.0,
            entry_price=1000.0,
            exit_price=1001.0,
            profit_loss=None,
            balance=10_000.0,
        ),
        dict(
            trade_id=16,
            timestamp="2025-03-06T09:33:00",
            asset="AMZN",
            side="BUY",
            quantity=10_000.0,
            entry_price=1000.0,
            exit_price=1000.1,
            profit_loss=-1000.0,
            balance=10_000.0,
        ),
    ]


def _index_by_trade_id(out_rows: list[dict[str, Any]]) -> dict[int, dict[str, Any]]:
    return {int(row["trade_id"]): row for row in out_rows}


def test_golden_revenge_trade_exact_output() -> None:
    out = run_counterfactual_replay(make_rows_fixture(), config_dict())
    got = _index_by_trade_id(out["rows"])[5]

    assert got["decision"] == "KEEP"
    assert got["reason"] == "REVENGE_SIZE_RESCALED"
    assert got["primary_rule"] == "REVENGE_SIZE_RESCALE_REPLAY"

    mech = got["counterfactual_mechanics"]
    assert mech["mechanism"] == "EXPOSURE_SCALING"
    assert_close(mech["effective_scale"], 0.02, tol=1e-12, label="effective_scale")
    assert_close(mech["size_usd_before"], 600000.0, label="size_usd_before")
    assert_close(mech["size_usd_after"], 12000.0, label="size_usd_after")
    assert_close(mech["quantity_before"], 600.0, label="quantity_before")
    assert_close(mech["quantity_after"], 12.0, label="quantity_after")
    assert_close(mech["cap_used"], 0.0, label="cap_used")
    assert_close(got["simulated_pnl"], 20.0, label="simulated_pnl")


def test_golden_loss_aversion_trade_exact_output() -> None:
    out = run_counterfactual_replay(make_rows_fixture(), config_dict())
    got = _index_by_trade_id(out["rows"])[6]

    assert got["decision"] == "KEEP"
    assert got["reason"] == "LOSS_AVERSION_CAPPED"
    assert got["primary_rule"] == "LOSS_AVERSION_CAP_REPLAY"

    cap = 2120.0
    scale = cap / 23677221.51100451

    mech = got["counterfactual_mechanics"]
    assert mech["mechanism"] == "EXPOSURE_SCALING"
    assert_close(mech["effective_scale"], scale, tol=1e-12, label="effective_scale")
    assert_close(mech["size_usd_before"], 500000.0, label="size_usd_before")
    assert_close(mech["size_usd_after"], 500000.0 * scale, tol=1e-6, label="size_usd_after")
    assert_close(mech["quantity_before"], 500.0, label="quantity_before")
    assert_close(mech["quantity_after"], 500.0 * scale, tol=1e-6, label="quantity_after")
    assert_close(mech["cap_used"], cap, label="cap_used")
    assert_close(got["simulated_pnl"], -cap, tol=1e-6, label="simulated_pnl")


def test_golden_overtrading_skip_exact_output() -> None:
    out = run_counterfactual_replay(make_rows_fixture(), config_dict())
    got = _index_by_trade_id(out["rows"])[12]

    assert got["decision"] == "SKIP"
    assert got["reason"] == "OVERTRADING_COOLDOWN_SKIP"
    assert got["primary_rule"] == "OVERTRADING_COOLDOWN_SKIP_REPLAY"
    assert_close(got["simulated_pnl"], 0.0, tol=1e-12, label="simulated_pnl")
    assert got["counterfactual_mechanics"]["mechanism"] == "COOLDOWN_SKIP"


def test_golden_anomaly_counts_exact_output() -> None:
    out = run_counterfactual_replay(make_rows_fixture(), config_dict())
    anomalies = out["summary"]["anomalies"]

    assert anomalies["ASSET_MISSING"] == 1
    assert anomalies["MISSING_FIELDS"] == 2
    assert anomalies["IMPLIED_NOTIONAL_TOO_HIGH"] == 1
    assert anomalies["PNL_TO_BALANCE_OUTLIER"] == 1
