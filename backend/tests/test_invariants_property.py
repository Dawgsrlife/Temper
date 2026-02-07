from __future__ import annotations

import numpy as np
import pandas as pd

from app.counterfactual import CounterfactualEngine
from app.detective import BiasDetective


def _synthetic_df(seed: int, rows: int = 600) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    start = pd.Timestamp("2026-01-01 09:30:00")
    offsets = rng.integers(0, 60 * 24 * 8, size=rows)
    timestamps = start + pd.to_timedelta(offsets, unit="m")

    return pd.DataFrame(
        {
            "timestamp": timestamps,
            "asset": rng.choice(["AAPL", "TSLA", "NVDA", "AMZN"], size=rows),
            "side": rng.choice(["Buy", "Sell"], size=rows),
            "price": rng.uniform(20.0, 2000.0, size=rows),
            "size_usd": rng.uniform(100.0, 500000.0, size=rows),
            "pnl": rng.normal(0.0, 700.0, size=rows),
        }
    )


def test_invariants_on_synthetic_property_sets() -> None:
    seeds = [7, 11, 23, 101, 509]
    allowed_reasons = {"NONE", "BIAS", "DAILY_MAX_LOSS"}
    required_outputs = {
        "simulated_pnl",
        "simulated_equity",
        "simulated_daily_pnl",
        "is_blocked_bias",
        "is_blocked_risk",
        "blocked_reason",
        "checkmated_day",
    }

    for seed in seeds:
        base = _synthetic_df(seed=seed)
        flagged = BiasDetective(base).detect()
        out, summary = CounterfactualEngine(flagged).run()

        assert required_outputs.issubset(set(out.columns))
        assert not out[list(required_outputs)].isna().any().any()
        assert set(out["blocked_reason"].unique()).issubset(allowed_reasons)
        assert np.isfinite(out["simulated_equity"]).all()
        assert np.isfinite(out["simulated_pnl"]).all()

        any_checkmated = bool(out["checkmated_day"].any())
        assert (summary["outcome"] == "CHECKMATED") == any_checkmated

        delta = float(summary["delta_pnl"])
        cost = float(summary["cost_of_bias"])
        assert abs(cost - max(0.0, delta)) <= 1e-9
