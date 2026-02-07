"""
Temper – Counterfactual Engine

Pure pandas replay that simulates outcomes under simple discipline rules.
This module is designed for backend batch/background execution at 200k+ rows.
"""

from __future__ import annotations

import pandas as pd


class CounterfactualEngine:
    """
    Vectorized counterfactual simulation on normalized + flagged trades.

    Input DataFrame is expected to include:
    - timestamp (datetime64)
    - pnl (numeric)
    - is_revenge (bool, optional -> defaults False)
    - is_overtrading (bool, optional -> defaults False)
    - is_loss_aversion (bool, optional -> ignored for blocking)

    Output:
    - DataFrame with:
      simulated_pnl, simulated_equity, simulated_daily_pnl,
      is_blocked_bias, is_blocked_risk, blocked_reason, checkmated_day
    - Summary dict with:
      actual_total_pnl, simulated_total_pnl, delta_pnl, cost_of_bias,
      blocked_bias_count, blocked_risk_count, outcome
    """

    REQUIRED_COLUMNS: tuple[str, ...] = ("timestamp", "pnl")

    def __init__(
        self,
        df: pd.DataFrame,
        *,
        daily_max_loss: float = 1000.0,
    ) -> None:
        self._validate_input(df)
        if daily_max_loss <= 0:
            raise ValueError("daily_max_loss must be > 0")

        self._df = df.copy()
        self.daily_max_loss = float(daily_max_loss)
        self._result_df: pd.DataFrame | None = None
        self._summary: dict[str, float | int | str] | None = None

    def _validate_input(self, df: pd.DataFrame) -> None:
        missing = set(self.REQUIRED_COLUMNS) - set(df.columns)
        if missing:
            raise ValueError(f"DataFrame missing required columns: {missing}")

        if not pd.api.types.is_datetime64_any_dtype(df["timestamp"]):
            raise ValueError("'timestamp' column must be datetime64 dtype")

    def run(self) -> tuple[pd.DataFrame, dict[str, float | int | str]]:
        """
        Run the counterfactual simulation.

        Rules:
        1. Block revenge trades (`is_revenge`)
        2. Block overtrading trades (`is_overtrading`)
        3. Do NOT block loss aversion trades (`is_loss_aversion`)
        4. Daily max loss:
           - breach trade is allowed
           - only subsequent same-day trades are blocked
           - resets at each calendar day boundary
        """
        if self._result_df is not None and self._summary is not None:
            return self._result_df.copy(), dict(self._summary)

        df = self._df.copy()

        # Optional flags default to False to keep input contract flexible.
        is_revenge = (
            df["is_revenge"].fillna(False).astype(bool)
            if "is_revenge" in df.columns
            else pd.Series(False, index=df.index)
        )
        is_overtrading = (
            df["is_overtrading"].fillna(False).astype(bool)
            if "is_overtrading" in df.columns
            else pd.Series(False, index=df.index)
        )

        blocked_by_bias = is_revenge | is_overtrading
        pre_keep = ~blocked_by_bias

        # First-pass daily running PnL after bias filters.
        trade_day = df["timestamp"].dt.floor("D")
        pre_simulated_pnl = df["pnl"].where(pre_keep, 0.0)
        daily_running_pnl = pre_simulated_pnl.groupby(trade_day, sort=False).cumsum()

        # Breach trade is allowed; only rows after first breach in same day are blocked.
        daily_loss_floor = -self.daily_max_loss
        breached = pre_keep & daily_running_pnl.le(daily_loss_floor)
        breach_rank = breached.groupby(trade_day, sort=False).cumsum()
        first_breach = breached & breach_rank.eq(1)
        blocked_after_breach = pre_keep & breach_rank.ge(1) & ~first_breach

        keep_trade = pre_keep & ~blocked_after_breach

        df["is_blocked_bias"] = blocked_by_bias
        df["is_blocked_risk"] = blocked_after_breach
        df["blocked_reason"] = "NONE"
        df.loc[df["is_blocked_bias"], "blocked_reason"] = "BIAS"
        df.loc[df["is_blocked_risk"], "blocked_reason"] = "DAILY_MAX_LOSS"

        day_has_breach = breached.groupby(trade_day, sort=False).transform("any")
        df["checkmated_day"] = day_has_breach.astype(bool)

        df["simulated_pnl"] = df["pnl"].where(keep_trade, 0.0)
        df["simulated_daily_pnl"] = df["simulated_pnl"].groupby(
            trade_day, sort=False
        ).cumsum()
        df["simulated_equity"] = df["simulated_pnl"].cumsum()

        actual_total = float(df["pnl"].sum())
        simulated_total = float(df["simulated_pnl"].sum())
        delta_pnl = simulated_total - actual_total
        cost_of_bias = max(0.0, delta_pnl)

        any_checkmated = bool(day_has_breach.any())
        if any_checkmated:
            outcome = "CHECKMATED"
        elif delta_pnl > 1e-12:
            outcome = "WINNER"
        elif abs(delta_pnl) <= 1e-12:
            outcome = "DRAW"
        else:
            outcome = "RESIGN"

        summary: dict[str, float | int | str] = {
            "actual_total_pnl": actual_total,
            "simulated_total_pnl": simulated_total,
            "delta_pnl": delta_pnl,
            "cost_of_bias": cost_of_bias,
            "blocked_bias_count": int(df["is_blocked_bias"].sum()),
            "blocked_risk_count": int(df["is_blocked_risk"].sum()),
            "outcome": outcome,
        }

        self._result_df = df
        self._summary = summary
        return df.copy(), dict(summary)
