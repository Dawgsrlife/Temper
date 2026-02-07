"""
Tempr – Data Normalization Layer

This module provides the DataNormalizer class for converting raw trade data
from various sources into a standardized internal format for the bias detection
pipeline.

Design Philosophy:
- Vectorized operations only (no Python loops) for 200k+ row performance
- Flexible column mapping to handle different data sources
- Strict type enforcement for downstream pipeline reliability
- Immutable operations (returns new DataFrames, never mutates input)
"""

from __future__ import annotations

from pathlib import Path
from typing import TypedDict, Literal
import warnings

import pandas as pd


class NormalizedSchema(TypedDict):
    """The standardized output schema after normalization."""

    timestamp: pd.Timestamp
    asset: str
    price: float
    size_usd: float
    side: Literal["Buy", "Sell"]
    pnl: float


# Default column mapping for the current Hyperliquid export format
DEFAULT_COLUMN_MAPPING: dict[str, str] = {
    "Timestamp IST": "timestamp",
    "Coin": "asset",
    "Execution Price": "price",
    "Size USD": "size_usd",
    "Side": "side",
    "Closed PnL": "pnl",
}

# Judge fixture format mapping.
# Note: quantity is renamed to size_qty_proxy first, then size_usd is
# derived as quantity * price to preserve downstream schema requirements.
JUDGE_COLUMN_MAPPING_REQUIRED: dict[str, str] = {
    "timestamp": "timestamp",
    "asset": "asset",
    "entry_price": "price",
    "quantity": "size_qty_proxy",
    "side": "side",
    "profit_loss": "pnl",
}
JUDGE_COLUMN_MAPPING_OPTIONAL: dict[str, str] = {
    "balance": "balance",
}


