"""
Temper – Risk Utilities

Deterministic helpers for selecting simulation risk parameters.
"""

from __future__ import annotations

import pandas as pd

DEFAULT_MIN_DAILY_MAX_LOSS = 1000.0
DEFAULT_SAFETY_BUFFER = 1.05
DEFAULT_DAY_TOTAL_BASE_QUANTILE = 0.01
DEFAULT_INTRADAY_BASE_QUANTILE = 0.01
DEFAULT_BALANCE_BASE_FRACTION = 0.02
DEFAULT_BALANCE_CAP_FRACTION = 0.10
DEFAULT_INTRADAY_CAP_MULTIPLIER = 1.10


def recommend_daily_max_loss(
    df: pd.DataFrame,
    *,
    min_daily_max_loss: float = DEFAULT_MIN_DAILY_MAX_LOSS,
    safety_buffer: float = DEFAULT_SAFETY_BUFFER,
) -> float:
    """
    Recommend a deterministic daily max loss threshold from dataset scale.

    Policy:
    - Always compute pnl-scale baseline:
      pnl_base = abs(q05(day_total_pnl))
      pnl_cap = abs(q01(day_total_pnl))
    - If `balance` exists, compute balance-scale baseline:
      balance_base = max(min_daily_max_loss, 0.02 * median(balance))
      balance_cap = 0.10 * median(balance)
    - Use base = max(pnl_base, balance_base_if_available, min_daily_max_loss)
      so the threshold tracks dataset scale.
    - Apply a small safety buffer to reduce quantile-edge false checkmates.
    - Use cap = max(abs(min_intraday_pnl) * 1.1, balance_cap_if_available)
      to avoid outlier explosions while preserving the buffered base.
    """
    if "timestamp" not in df.columns or "pnl" not in df.columns:
        raise ValueError("DataFrame must include 'timestamp' and 'pnl'")

    if not pd.api.types.is_datetime64_any_dtype(df["timestamp"]):
        raise ValueError("'timestamp' column must be datetime64 dtype")

    working = df.copy()
    working["_row_order"] = range(len(working))
    working = working.sort_values(["timestamp", "_row_order"], kind="mergesort")

    day = working["timestamp"].dt.floor("D")
    day_total_pnl = working.groupby(day, sort=False)["pnl"].sum()
    if day_total_pnl.empty:
        return float(min_daily_max_loss)

    # Intraday running PnL trough per day captures realistic drawdown pressure.
    day_running_pnl = working.groupby(day, sort=False)["pnl"].cumsum()
    day_min_intraday_pnl = day_running_pnl.groupby(day, sort=False).min()

    # Use 1% tails for a calmer default that avoids frequent false checkmates.
    pnl_base = abs(float(day_total_pnl.quantile(DEFAULT_DAY_TOTAL_BASE_QUANTILE)))
    pnl_base_intraday = abs(
        float(day_min_intraday_pnl.quantile(DEFAULT_INTRADAY_BASE_QUANTILE))
    )
    pnl_cap = abs(float(day_min_intraday_pnl.min())) * DEFAULT_INTRADAY_CAP_MULTIPLIER

    if "balance" in df.columns:
        balance = pd.to_numeric(df["balance"], errors="coerce").dropna()
        if balance.empty:
            median_balance = float("nan")
        else:
            median_balance = float(balance.median())

        if pd.isna(median_balance):
            base = max(min_daily_max_loss, pnl_base, pnl_base_intraday)
            cap = pnl_cap
        else:
            # Use absolute median balance to avoid negative synthetic-balance artifacts.
            median_balance = abs(median_balance)
            balance_base = max(
                min_daily_max_loss, DEFAULT_BALANCE_BASE_FRACTION * median_balance
            )
            balance_cap = DEFAULT_BALANCE_CAP_FRACTION * median_balance
            base = max(min_daily_max_loss, pnl_base, pnl_base_intraday, balance_base)
            cap = max(pnl_cap, balance_cap)
    else:
        base = max(min_daily_max_loss, pnl_base, pnl_base_intraday)
        cap = pnl_cap

    recommended = base * safety_buffer
    if cap > 0:
        return float(min(recommended, cap))
    return float(recommended)
