"""
Temper – Counterfactual Engine

Pure pandas replay that simulates outcomes under simple discipline rules.
This module is designed for backend batch/background execution at 200k+ rows.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

from app.detective import BiasThresholds
from app.risk import recommend_daily_max_loss


class CounterfactualEngine:
    """
    Deterministic constrained-policy replay on normalized + flagged trades.

    Input DataFrame is expected to include:
    - timestamp (datetime64)
    - pnl (numeric)
    - is_revenge (bool, optional -> defaults False)
    - is_overtrading (bool, optional -> defaults False)
    - is_loss_aversion (bool, optional -> ignored for blocking)

    Output (replay semantics):
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
        daily_max_loss: float | None = None,
    ) -> None:
        self._validate_input(df)
        resolved_daily_max_loss = (
            recommend_daily_max_loss(df) if daily_max_loss is None else float(daily_max_loss)
        )
        if not math.isfinite(resolved_daily_max_loss) or resolved_daily_max_loss <= 0:
            raise ValueError("daily_max_loss must be a finite value > 0")

        self._df = df.copy()
        self.daily_max_loss = resolved_daily_max_loss
        self._bias_thresholds = BiasThresholds()
        self.overtrading_cooldown_minutes = 30
        self._result_df: pd.DataFrame | None = None
        self._summary: dict[str, float | int | str] | None = None

    def _validate_input(self, df: pd.DataFrame) -> None:
        missing = set(self.REQUIRED_COLUMNS) - set(df.columns)
        if missing:
            raise ValueError(f"DataFrame missing required columns: {missing}")

        if not pd.api.types.is_datetime64_any_dtype(df["timestamp"]):
            raise ValueError("'timestamp' column must be datetime64 dtype")

        if df["timestamp"].isna().any():
            raise ValueError("'timestamp' column must not contain NaT values")

        pnl_numeric = pd.to_numeric(df["pnl"], errors="coerce")
        if pnl_numeric.isna().any() or not np.isfinite(pnl_numeric.to_numpy()).all():
            raise ValueError("'pnl' column must contain only finite numeric values")

    def _validate_outputs(self, df: pd.DataFrame) -> None:
        required_out = (
            "simulated_pnl",
            "simulated_equity",
            "simulated_daily_pnl",
            "is_blocked_bias",
            "is_blocked_risk",
            "blocked_reason",
            "checkmated_day",
        )
        if df[list(required_out)].isna().any().any():
            raise ValueError("Counterfactual output contains NaN values in required columns")

        allowed_reasons = {"NONE", "BIAS", "DAILY_MAX_LOSS"}
        reasons = set(df["blocked_reason"].unique())
        if not reasons.issubset(allowed_reasons):
            raise ValueError("Counterfactual output contains invalid blocked_reason values")

        risk_blocked = df["blocked_reason"] == "DAILY_MAX_LOSS"
        if not (df.loc[risk_blocked, "simulated_pnl"] == 0.0).all():
            raise ValueError(
                "blocked_reason invariant failed: DAILY_MAX_LOSS rows must have simulated_pnl=0"
            )

        if not (df["is_blocked_bias"] == df["blocked_reason"].eq("BIAS")).all():
            raise ValueError("is_blocked_bias must align with blocked_reason=BIAS")

        if not (df["is_blocked_risk"] == df["blocked_reason"].eq("DAILY_MAX_LOSS")).all():
            raise ValueError("is_blocked_risk must align with blocked_reason=DAILY_MAX_LOSS")

    def run(self) -> tuple[pd.DataFrame, dict[str, float | int | str]]:
        """
        Run the counterfactual simulation.

        Constrained replay rules:
        1. Overtrading (`is_overtrading`): skip trade under cooldown policy
           (replay pnl = 0 for that row; no replacement trade is assumed).
        2. Revenge (`is_revenge`): rescale size effect to rolling median size.
        3. Loss aversion (`is_loss_aversion`): cap negative pnl at median loss.
        4. Daily max loss guardrail:
           - breach trade is allowed
           - only subsequent same-day trades are blocked
           - resets at each calendar day boundary
        """
        if self._result_df is not None and self._summary is not None:
            return self._result_df.copy(), dict(self._summary)

        df = self._df.copy()
        df["_row_order"] = range(len(df))
        sort_order = [
            col
            for col in ("timestamp", "asset", "side", "price", "size_usd", "pnl")
            if col in df.columns
        ] + ["_row_order"]
        df = df.sort_values(sort_order, kind="mergesort")

        # Optional flags default to False to keep input contract flexible.
        is_revenge = (
            df["is_revenge"].fillna(False).astype(bool)
            if "is_revenge" in df.columns
            else pd.Series(False, index=df.index, dtype=bool)
        )
        is_overtrading = (
            df["is_overtrading"].fillna(False).astype(bool)
            if "is_overtrading" in df.columns
            else pd.Series(False, index=df.index, dtype=bool)
        )
        is_loss_aversion = (
            df["is_loss_aversion"].fillna(False).astype(bool)
            if "is_loss_aversion" in df.columns
            else pd.Series(False, index=df.index, dtype=bool)
        )

        pnl = pd.to_numeric(df["pnl"], errors="coerce").astype(float)
        size_usd = pd.to_numeric(df.get("size_usd"), errors="coerce").fillna(0.0) if "size_usd" in df.columns else pd.Series(0.0, index=df.index, dtype=float)

        # Start from actual pnl, then apply deterministic discipline adjustments.
        replay_pnl = pnl.to_numpy(dtype=float).copy()
        replay_effective_scale = np.ones(len(df), dtype=float)
        replay_rescale_factor = np.ones(len(df), dtype=float)
        replay_loss_cap_factor = np.ones(len(df), dtype=float)
        replay_loss_cap_value = np.zeros(len(df), dtype=float)
        replay_deferred = np.zeros(len(df), dtype=bool)
        replay_rescaled = np.zeros(len(df), dtype=bool)
        replay_loss_capped = np.zeros(len(df), dtype=bool)
        deferred_target_index = np.full(len(df), -1, dtype=int)
        size_values = size_usd.to_numpy(dtype=float)

        # 1) Overtrading cooldown policy: skip flagged trade (no replacement mapping).
        if is_overtrading.any():
            for i in np.flatnonzero(is_overtrading.to_numpy()):
                replay_pnl[i] = 0.0
                replay_effective_scale[i] = 0.0
                replay_deferred[i] = True

        # 2) Revenge rescale: scale pnl by rolling median size ratio.
        if is_revenge.any():
            baseline_window = int(self._bias_thresholds.revenge_baseline_window_trades)
            rolling_median_size = size_usd.rolling(baseline_window, min_periods=1).median()
            with np.errstate(divide="ignore", invalid="ignore"):
                ratio = rolling_median_size.to_numpy(dtype=float) / size_usd.to_numpy(dtype=float)
            ratio = np.where(np.isfinite(ratio), ratio, 1.0)
            ratio = np.clip(ratio, 0.0, 1.0)
            revenge_mask = is_revenge.to_numpy()
            replay_pnl[revenge_mask] = replay_pnl[revenge_mask] * ratio[revenge_mask]
            replay_effective_scale[revenge_mask] = replay_effective_scale[revenge_mask] * ratio[revenge_mask]
            replay_rescale_factor[revenge_mask] = ratio[revenge_mask]
            replay_rescaled[revenge_mask] = True

        # 3) Loss aversion cap via exposure scaling on realized price move.
        # Same entry/exit path; only exposure changes.
        wins = pnl[pnl > 0]
        median_win = float(wins.median()) if not wins.empty else 0.0
        loss_cap_value = (
            float(self._bias_thresholds.loss_aversion_loss_to_win_multiplier) * median_win
            if median_win > 0
            else 0.0
        )
        if loss_cap_value > 0 and is_loss_aversion.any():
            loss_mask = is_loss_aversion.to_numpy() & (replay_pnl < 0)
            if loss_mask.any():
                original_abs = np.abs(pnl.to_numpy(dtype=float)[loss_mask])
                scale = np.where(
                    original_abs > 0.0,
                    np.minimum(1.0, loss_cap_value / original_abs),
                    1.0,
                )
                replay_pnl[loss_mask] = replay_pnl[loss_mask] * scale
                replay_effective_scale[loss_mask] = replay_effective_scale[loss_mask] * scale
                replay_loss_cap_factor[loss_mask] = scale
                replay_loss_cap_value[loss_mask] = loss_cap_value
                replay_loss_capped[loss_mask] = scale < (1.0 - 1e-12)

        bias_modified = is_revenge.to_numpy() | is_overtrading.to_numpy() | is_loss_aversion.to_numpy()

        # Daily running PnL after discipline adjustments, before risk cutoff.
        trade_day = df["timestamp"].dt.floor("D")
        pre_simulated_pnl = pd.Series(replay_pnl, index=df.index, dtype=float)
        daily_running_pnl = pre_simulated_pnl.groupby(trade_day, sort=False).cumsum()

        # Breach trade is allowed; only rows after first breach in same day are blocked.
        daily_loss_floor = -self.daily_max_loss
        breached = daily_running_pnl.le(daily_loss_floor)
        breach_rank = breached.groupby(trade_day, sort=False).cumsum()
        first_breach = breached & breach_rank.eq(1)
        blocked_after_breach = breach_rank.ge(1) & ~first_breach

        keep_trade = ~blocked_after_breach

        df["is_blocked_bias"] = bias_modified & ~blocked_after_breach.to_numpy()
        df["is_blocked_risk"] = blocked_after_breach
        df["blocked_reason"] = "NONE"
        df.loc[df["is_blocked_bias"], "blocked_reason"] = "BIAS"
        df.loc[df["is_blocked_risk"], "blocked_reason"] = "DAILY_MAX_LOSS"

        day_has_breach = breached.groupby(trade_day, sort=False).transform("any")
        df["checkmated_day"] = day_has_breach.astype(bool)

        df["simulated_pnl"] = np.where(keep_trade.to_numpy(), replay_pnl, 0.0)
        df["simulated_daily_pnl"] = df["simulated_pnl"].groupby(
            trade_day, sort=False
        ).cumsum()
        df["simulated_equity"] = df["simulated_pnl"].cumsum()
        df["simulated_size_usd"] = size_values * replay_effective_scale
        df["replay_effective_scale"] = replay_effective_scale
        df["replay_rescale_factor"] = replay_rescale_factor
        df["replay_loss_cap_factor"] = replay_loss_cap_factor
        df["replay_loss_cap_value"] = replay_loss_cap_value
        df["replay_deferred"] = replay_deferred
        df["replay_rescaled"] = replay_rescaled
        df["replay_loss_capped"] = replay_loss_capped
        df["replay_deferred_target_index"] = deferred_target_index

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
            "deferred_trade_count": int(df["replay_deferred"].sum()),
            "rescaled_trade_count": int(df["replay_rescaled"].sum()),
            "loss_capped_trade_count": int(df["replay_loss_capped"].sum()),
            "daily_max_loss_used": self.daily_max_loss,
            "outcome": outcome,
        }

        # Preserve caller row order while keeping timeline-correct simulation math.
        df = df.sort_values("_row_order", kind="mergesort").drop(columns=["_row_order"])
        self._validate_outputs(df)

        self._result_df = df
        self._summary = summary
        return df.copy(), dict(summary)
