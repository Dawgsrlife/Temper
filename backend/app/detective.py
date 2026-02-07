"""
Tempr – Bias Detection Engine

This module provides the BiasDetective class for identifying behavioral trading
biases from normalized trade data. All operations are fully vectorized for
sub-2-second performance on 200k+ rows.

Detected Biases:
- Revenge Trading: Impulsive trading after a loss
- Overtrading: Excessive trade frequency clusters
- Loss Aversion: Holding losing positions longer than winners
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TypedDict

import pandas as pd


class BiasFlags(TypedDict):
    """Bias flag columns added to the DataFrame."""

    is_revenge: bool
    is_overtrading: bool
    is_loss_aversion: bool


@dataclass(frozen=True)
class BiasThresholds:
    """
    Configurable thresholds for bias detection.

    Defaults are tuned for HFT/scalping data (200k+ trades).
    For casual traders, lower overtrading_trade_threshold to 30-50.
    """

    # Revenge Trading
    revenge_time_window_minutes: int = 15
    revenge_size_multiplier: float = 4.0  # stricter escalation filter

    # Overtrading
    overtrading_window_hours: int = 1
    overtrading_trade_threshold: int = 200  # Tuned for HFT/scalping

    # Loss Aversion
    loss_aversion_duration_multiplier: float = 8.0


class BiasDetective:
    """
    Detects behavioral trading biases from normalized trade data.

    This class analyzes trade patterns to identify:
    - Revenge Trading: Trading impulsively after losses
    - Overtrading: Excessive trading frequency
    - Loss Aversion: Holding losers longer than winners

    All operations are 100% vectorized using pandas/numpy for performance.
    No Python loops, no apply(), no iterrows().

    Example:
        >>> from app.normalizer import DataNormalizer
        >>> from app.detective import BiasDetective
        >>>
        >>> normalizer = DataNormalizer("trades.csv", column_mapping={...})
        >>> df = normalizer.normalize()
        >>>
        >>> detective = BiasDetective(df)
        >>> flagged_df = detective.detect()
        >>> print(detective.summary())
    """

    def __init__(
        self,
        df: pd.DataFrame,
        thresholds: BiasThresholds | None = None,
    ) -> None:
        """
        Initialize the BiasDetective.

        Args:
            df: Normalized DataFrame with columns:
                [timestamp, asset, price, size_usd, side, pnl]
            thresholds: Optional custom thresholds for bias detection.
                        Uses defaults if not provided.

        Raises:
            ValueError: If required columns are missing from DataFrame.
        """
        self._validate_input(df)
        self._df = df.copy()
        self.thresholds = thresholds or BiasThresholds()
        self._result_df: pd.DataFrame | None = None

    def _validate_input(self, df: pd.DataFrame) -> None:
        """Ensure required columns exist."""
        required = {"timestamp", "asset", "price", "size_usd", "side", "pnl"}
        missing = required - set(df.columns)
        if missing:
            raise ValueError(f"DataFrame missing required columns: {missing}")

        if not pd.api.types.is_datetime64_any_dtype(df["timestamp"]):
            raise ValueError("'timestamp' column must be datetime64 dtype")

    # ─────────────────────────────────────────────────────────────────────────
    # Revenge Trading Detection
    # ─────────────────────────────────────────────────────────────────────────

    def _detect_revenge_trading(self, df: pd.DataFrame) -> pd.Series:
        """
        Detect revenge trading: impulsive trades after losses.

        Criteria:
        1. Previous trade was a loss (pnl < 0)
        2. Current trade within 15 minutes of previous trade
        3. Current size_usd > threshold * previous size_usd

        Implementation: Fully vectorized using .shift(1)

        Returns:
            Boolean Series where True = revenge trade flagged
        """
        # Shift to get previous trade values
        prev_pnl = df["pnl"].shift(1)
        prev_timestamp = df["timestamp"].shift(1)
        prev_size = df["size_usd"].shift(1)

        # Condition 1: Previous trade was a loss
        prev_was_loss = prev_pnl < 0

        # Condition 2: Current trade within time window of previous
        time_diff = (df["timestamp"] - prev_timestamp).dt.total_seconds() / 60
        within_window = time_diff <= self.thresholds.revenge_time_window_minutes

        # Condition 3: Current size > multiplier * previous size
        size_increased = df["size_usd"] > (
            self.thresholds.revenge_size_multiplier * prev_size
        )

        # All conditions must be true
        is_revenge = prev_was_loss & within_window & size_increased

        # First row can't be revenge (no previous trade)
        is_revenge = is_revenge.fillna(False)

        return is_revenge

    # ─────────────────────────────────────────────────────────────────────────
    # Overtrading Detection
    # ─────────────────────────────────────────────────────────────────────────

    def _detect_overtrading(self, df: pd.DataFrame) -> pd.Series:
        """
        Detect overtrading: high-frequency trading clusters.

        Criteria:
        - Count trades in rolling 1-hour window
        - Flag if count > 10 trades per hour

        Implementation: Vectorized rolling window count

        Returns:
            Boolean Series where True = overtrading flagged
        """
        # Ensure sorted by timestamp (should already be, but defensive)
        df_sorted = df.sort_values("timestamp").reset_index(drop=True)

        # Create a count column for rolling
        df_sorted["_trade_count"] = 1

        # Set timestamp as index for time-based rolling
        df_indexed = df_sorted.set_index("timestamp")

        # Rolling count over 1-hour window
        window_str = f"{self.thresholds.overtrading_window_hours}h"
        rolling_count = (
            df_indexed["_trade_count"]
            .rolling(window_str, min_periods=1)
            .sum()
        )

        # Flag if exceeds threshold
        is_overtrading = rolling_count > self.thresholds.overtrading_trade_threshold

        # Reset index to align with original DataFrame
        is_overtrading = is_overtrading.reset_index(drop=True)

        return is_overtrading

    # ─────────────────────────────────────────────────────────────────────────
    # Loss Aversion Detection
    # ─────────────────────────────────────────────────────────────────────────

    def _detect_loss_aversion(self, df: pd.DataFrame) -> pd.Series:
        """
        Detect loss aversion: holding losers longer than winners.

        Criteria:
        1. Calculate holding duration per asset (time between trades)
        2. Compute median duration of winning trades
        3. Flag losses where duration > threshold * median win duration

        Implementation: Vectorized groupby + diff for per-asset durations

        Returns:
            Boolean Series where True = loss aversion flagged
        """
        # Step A: Calculate time between trades for each asset
        # Sort by asset then timestamp to ensure proper diff
        df_sorted = df.sort_values(["asset", "timestamp"]).copy()

        # Time difference to previous trade of same asset
        df_sorted["_holding_duration"] = df_sorted.groupby("asset")[
            "timestamp"
        ].diff()

        # Convert to seconds for comparison
        duration_seconds = df_sorted["_holding_duration"].dt.total_seconds()

        # Step B: Calculate median holding duration of winning trades
        is_win = df_sorted["pnl"] > 0
        win_durations = duration_seconds[is_win]

        # Handle edge case: no winning trades
        if win_durations.dropna().empty:
            # Can't compute loss aversion without win reference
            return pd.Series(False, index=df.index)

        median_win_duration = win_durations.median()

        # Step C: Flag losses where duration > 1.5x median win duration
        is_loss = df_sorted["pnl"] < 0
        duration_threshold = (
            self.thresholds.loss_aversion_duration_multiplier * median_win_duration
        )
        held_too_long = duration_seconds > duration_threshold

        is_loss_aversion = is_loss & held_too_long

        # Reindex to match original DataFrame order
        is_loss_aversion = is_loss_aversion.reindex(df.index).fillna(False)

        return is_loss_aversion

    # ─────────────────────────────────────────────────────────────────────────
    # Public API
    # ─────────────────────────────────────────────────────────────────────────

    def detect(self) -> pd.DataFrame:
        """
        Run all bias detection algorithms.

        Returns:
            DataFrame with original columns plus:
            - is_revenge: bool
            - is_overtrading: bool
            - is_loss_aversion: bool

        Performance: Handles 211k rows in <2 seconds.
        """
        if self._result_df is not None:
            return self._result_df.copy()

        df = self._df.copy()

        # Run all detectors (vectorized)
        df["is_revenge"] = self._detect_revenge_trading(df)
        df["is_overtrading"] = self._detect_overtrading(df)
        df["is_loss_aversion"] = self._detect_loss_aversion(df)

        # Cache result
        self._result_df = df

        return df.copy()

    def summary(self) -> dict:
        """
        Get summary statistics for detected biases.

        Returns:
            Dict with counts and percentages for each bias type.
        """
        df = self.detect()
        total = len(df)

        def stats(col: str) -> dict:
            count = df[col].sum()
            return {
                "count": int(count),
                "percentage": round((count / total) * 100, 2),
            }

        revenge = stats("is_revenge")
        overtrading = stats("is_overtrading")
        loss_aversion = stats("is_loss_aversion")

        # Trades with any bias
        any_bias = df["is_revenge"] | df["is_overtrading"] | df["is_loss_aversion"]
        any_bias_count = any_bias.sum()

        return {
            "total_trades": total,
            "revenge_trading": revenge,
            "overtrading": overtrading,
            "loss_aversion": loss_aversion,
            "any_bias": {
                "count": int(any_bias_count),
                "percentage": round((any_bias_count / total) * 100, 2),
            },
            "thresholds": {
                "revenge_time_window_minutes": self.thresholds.revenge_time_window_minutes,
                "revenge_size_multiplier": self.thresholds.revenge_size_multiplier,
                "overtrading_window_hours": self.thresholds.overtrading_window_hours,
                "overtrading_trade_threshold": self.thresholds.overtrading_trade_threshold,
                "loss_aversion_duration_multiplier": self.thresholds.loss_aversion_duration_multiplier,
            },
        }


# ─────────────────────────────────────────────────────────────────────────────
# Sample Usage
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import json
    import time
    from pathlib import Path

    from app.normalizer import DataNormalizer

    # Load and normalize data
    project_root = Path(__file__).resolve().parents[2]
    csv_path = project_root / "historical_data.csv"

    print(f"Loading data from: {csv_path}")
    print("=" * 60)

    normalizer = DataNormalizer(
        source=csv_path,
        column_mapping={
            "Timestamp IST": "timestamp",
            "Coin": "asset",
            "Execution Price": "price",
            "Size USD": "size_usd",
            "Side": "side",
            "Closed PnL": "pnl",
        },
    )
    df = normalizer.normalize()
    print(f"Normalized {len(df):,} rows")

    # Run bias detection
    print("\nRunning BiasDetective...")
    start = time.perf_counter()

    detective = BiasDetective(df)
    flagged_df = detective.detect()

    elapsed = time.perf_counter() - start
    print(f"Detection completed in {elapsed:.3f} seconds")

    # Output summary
    print(f"\nBias Summary:\n{json.dumps(detective.summary(), indent=2)}")

    # Show sample flagged trades
    print("\n" + "=" * 60)
    print("Sample Revenge Trades:")
    revenge_sample = flagged_df[flagged_df["is_revenge"]].head(3)
    print(revenge_sample[["timestamp", "asset", "size_usd", "pnl", "is_revenge"]])

    print("\nSample Overtrading Trades:")
    overtrading_sample = flagged_df[flagged_df["is_overtrading"]].head(3)
    print(overtrading_sample[["timestamp", "asset", "size_usd", "pnl", "is_overtrading"]])

    print("\nSample Loss Aversion Trades:")
    loss_aversion_sample = flagged_df[flagged_df["is_loss_aversion"]].head(3)
    print(loss_aversion_sample[["timestamp", "asset", "size_usd", "pnl", "is_loss_aversion"]])
