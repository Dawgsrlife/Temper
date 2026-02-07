from __future__ import annotations

from pathlib import Path
import sys

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.counterfactual import CounterfactualEngine
from app.detective import BiasDetective
from app.normalizer import DataNormalizer
from app.risk import recommend_daily_max_loss


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    datasets_dir = root / "trading_datasets"
    files = [
        "calm_trader.csv",
        "loss_averse_trader.csv",
        "overtrader.csv",
        "revenge_trader.csv",
    ]

    print("Recommended Daily Max Loss")
    print("=" * 88)

    for name in files:
        normalized = DataNormalizer(datasets_dir / name, dayfirst=False).normalize()
        flagged = BiasDetective(normalized).detect()
        recommended = recommend_daily_max_loss(normalized)
        simulated, summary = CounterfactualEngine(flagged, daily_max_loss=recommended).run()

        day = simulated["timestamp"].dt.floor("D")
        checkmated_days = int(simulated.groupby(day, sort=False)["checkmated_day"].any().sum())
        total_days = int(simulated["timestamp"].dt.floor("D").nunique())

        print(f"\n{name}")
        print(f"recommended_daily_max_loss: {recommended:.6f}")
        print(f"checkmated_days: {checkmated_days}/{total_days}")
        print(
            "pnl: "
            f"actual={summary['actual_total_pnl']:.6f}, "
            f"simulated={summary['simulated_total_pnl']:.6f}, "
            f"delta={summary['delta_pnl']:.6f}"
        )


if __name__ == "__main__":
    main()
