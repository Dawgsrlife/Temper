from pathlib import Path

from app.detective import BiasDetective
from app.normalizer import DataNormalizer


def _rates_for_dataset(csv_path: Path) -> dict[str, float]:
    normalized = DataNormalizer(source=csv_path, dayfirst=False).normalize()
    flagged = BiasDetective(normalized).detect()
    return {
        "revenge": float(flagged["is_revenge"].mean()),
        "overtrading": float(flagged["is_overtrading"].mean()),
        "loss_aversion": float(flagged["is_loss_aversion"].mean()),
    }


def test_judge_relative_ordering() -> None:
    root = Path(__file__).resolve().parents[2]
    datasets_dir = root / "trading_datasets"

    rates = {
        "calm_trader": _rates_for_dataset(datasets_dir / "calm_trader.csv"),
        "loss_averse_trader": _rates_for_dataset(datasets_dir / "loss_averse_trader.csv"),
        "overtrader": _rates_for_dataset(datasets_dir / "overtrader.csv"),
        "revenge_trader": _rates_for_dataset(datasets_dir / "revenge_trader.csv"),
    }

    assert rates["overtrader"]["overtrading"] > max(
        rates["calm_trader"]["overtrading"],
        rates["loss_averse_trader"]["overtrading"],
        rates["revenge_trader"]["overtrading"],
    )
    assert rates["revenge_trader"]["revenge"] > max(
        rates["calm_trader"]["revenge"],
        rates["loss_averse_trader"]["revenge"],
        rates["overtrader"]["revenge"],
    )
    assert rates["loss_averse_trader"]["loss_aversion"] > max(
        rates["calm_trader"]["loss_aversion"],
        rates["overtrader"]["loss_aversion"],
        rates["revenge_trader"]["loss_aversion"],
    )
