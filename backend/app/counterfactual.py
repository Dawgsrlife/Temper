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
        1. Overtrading (`is_overtrading`): defer trade to the next same-asset/same-side
           trade after cooldown; if no future fill exists, fallback to 0.
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
        timestamps = pd.to_datetime(df["timestamp"], errors="coerce")
        timestamp_values = timestamps.to_numpy()

        # Start from actual pnl, then apply deterministic discipline adjustments.
        replay_pnl = pnl.to_numpy(dtype=float).copy()
        replay_deferred = np.zeros(len(df), dtype=bool)
        replay_rescaled = np.zeros(len(df), dtype=bool)
        replay_loss_capped = np.zeros(len(df), dtype=bool)
        deferred_target_index = np.full(len(df), -1, dtype=int)

        # 1) Overtrading defer: same asset + side, earliest trade after cooldown.
        cooldown_delta = np.timedelta64(int(self.overtrading_cooldown_minutes), "m")
        if is_overtrading.any():
            asset_key = (
                df["asset"].astype(str).fillna("")
                if "asset" in df.columns
                else pd.Series("", index=df.index, dtype=object)
            )
            side_key = (
                df["side"].astype(str).fillna("")
                if "side" in df.columns
                else pd.Series("", index=df.index, dtype=object)
            )
            grouped: dict[tuple[str, str], dict[str, np.ndarray]] = {}
            for (asset, side), grp in df.groupby([asset_key, side_key], sort=False):
                idx = grp.index.to_numpy(dtype=int)
                grouped[(str(asset), str(side))] = {
                    "idx": idx,
                    "ts": timestamp_values[idx],
                    "pnl": pnl.to_numpy(dtype=float)[idx],
                    "size": size_usd.to_numpy(dtype=float)[idx],
                }

            for i in np.flatnonzero(is_overtrading.to_numpy()):
                key = (str(asset_key.iloc[i]), str(side_key.iloc[i]))
                group = grouped.get(key)
                if group is None:
                    replay_pnl[i] = 0.0
                    replay_deferred[i] = True
                    continue
                idx = group["idx"]
                ts = group["ts"]
                target_timestamp = timestamp_values[i] + cooldown_delta
                candidate_pos = int(np.searchsorted(ts, target_timestamp, side="left"))
                while candidate_pos < len(idx) and int(idx[candidate_pos]) <= i:
                    candidate_pos += 1
                if candidate_pos >= len(idx):
                    replay_pnl[i] = 0.0
                    replay_deferred[i] = True
                    continue
                target_i = int(idx[candidate_pos])
                deferred_target_index[i] = target_i
                deferred_pnl = float(group["pnl"][candidate_pos])
                base_size = float(size_usd.iloc[i])
                target_size = float(group["size"][candidate_pos])
                if base_size > 0 and target_size > 0 and math.isfinite(base_size) and math.isfinite(target_size):
                    deferred_pnl *= base_size / target_size
                replay_pnl[i] = deferred_pnl
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
            replay_rescaled[revenge_mask] = True

        # 3) Loss aversion cap: cap negative pnl at median loss magnitude.
        median_loss_abs = float(pnl[pnl < 0].abs().median()) if (pnl < 0).any() else 0.0
        if median_loss_abs > 0 and is_loss_aversion.any():
            loss_mask = is_loss_aversion.to_numpy() & (replay_pnl < 0)
            replay_pnl[loss_mask] = np.maximum(replay_pnl[loss_mask], -median_loss_abs)
            replay_loss_capped[loss_mask] = True

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
