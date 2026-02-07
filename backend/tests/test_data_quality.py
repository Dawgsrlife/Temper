from __future__ import annotations

import pandas as pd

from app.data_quality import evaluate_data_quality


def test_data_quality_metrics_smoke() -> None:
    df = pd.DataFrame(
        {
            "timestamp": [
                "2026-01-01 09:31:00",
                "not-a-date",
                "2026-01-01 09:30:00",
                "2026-01-01 09:30:00",
            ],
            "asset": ["AAPL", "", None, "TSLA"],
            "entry_price": [100.0, 0.0, -5.0, 200.0],
            "quantity": [1.0, 0.0, -2.0, 3.0],
            "profit_loss": ["10", "oops", "-5.5", "20"],
        }
    )

    quality = evaluate_data_quality(df, dayfirst=False)
    metrics = quality["metrics"]

    assert metrics["missing_asset_count"] == 2
    assert metrics["nonpositive_price_count"] == 2
    assert metrics["nonpositive_size_usd_count"] == 2
    assert metrics["nat_timestamp_count"] == 1
    assert metrics["duplicate_timestamp_count"] >= 1
    assert metrics["out_of_order_rows_count"] >= 1
    assert metrics["pnl_non_numeric_coercions_count"] == 1
    assert len(quality["warnings"]) >= 1
