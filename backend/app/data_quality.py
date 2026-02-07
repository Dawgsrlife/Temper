"""
Temper – Data Quality Checks

Deterministic quality metrics for uploaded trade datasets.
"""

from __future__ import annotations

from typing import Any

import pandas as pd


TIMESTAMP_CANDIDATES = ("timestamp", "Timestamp IST", "time", "date", "datetime")
ASSET_CANDIDATES = ("asset", "symbol", "ticker", "Coin")
PRICE_CANDIDATES = ("price", "entry_price", "Execution Price", "exit_price")
SIZE_CANDIDATES = ("size_usd", "Size USD", "quantity", "qty", "size", "shares")
PNL_CANDIDATES = ("pnl", "profit_loss", "Closed PnL", "P/L", "realized_pnl")


def _first_present(df: pd.DataFrame, candidates: tuple[str, ...]) -> str | None:
    for col in candidates:
        if col in df.columns:
            return col
    return None


def _non_empty_string_mask(series: pd.Series) -> pd.Series:
    return series.notna() & series.astype(str).str.strip().ne("")


def evaluate_data_quality(
    raw_df: pd.DataFrame,
    *,
    dayfirst: bool = False,
) -> dict[str, Any]:
    rows = int(len(raw_df))
    if rows == 0:
        return {
            "rows": 0,
            "columns": [],
            "metrics": {},
            "warnings": ["Dataset is empty."],
            "quality_flags": {"has_warnings": True},
        }

    timestamp_col = _first_present(raw_df, TIMESTAMP_CANDIDATES)
    asset_col = _first_present(raw_df, ASSET_CANDIDATES)
    price_col = _first_present(raw_df, PRICE_CANDIDATES)
    size_col = _first_present(raw_df, SIZE_CANDIDATES)
    pnl_col = _first_present(raw_df, PNL_CANDIDATES)

    if timestamp_col is None:
        ts = pd.Series([pd.NaT] * rows)
    else:
        ts = pd.to_datetime(raw_df[timestamp_col], dayfirst=dayfirst, errors="coerce")
    nat_timestamps = int(ts.isna().sum())
    duplicate_timestamps = int(ts.duplicated(keep="first").sum())
    ts_non_na = ts.dropna()
    out_of_order_rows = int((ts_non_na.diff().dt.total_seconds() < 0).sum())

    if asset_col is None:
        missing_asset = rows
    else:
        missing_asset = int((~_non_empty_string_mask(raw_df[asset_col])).sum())

    if price_col is None:
        nonpositive_price = rows
    else:
        price_num = pd.to_numeric(raw_df[price_col], errors="coerce")
        nonpositive_price = int((price_num <= 0).fillna(False).sum())

    if size_col is None:
        nonpositive_size = rows
    else:
        size_num = pd.to_numeric(raw_df[size_col], errors="coerce")
        nonpositive_size = int((size_num <= 0).fillna(False).sum())

    if pnl_col is None:
        pnl_coercions = rows
    else:
        pnl_raw = raw_df[pnl_col]
        pnl_num = pd.to_numeric(pnl_raw, errors="coerce")
        pnl_coercions = int((_non_empty_string_mask(pnl_raw) & pnl_num.isna()).sum())

    metrics = {
        "rows": rows,
        "missing_asset_count": missing_asset,
        "missing_asset_pct": (missing_asset / rows) * 100.0,
        "nonpositive_price_count": nonpositive_price,
        "nonpositive_price_pct": (nonpositive_price / rows) * 100.0,
        "nonpositive_size_usd_count": nonpositive_size,
        "nonpositive_size_usd_pct": (nonpositive_size / rows) * 100.0,
        "nat_timestamp_count": nat_timestamps,
        "nat_timestamp_pct": (nat_timestamps / rows) * 100.0,
        "duplicate_timestamp_count": duplicate_timestamps,
        "duplicate_timestamp_pct": (duplicate_timestamps / rows) * 100.0,
        "out_of_order_rows_count": out_of_order_rows,
        "out_of_order_rows_pct": (out_of_order_rows / rows) * 100.0,
        "pnl_non_numeric_coercions_count": pnl_coercions,
        "pnl_non_numeric_coercions_pct": (pnl_coercions / rows) * 100.0,
    }

    warnings: list[str] = []
    if metrics["missing_asset_count"] > 0:
        warnings.append(
            f"{metrics['missing_asset_pct']:.2f}% rows have missing/empty asset."
        )
    if metrics["nonpositive_price_count"] > 0:
        warnings.append(
            f"{metrics['nonpositive_price_pct']:.2f}% rows have nonpositive price."
        )
    if metrics["nonpositive_size_usd_count"] > 0:
        warnings.append(
            f"{metrics['nonpositive_size_usd_pct']:.2f}% rows have nonpositive size."
        )
    if metrics["nat_timestamp_count"] > 0:
        warnings.append(
            f"{metrics['nat_timestamp_pct']:.2f}% rows have invalid timestamps."
        )
    if metrics["duplicate_timestamp_count"] > 0:
        warnings.append(
            f"{metrics['duplicate_timestamp_pct']:.2f}% rows have duplicate timestamps."
        )
    if metrics["out_of_order_rows_count"] > 0:
        warnings.append(
            f"{metrics['out_of_order_rows_pct']:.2f}% rows are out of timestamp order."
        )
    if metrics["pnl_non_numeric_coercions_count"] > 0:
        warnings.append(
            f"{metrics['pnl_non_numeric_coercions_pct']:.2f}% rows have non-numeric pnl values."
        )

    return {
        "rows": rows,
        "columns": list(raw_df.columns),
        "source_columns": {
            "timestamp": timestamp_col,
            "asset": asset_col,
            "price": price_col,
            "size": size_col,
            "pnl": pnl_col,
        },
        "metrics": metrics,
        "warnings": warnings,
        "quality_flags": {"has_warnings": bool(warnings)},
    }
