from __future__ import annotations

from pathlib import Path
import json
import sys

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.counterfactual import CounterfactualEngine
from app.detective import BiasDetective
from app.normalizer import DataNormalizer
from app.review import build_trade_review
from app.risk import recommend_daily_max_loss


def main() -> int:
    root = Path(__file__).resolve().parents[2]
    dataset = (
        Path(sys.argv[1])
        if len(sys.argv) > 1
        else root / "trading_datasets" / "calm_trader.csv"
    )
    if not dataset.is_absolute():
        dataset = root / dataset

    normalized = DataNormalizer(source=dataset, dayfirst=False).normalize()
    flagged = BiasDetective(normalized).detect()
    daily_max_loss = recommend_daily_max_loss(normalized)
    out, summary = CounterfactualEngine(flagged, daily_max_loss=daily_max_loss).run()
    review = build_trade_review(out, summary)

    print(json.dumps(review, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
