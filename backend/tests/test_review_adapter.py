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
    assert {
        "headline",
        "scoreboard",
        "bias_rates",
        "derived_stats",
        "labeling_rules",
        "badge_counts",
        "badge_examples",
        "grade_distribution_by_phase",
        "opening",
        "middlegame",
        "endgame",
        "coach_plan",
        "data_quality_warnings",
        "top_moments",
        "recommendations",
    } <= set(review_a.keys())
    assert review_a["headline"] == summary["outcome"]
    assert review_a["scoreboard"]["delta_pnl"] == summary["delta_pnl"]
    assert review_a["scoreboard"]["cost_of_bias"] == summary["cost_of_bias"]

    valid_labels = {
        "BRILLIANT",
        "GREAT",
        "BEST",
        "EXCELLENT",
        "GOOD",
        "INACCURACY",
        "MISTAKE",
        "MISS",
        "BLUNDER",
        "MEGABLUNDER",
    }
    for moment in review_a["top_moments"]:
        assert moment["label"] in valid_labels
        assert "critical_line" in moment
        assert len(moment["critical_line"]) <= 7
        assert any(row["is_focus"] for row in moment["critical_line"])

    assert "grade_rules" in review_a["labeling_rules"]
    assert "MEGABLUNDER" in review_a["labeling_rules"]["grade_rules"]
    assert "BLUNDER" in review_a["labeling_rules"]["grade_rules"]
    assert "INACCURACY" in review_a["labeling_rules"]["grade_rules"]
    assert len(review_a["coach_plan"]) == 3
    assert isinstance(review_a["opening"], dict)
    assert isinstance(review_a["middlegame"], dict)
    assert isinstance(review_a["endgame"], dict)
    assert set(review_a["badge_examples"].keys()) == {"MEGABLUNDER", "BLUNDER", "MISS"}


def test_review_recommendations_are_data_derived() -> None:
    root = Path(__file__).resolve().parents[2]
    csv_path = root / "trading_datasets" / "calm_trader.csv"

    normalized = DataNormalizer(source=csv_path, dayfirst=False).normalize()
    flagged = BiasDetective(normalized).detect()
    daily_max_loss = recommend_daily_max_loss(normalized)
    out, summary = CounterfactualEngine(flagged, daily_max_loss=daily_max_loss).run()
    review = build_trade_review(out, summary)

    assert len(review["recommendations"]) > 0
    any_bias_pct = review["derived_stats"]["any_bias_rate_pct"]
    expected_fragment = f"{any_bias_pct:.2f}%"
    assert any(expected_fragment in rec for rec in review["recommendations"])


def test_review_includes_labeling_rules_and_sections() -> None:
    root = Path(__file__).resolve().parents[2]
    csv_path = root / "trading_datasets" / "revenge_trader.csv"

    normalized = DataNormalizer(source=csv_path, dayfirst=False).normalize()
    flagged = BiasDetective(normalized).detect()
    daily_max_loss = recommend_daily_max_loss(normalized)
    out, summary = CounterfactualEngine(flagged, daily_max_loss=daily_max_loss).run()

    review = build_trade_review(out, summary, data_quality_warnings=["sample warning"])
    rules = review["labeling_rules"]
    assert "impact_definition" in rules
    assert "MEGABLUNDER" in rules["grade_rules"]
    assert "BLUNDER" in rules["grade_rules"]
    assert "summary" in review["opening"]
    assert "summary" in review["middlegame"]
    assert "summary" in review["endgame"]
    assert review["data_quality_warnings"] == ["sample warning"]
