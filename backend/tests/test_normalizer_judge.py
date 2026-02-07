from pathlib import Path

import pandas as pd

from app.normalizer import DataNormalizer


def test_judge_csvs_normalize_to_canonical_schema_and_types() -> None:
    root = Path(__file__).resolve().parents[2]
    datasets_dir = root / "trading_datasets"
    names = [
        "calm_trader.csv",
        "loss_averse_trader.csv",
        "overtrader.csv",
        "revenge_trader.csv",
    ]

    expected_columns = ["timestamp", "asset", "price", "size_usd", "side", "pnl"]

    for name in names:
        df = DataNormalizer(source=datasets_dir / name, dayfirst=False).normalize()

        assert list(df.columns) == expected_columns
        assert pd.api.types.is_datetime64_any_dtype(df["timestamp"])
        assert pd.api.types.is_float_dtype(df["price"])
        assert pd.api.types.is_float_dtype(df["size_usd"])
        assert pd.api.types.is_float_dtype(df["pnl"])
        assert pd.api.types.is_string_dtype(df["asset"]) or df["asset"].dtype == "object"
        assert pd.api.types.is_string_dtype(df["side"]) or df["side"].dtype == "object"

        assert not df["timestamp"].isna().any()
        assert not df["pnl"].isna().any()
