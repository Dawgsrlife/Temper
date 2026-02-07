from __future__ import annotations

import re
import tempfile
import warnings

import pandas as pd

from app.normalizer import DataNormalizer


def test_missing_canonical_columns_raise_after_transform() -> None:
    with tempfile.TemporaryDirectory() as tmp_dir:
        csv_path = f"{tmp_dir}/missing_pnl.csv"
        pd.DataFrame(
            {
                "ts": ["2025-01-01T00:00:00", "2025-01-01T00:01:00"],
                "asset_name": ["BTC", "ETH"],
                "entry": [100.0, 200.0],
                "qty": [1.0, 2.0],
                "direction": ["buy", "sell"],
            }
        ).to_csv(csv_path, index=False)

        mapping = {
            "ts": "timestamp",
            "asset_name": "asset",
            "entry": "price",
            "qty": "size_qty_proxy",
            "direction": "side",
        }

        try:
            DataNormalizer(source=csv_path, column_mapping=mapping, dayfirst=False).normalize()
            assert False, "Expected normalization to fail when canonical pnl is missing."
        except ValueError as exc:
            assert re.search(r"missing canonical columns \['pnl'\]", str(exc))


def test_residual_nat_timestamps_emit_warning_and_continue() -> None:
    with tempfile.TemporaryDirectory() as tmp_dir:
        csv_path = f"{tmp_dir}/residual_nat.csv"
        rows = []
        for i in range(40):
            rows.append(
                {
                    "timestamp": f"2025-01-01 00:{i:02d}:00",
                    "asset": "BTC",
                    "price": 100.0 + i,
                    "size_usd": 1000.0,
                    "side": "buy",
                    "pnl": float(i),
                }
            )
        rows[3]["timestamp"] = "not-a-date"
        pd.DataFrame(rows).to_csv(csv_path, index=False)

        normalizer = DataNormalizer(source=csv_path, dayfirst=False)
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            out = normalizer.normalize()

        assert len(out) == 40
        assert out["timestamp"].isna().sum() == 1
        assert any(
            issubclass(item.category, RuntimeWarning)
            and "Some timestamps could not be parsed" in str(item.message)
            for item in caught
        )
        assert any(w["code"] == "residual_nat_timestamps" for w in normalizer.warnings)


def test_ambiguous_preset_match_emits_warning_and_uses_deterministic_precedence() -> None:
    with tempfile.TemporaryDirectory() as tmp_dir:
        csv_path = f"{tmp_dir}/ambiguous.csv"
        pd.DataFrame(
            {
                # Hyperliquid signature
                "Timestamp IST": ["2025-01-01 00:00:00", "2025-01-01 00:01:00"],
                "Coin": ["BTC", "ETH"],
                "Execution Price": [100.0, 200.0],
                "Size USD": [1000.0, 2000.0],
                "Side": ["buy", "sell"],
                "Closed PnL": [10.0, -5.0],
                # Judge signature (also present, making preset detection ambiguous)
                "timestamp": ["2025-01-02 00:00:00", "2025-01-02 00:01:00"],
                "asset": ["X", "Y"],
                "entry_price": [1.0, 2.0],
                "quantity": [1.0, 1.0],
                "side": ["buy", "sell"],
                "profit_loss": [1.0, -1.0],
            }
        ).to_csv(csv_path, index=False)

        normalizer = DataNormalizer(source=csv_path, dayfirst=False)
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            mapping = normalizer._resolve_column_mapping(normalizer._load_raw())

        assert mapping == {
            "Timestamp IST": "timestamp",
            "Coin": "asset",
            "Execution Price": "price",
            "Size USD": "size_usd",
            "Side": "side",
            "Closed PnL": "pnl",
        }
        assert any(
            issubclass(item.category, RuntimeWarning)
            and "Multiple schema presets matched" in str(item.message)
            for item in caught
        )
        assert any(w["code"] == "ambiguous_preset_match" for w in normalizer.warnings)
