from __future__ import annotations

from dataclasses import replace
from pathlib import Path
import sys

import pandas as pd

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.detective import BiasDetective, BiasThresholds
from app.normalizer import DataNormalizer


def _rates(df: pd.DataFrame, thresholds: BiasThresholds) -> dict[str, float]:
    flagged = BiasDetective(df, thresholds=thresholds).detect()
    return {
        "revenge": float(flagged["is_revenge"].mean()),
        "overtrading": float(flagged["is_overtrading"].mean()),
        "loss_aversion": float(flagged["is_loss_aversion"].mean()),
    }


def _score(rates: dict[str, dict[str, float]]) -> tuple[int, float, float, float, float]:
    over_margin = rates["overtrader"]["overtrading"] - max(
        rates["calm_trader"]["overtrading"],
        rates["loss_averse_trader"]["overtrading"],
        rates["revenge_trader"]["overtrading"],
    )
    revenge_margin = rates["revenge_trader"]["revenge"] - max(
        rates["calm_trader"]["revenge"],
        rates["loss_averse_trader"]["revenge"],
        rates["overtrader"]["revenge"],
    )
    loss_margin = rates["loss_averse_trader"]["loss_aversion"] - max(
        rates["calm_trader"]["loss_aversion"],
        rates["overtrader"]["loss_aversion"],
        rates["revenge_trader"]["loss_aversion"],
    )
    violations = int(over_margin <= 0) + int(revenge_margin <= 0) + int(loss_margin <= 0)
    total_margin = over_margin + revenge_margin + loss_margin
    return violations, total_margin, over_margin, revenge_margin, loss_margin


def _fmt(v: float) -> str:
    return f"{v * 100:.2f}%"


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    datasets_dir = root / "trading_datasets"

    datasets = {
        "calm_trader": DataNormalizer(datasets_dir / "calm_trader.csv", dayfirst=False).normalize(),
        "loss_averse_trader": DataNormalizer(
            datasets_dir / "loss_averse_trader.csv", dayfirst=False
        ).normalize(),
        "overtrader": DataNormalizer(datasets_dir / "overtrader.csv", dayfirst=False).normalize(),
        "revenge_trader": DataNormalizer(
            datasets_dir / "revenge_trader.csv", dayfirst=False
        ).normalize(),
    }

    base = BiasThresholds()
    candidates: list[dict[str, object]] = []

    for revenge_window in [2, 5, 10, 15]:
        for revenge_mult in [2.0, 2.5, 3.0, 4.0, 5.0]:
            for loss_mult in [1.5, 2.0, 3.0, 4.0, 6.0, 8.0, 10.0]:
                for over_threshold in [80, 120, 160, 200]:
                    th = replace(
                        base,
                        revenge_time_window_minutes=revenge_window,
                        revenge_size_multiplier=revenge_mult,
                        overtrading_trade_threshold=over_threshold,
                        loss_aversion_duration_multiplier=loss_mult,
                    )
                    rates = {name: _rates(df, th) for name, df in datasets.items()}
                    violations, total_margin, over_margin, revenge_margin, loss_margin = _score(
                        rates
                    )

                    candidates.append(
                        {
                            "thresholds": th,
                            "violations": violations,
                            "total_margin": total_margin,
                            "over_margin": over_margin,
                            "revenge_margin": revenge_margin,
                            "loss_margin": loss_margin,
                            "rates": rates,
                        }
                    )

    best = sorted(candidates, key=lambda c: (c["violations"], -c["total_margin"]))[:10]

    print("Bias Threshold Calibration (Judge CSVs)")
    print("=" * 88)
    print(f"total_candidates={len(candidates)}")
    print("ranking rule: overtrader(overtrading) max, revenge_trader(revenge) max, loss_averse(loss_aversion) max")
    print("")

    for i, row in enumerate(best, start=1):
        th = row["thresholds"]
        rates = row["rates"]
        print(f"candidate #{i}")
        print(
            "thresholds: "
            f"revenge_window={th.revenge_time_window_minutes}m, "
            f"revenge_size_mult={th.revenge_size_multiplier}, "
            f"overtrading_threshold={th.overtrading_trade_threshold}, "
            f"loss_aversion_mult={th.loss_aversion_duration_multiplier}"
        )
        print(
            "margins: "
            f"over={row['over_margin']:.6f}, "
            f"revenge={row['revenge_margin']:.6f}, "
            f"loss_aversion={row['loss_margin']:.6f}, "
            f"violations={row['violations']}"
        )
        print(
            "rates: "
            f"calm(rev={_fmt(rates['calm_trader']['revenge'])}, "
            f"over={_fmt(rates['calm_trader']['overtrading'])}, "
            f"loss={_fmt(rates['calm_trader']['loss_aversion'])}) | "
            f"loss_averse(rev={_fmt(rates['loss_averse_trader']['revenge'])}, "
            f"over={_fmt(rates['loss_averse_trader']['overtrading'])}, "
            f"loss={_fmt(rates['loss_averse_trader']['loss_aversion'])}) | "
            f"overtrader(rev={_fmt(rates['overtrader']['revenge'])}, "
            f"over={_fmt(rates['overtrader']['overtrading'])}, "
            f"loss={_fmt(rates['overtrader']['loss_aversion'])}) | "
            f"revenge_trader(rev={_fmt(rates['revenge_trader']['revenge'])}, "
            f"over={_fmt(rates['revenge_trader']['overtrading'])}, "
            f"loss={_fmt(rates['revenge_trader']['loss_aversion'])})"
        )
        print("-" * 88)


if __name__ == "__main__":
    main()
