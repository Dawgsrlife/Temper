from __future__ import annotations

from pathlib import Path

from app.counterfactual import CounterfactualEngine
from app.detective import BiasDetective
from app.normalizer import DataNormalizer
from app.review import build_trade_review
from app.risk import recommend_daily_max_loss


def test_review_adapter_contract_and_determinism() -> None:
    root = Path(__file__).resolve().parents[2]
    csv_path = root / "trading_datasets" / "calm_trader.csv"

    normalized = DataNormalizer(source=csv_path, dayfirst=False).normalize()
    flagged = BiasDetective(normalized).detect()
    daily_max_loss = recommend_daily_max_loss(normalized)
    out, summary = CounterfactualEngine(flagged, daily_max_loss=daily_max_loss).run()

    review_a = build_trade_review(out, summary)
    review_b = build_trade_review(out, summary)

    assert review_a == review_b
    assert {"headline", "scoreboard", "bias_rates", "top_moments", "recommendations"} <= set(
        review_a.keys()
    )
    assert review_a["headline"] == summary["outcome"]
    assert review_a["scoreboard"]["delta_pnl"] == summary["delta_pnl"]
    assert review_a["scoreboard"]["cost_of_bias"] == summary["cost_of_bias"]

    valid_labels = {"MEGA_BLUNDER", "BLUNDER", "INACCURACY"}
    for moment in review_a["top_moments"]:
        assert moment["label"] in valid_labels
