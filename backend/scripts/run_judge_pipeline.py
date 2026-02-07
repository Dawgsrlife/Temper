from __future__ import annotations

from pathlib import Path
import sys

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.counterfactual import CounterfactualEngine
from app.detective import BiasDetective
from app.normalizer import DataNormalizer


def pct(value: float) -> str:
    return f"{value * 100:.2f}%"


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    datasets_dir = root / "trading_datasets"
    files = [
        "calm_trader.csv",
        "loss_averse_trader.csv",
        "overtrader.csv",
        "revenge_trader.csv",
    ]

    print("Judge CSV Pipeline Metrics")
    print("=" * 72)

    for name in files:
        path = datasets_dir / name

        normalized = DataNormalizer(source=path, dayfirst=False).normalize()
        flagged = BiasDetective(normalized).detect()
        simulated, summary = CounterfactualEngine(flagged, daily_max_loss=1000.0).run()

        any_bias = (
            flagged["is_revenge"] | flagged["is_overtrading"] | flagged["is_loss_aversion"]
        )
        checkmated_days = int(
            simulated.groupby(simulated["timestamp"].dt.floor("D"), sort=False)[
                "checkmated_day"
            ].any().sum()
        )

        print(f"\n{name}")
        print(f"rows: {len(simulated)}")
        print(
            "bias_rates: "
            f"revenge={pct(float(flagged['is_revenge'].mean()))}, "
            f"overtrading={pct(float(flagged['is_overtrading'].mean()))}, "
            f"loss_aversion={pct(float(flagged['is_loss_aversion'].mean()))}, "
            f"any={pct(float(any_bias.mean()))}"
        )
        print(
            "pnl: "
            f"actual={summary['actual_total_pnl']:.6f}, "
            f"simulated={summary['simulated_total_pnl']:.6f}, "
            f"delta={summary['delta_pnl']:.6f}, "
            f"cost_of_bias={summary['cost_of_bias']:.6f}"
        )
        print(f"checkmated_days: {checkmated_days}")
        print(f"outcome: {summary['outcome']}")


if __name__ == "__main__":
    main()