class DataNormalizer:
    """
    Normalizes raw trading data into a standardized format for the Tempr pipeline.

    This class handles:
    - Column renaming via flexible mapping
    - Timestamp parsing and normalization
    - Type coercion for numeric fields
    - Chronological sorting

    All operations are vectorized for performance with large datasets (200k+ rows).

    Example:
        >>> normalizer = DataNormalizer("trades.csv", column_mapping={...})
        >>> df = normalizer.normalize()
        >>> df.columns
        Index(['timestamp', 'asset', 'price', 'size_usd', 'side', 'pnl'], dtype='object')
    """

    # Required columns in the normalized output
    REQUIRED_COLUMNS: tuple[str, ...] = (
        "timestamp",
        "asset",
        "price",
        "size_usd",
        "side",
        "pnl",
    )
    OPTIONAL_COLUMNS: tuple[str, ...] = ("balance",)

    def __init__(
        self,
        source: str | Path,
        column_mapping: dict[str, str] | None = None,
        *,
        timestamp_format: str | None = None,
        dayfirst: bool = True,
    ) -> None:
        """
        Initialize the DataNormalizer.

        Args:
            source: File path or URL to the CSV data source.
            column_mapping: Dict mapping source column names to standard names.
                            Keys = source columns, Values = target standard names.
                            If None, uses DEFAULT_COLUMN_MAPPING.
            timestamp_format: Optional strftime format for parsing timestamps.
                              If None, pandas will infer the format.
            dayfirst: Whether to interpret ambiguous dates as day-first (DD-MM-YYYY).
                      Default True for international format.
        """
        self.source = Path(source) if not str(source).startswith("http") else source
        self.column_mapping = column_mapping
        self.timestamp_format = timestamp_format
        self.dayfirst = dayfirst

        self._raw_df: pd.DataFrame | None = None
        self._normalized_df: pd.DataFrame | None = None
        self._resolved_mapping: dict[str, str] | None = None
        self._warnings: list[dict[str, str | int | float]] = []

    def _emit_warning(
        self,
        *,
        code: str,
        message: str,
        details: dict[str, str | int | float] | None = None,
    ) -> None:
        payload: dict[str, str | int | float] = {"code": code, "message": message}
        if details:
            payload.update(details)
        self._warnings.append(payload)
        warnings.warn(message, RuntimeWarning, stacklevel=2)

    def _load_raw(self) -> pd.DataFrame:
        """Load raw data from source. Cached after first call."""
        if self._raw_df is None:
            self._raw_df = pd.read_csv(self.source)
        return self._raw_df

    def _resolve_column_mapping(self, df: pd.DataFrame) -> dict[str, str]:
        """
        Resolve mapping based on explicit mapping or known source schemas.

        Priority:
        1. Explicit mapping passed by caller
        2. Hyperliquid schema
        3. Judge fixture schema
        4. Already-normalized schema (identity mapping)
        """
        if self._resolved_mapping is not None:
            return self._resolved_mapping

        if self.column_mapping is not None:
            self._resolved_mapping = self.column_mapping
            return self._resolved_mapping

        source_cols = set(df.columns)
        matches_hyperliquid = set(DEFAULT_COLUMN_MAPPING.keys()).issubset(source_cols)
        matches_judge = set(JUDGE_COLUMN_MAPPING_REQUIRED.keys()).issubset(source_cols)
        matches_canonical = set(self.REQUIRED_COLUMNS).issubset(source_cols)

        matched_signatures = []
        if matches_hyperliquid:
            matched_signatures.append("hyperliquid")
        if matches_judge:
            matched_signatures.append("judge")
        if matches_canonical:
            matched_signatures.append("canonical")
        if len(matched_signatures) > 1:
            self._emit_warning(
                code="ambiguous_preset_match",
                message=(
                    "Multiple schema presets matched input columns; "
                    "applying deterministic precedence."
                ),
                details={"matches": ",".join(matched_signatures)},
            )

        if matches_hyperliquid:
            self._resolved_mapping = DEFAULT_COLUMN_MAPPING
            return self._resolved_mapping

        if matches_judge:
            mapping = dict(JUDGE_COLUMN_MAPPING_REQUIRED)
            for source_col, target_col in JUDGE_COLUMN_MAPPING_OPTIONAL.items():
                if source_col in source_cols:
                    mapping[source_col] = target_col
            self._resolved_mapping = mapping
            return self._resolved_mapping

        if matches_canonical:
            self._resolved_mapping = {col: col for col in self.REQUIRED_COLUMNS}
            return self._resolved_mapping

        raise ValueError(
            "Unable to resolve column mapping from source columns. "
            f"Available columns: {list(df.columns)}"
        )

    def _validate_source_columns(self, df: pd.DataFrame, mapping: dict[str, str]) -> None:
        """Ensure all mapped source columns exist in the dataframe."""
        missing = set(mapping.keys()) - set(df.columns)
        if missing:
            raise ValueError(
                f"Source data missing required columns: {missing}. "
                f"Available columns: {list(df.columns)}"
            )

    def _rename_columns(self, df: pd.DataFrame, mapping: dict[str, str]) -> pd.DataFrame:
        """Rename columns according to the mapping. Vectorized via pandas."""
        return df.rename(columns=mapping)

    def _select_columns(self, df: pd.DataFrame) -> pd.DataFrame:
        """Select only the standardized columns we need."""
        required_available = [col for col in self.REQUIRED_COLUMNS if col in df.columns]
        optional_available = [col for col in self.OPTIONAL_COLUMNS if col in df.columns]
        available = required_available + optional_available
        return df[available].copy()

    def _ensure_size_usd(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Ensure size_usd exists for downstream detectors.

        If source has no explicit USD size but includes quantity + price,
        derive a deterministic proxy: size_usd = quantity * price.
        """
        if "size_usd" in df.columns:
            return df

        if {"size_qty_proxy", "price"}.issubset(df.columns):
            qty = pd.to_numeric(df["size_qty_proxy"], errors="coerce")
            px = pd.to_numeric(df["price"], errors="coerce")
            df["size_usd"] = (qty * px).fillna(0.0)
            return df

        df["size_usd"] = 0.0
        return df

    def _parse_timestamp(self, df: pd.DataFrame) -> pd.DataFrame:
        """Convert timestamp column to proper datetime. Vectorized."""
        if "timestamp" not in df.columns:
            raise ValueError("No 'timestamp' column found after renaming")

        # Use vectorized to_datetime with format inference
        df["timestamp"] = pd.to_datetime(
            df["timestamp"],
            format=self.timestamp_format,  # None = infer
            dayfirst=self.dayfirst,
            errors="coerce",  # Invalid dates become NaT
        )

        # Check for parsing failures
        nat_count = df["timestamp"].isna().sum()
        if nat_count > 0:
            total = len(df)
            pct = (nat_count / total) * 100
            if pct > 5:  # More than 5% failed = likely format issue
                raise ValueError(
                    f"Timestamp parsing failed for {nat_count}/{total} rows ({pct:.1f}%). "
                    f"Consider specifying timestamp_format explicitly."
                )
            self._emit_warning(
                code="residual_nat_timestamps",
                message=(
                    "Some timestamps could not be parsed but remained within tolerated "
                    "failure threshold."
                ),
                details={
                    "nat_count": int(nat_count),
                    "total_rows": int(total),
                    "nat_pct": round(float(pct), 4),
                },
            )

        return df

    def _validate_canonical_columns(self, df: pd.DataFrame) -> None:
        missing = set(self.REQUIRED_COLUMNS) - set(df.columns)
        if missing:
            raise ValueError(
                f"Normalization failed: missing canonical columns {sorted(missing)}"
            )

    def _coerce_numeric(self, df: pd.DataFrame) -> pd.DataFrame:
        """Ensure numeric columns are proper floats. Vectorized."""
        numeric_cols = ["price", "size_usd", "pnl", "balance"]

        for col in numeric_cols:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0.0)

        return df

    def _normalize_side(self, df: pd.DataFrame) -> pd.DataFrame:
        """Normalize side column to 'Buy'/'Sell'. Vectorized."""
        if "side" not in df.columns:
            return df

        # Vectorized string operations
        side_upper = df["side"].astype(str).str.upper().str.strip()

        # Map various representations to standard format
        df["side"] = side_upper.map(
            lambda x: "Buy" if x in ("BUY", "B", "LONG") else "Sell"
        )

        return df

    def _sort_chronologically(self, df: pd.DataFrame) -> pd.DataFrame:
        """Sort by timestamp ascending. Vectorized via pandas sort."""
        sort_order = [
            col
            for col in (
                "timestamp",
                "asset",
                "side",
                "price",
                "size_usd",
                "pnl",
                "balance",
            )
            if col in df.columns
        ]
        return df.sort_values(sort_order, ascending=True, kind="mergesort").reset_index(
            drop=True
        )

    def normalize(self) -> pd.DataFrame:
        """
        Execute the full normalization pipeline.

        Returns:
            A new DataFrame with standardized columns, proper types, and
            chronological ordering. The original data is not modified.

        Raises:
            ValueError: If required columns are missing or timestamp parsing fails.
        """
        if self._normalized_df is not None:
            return self._normalized_df.copy()

        # Pipeline: load → validate → rename → select → parse → coerce → sort
        df = self._load_raw()
        mapping = self._resolve_column_mapping(df)
        self._validate_source_columns(df, mapping)

        df = self._rename_columns(df, mapping)
        df = self._ensure_size_usd(df)
        df = self._select_columns(df)
        self._validate_canonical_columns(df)
        df = self._parse_timestamp(df)
        df = self._coerce_numeric(df)
        df = self._normalize_side(df)
        df = self._sort_chronologically(df)

        # Cache result
        self._normalized_df = df

        return df.copy()

    @property
    def raw_row_count(self) -> int:
        """Number of rows in the raw source data."""
        return len(self._load_raw())

    def summary(self) -> dict:
        """
        Get a summary of the normalized data for debugging/logging.

        Returns:
            Dict with row counts, date range, unique assets, etc.
        """
        df = self.normalize()

        return {
            "total_rows": len(df),
            "date_range": {
                "start": df["timestamp"].min().isoformat(),
                "end": df["timestamp"].max().isoformat(),
            },
            "unique_assets": df["asset"].nunique(),
            "assets": df["asset"].unique().tolist()[:10],  # First 10
            "side_distribution": df["side"].value_counts().to_dict(),
            "total_pnl": df["pnl"].sum(),
            "columns": list(df.columns),
            "warnings": [dict(item) for item in self._warnings],
        }

    @property
    def warnings(self) -> list[dict[str, str | int | float]]:
        return [dict(item) for item in self._warnings]


# ─────────────────────────────────────────────────────────────────────────────
# Sample Usage
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import json
    from pathlib import Path

    # Resolve path relative to this file's location (backend/app/)
    # CSV is at project root
    project_root = Path(__file__).resolve().parents[2]
    csv_path = project_root / "historical_data.csv"

    print(f"Loading data from: {csv_path}")
    print("=" * 60)

    # Initialize normalizer with the current Hyperliquid format
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
        dayfirst=True,  # DD-MM-YYYY format
    )

    # Run normalization
    df = normalizer.normalize()

    # Output summary
    print(f"Normalized {len(df):,} rows")
    print(f"\nColumns: {list(df.columns)}")
    print(f"\nData types:\n{df.dtypes}")
    print(f"\nFirst 5 rows:\n{df.head()}")
    print(f"\nSummary:\n{json.dumps(normalizer.summary(), indent=2, default=str)}")
