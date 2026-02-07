from pathlib import Path

from app.counterfactual import CounterfactualEngine
from app.detective import BiasDetective
from app.normalizer import DataNormalizer
from app.risk import recommend_daily_max_loss


def _run(csv_name: str) -> tuple[dict[str, float | int | str], float]:
    root = Path(__file__).resolve().parents[2]
    path = root / "trading_datasets" / csv_name
    normalized = DataNormalizer(source=path, dayfirst=False).normalize()
    flagged = BiasDetective(normalized).detect()
    daily_max_loss = recommend_daily_max_loss(normalized)
    _, summary = CounterfactualEngine(flagged, daily_max_loss=daily_max_loss).run()
    return summary, float(flagged["is_overtrading"].mean())


def test_judge_outcome_sanity() -> None:
    calm_summary, calm_overtrading_rate = _run("calm_trader.csv")
    revenge_summary, _ = _run("revenge_trader.csv")
    over_summary, over_overtrading_rate = _run("overtrader.csv")

    assert calm_summary["outcome"] != "CHECKMATED"
    calm_actual = float(calm_summary["actual_total_pnl"])
    calm_delta = float(calm_summary["delta_pnl"])
    assert calm_delta >= -(abs(calm_actual) * 2.0)

    assert float(revenge_summary["delta_pnl"]) > 0
    assert over_overtrading_rate > 0.90

    # Keep calm overtrading low as a safety anchor.
    assert calm_overtrading_rate < 0.10
