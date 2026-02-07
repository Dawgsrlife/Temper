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
    - DataFrame with simulated_pnl and simulated_equity
    - Summary dict with cost_of_bias and outcome
    """

    REQUIRED_COLUMNS: tuple[str, ...] = ("timestamp", "pnl")

    def __init__(
        self,
        df: pd.DataFrame,
        *,
        daily_max_loss_absolute: float = -500.0,
    ) -> None:
        self._validate_input(df)
        if daily_max_loss_absolute > 0:
            raise ValueError("daily_max_loss_absolute must be <= 0")

        self._df = df.copy()
        self.daily_max_loss_absolute = float(daily_max_loss_absolute)
        self._result_df: pd.DataFrame | None = None
        self._summary: dict[str, float | str] | None = None

    def _validate_input(self, df: pd.DataFrame) -> None:
        missing = set(self.REQUIRED_COLUMNS) - set(df.columns)
        if missing:
            raise ValueError(f"DataFrame missing required columns: {missing}")

        if not pd.api.types.is_datetime64_any_dtype(df["timestamp"]):
            raise ValueError("'timestamp' column must be datetime64 dtype")

    def run(self) -> tuple[pd.DataFrame, dict[str, float | str]]:
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
        breached = pre_keep & daily_running_pnl.le(self.daily_max_loss_absolute)
        breach_rank = breached.groupby(trade_day, sort=False).cumsum()
        first_breach = breached & breach_rank.eq(1)
        blocked_after_breach = breach_rank.ge(1) & ~first_breach

        keep_trade = pre_keep & ~blocked_after_breach

        df["simulated_pnl"] = df["pnl"].where(keep_trade, 0.0)
        df["simulated_equity"] = df["simulated_pnl"].cumsum()

        actual_total = float(df["pnl"].sum())
        simulated_total = float(df["simulated_pnl"].sum())
        cost_of_bias = simulated_total - actual_total

        outcome = "unchanged"
        if cost_of_bias > 0:
            outcome = "improved"
        elif cost_of_bias < 0:
            outcome = "worse"

        summary: dict[str, float | str] = {
            "cost_of_bias": cost_of_bias,
            "outcome": outcome,
        }

        self._result_df = df
        self._summary = summary
        return df.copy(), dict(summary)
