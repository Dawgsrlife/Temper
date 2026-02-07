"""
Temper – Risk Utilities

Deterministic helpers for selecting simulation risk parameters.
"""

from __future__ import annotations

import pandas as pd


def recommend_daily_max_loss(
    df: pd.DataFrame,
    *,
    min_daily_max_loss: float = 1000.0,
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
    - Use cap = max(pnl_cap, balance_cap_if_available) to avoid over-clamping.
    - Apply clamp to avoid extreme outlier-driven values.
    """
    if "timestamp" not in df.columns or "pnl" not in df.columns:
        raise ValueError("DataFrame must include 'timestamp' and 'pnl'")

    if not pd.api.types.is_datetime64_any_dtype(df["timestamp"]):
        raise ValueError("'timestamp' column must be datetime64 dtype")

    day = df["timestamp"].dt.floor("D")
    day_total_pnl = df.groupby(day, sort=False)["pnl"].sum()
    if day_total_pnl.empty:
        return float(min_daily_max_loss)

    pnl_base = abs(float(day_total_pnl.quantile(0.05)))
    pnl_cap = abs(float(day_total_pnl.quantile(0.01)))

    if "balance" in df.columns:
        balance = pd.to_numeric(df["balance"], errors="coerce").dropna()
        if balance.empty:
            median_balance = float("nan")
        else:
            median_balance = float(balance.median())

        if pd.isna(median_balance):
            base = max(min_daily_max_loss, pnl_base)
            cap = pnl_cap
        else:
            # Use absolute median balance to avoid negative synthetic-balance artifacts.
            median_balance = abs(median_balance)
            balance_base = max(min_daily_max_loss, 0.02 * median_balance)
            balance_cap = 0.10 * median_balance
            base = max(min_daily_max_loss, pnl_base, balance_base)
            cap = max(pnl_cap, balance_cap)
    else:
        base = max(min_daily_max_loss, pnl_base)
        cap = pnl_cap

    if cap > 0:
        return float(min(base, cap))
    return float(base)
