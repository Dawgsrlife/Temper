from __future__ import annotations

from pathlib import Path
import sys
import os

import pandas as pd

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.counterfactual import CounterfactualEngine
from app.detective import BiasDetective
from app.normalizer import DataNormalizer
from app.risk import recommend_daily_max_loss


def _pnl_stats(series: pd.Series) -> dict[str, float]:
    q = series.quantile([0.01, 0.05, 0.50, 0.95, 0.99])
    return {
        "min": float(series.min()),
        "p1": float(q.loc[0.01]),
        "p5": float(q.loc[0.05]),
        "p50": float(q.loc[0.50]),
        "p95": float(q.loc[0.95]),
        "p99": float(q.loc[0.99]),
        "max": float(series.max()),
    }


def _fmt_float(v: float) -> str:
    return f"{v:.6f}"


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    datasets_dir = root / "trading_datasets"
    files = [
        "calm_trader.csv",
        "loss_averse_trader.csv",
        "overtrader.csv",
        "revenge_trader.csv",
    ]
    daily_max_loss_override = os.getenv("DAILY_MAX_LOSS")
    daily_max_loss_override_value = (
        float(daily_max_loss_override) if daily_max_loss_override else None
    )

    print("Judge Dataset Diagnostics")
    print("=" * 88)

    for name in files:
        path = datasets_dir / name

        normalized = DataNormalizer(source=path, dayfirst=False).normalize()
        flagged = BiasDetective(normalized).detect()
        recommended_daily_max_loss = recommend_daily_max_loss(normalized)
        daily_max_loss = (
            daily_max_loss_override_value
            if daily_max_loss_override_value is not None
            else recommended_daily_max_loss
        )
        simulated, summary = CounterfactualEngine(
            flagged, daily_max_loss=daily_max_loss
        ).run()

        print(f"\n{name}")
        print("-" * 88)

        # 1) PnL summary stats
        stats = _pnl_stats(flagged["pnl"])
        print(
            "pnl_stats: "
            + ", ".join(f"{k}={_fmt_float(v)}" for k, v in stats.items())
        )

        # 2) Trades/day stats
        day = flagged["timestamp"].dt.floor("D")
        trades_per_day = flagged.groupby(day, sort=False).size()
        print(
            "trades_per_day: "
            f"unique_days={int(trades_per_day.shape[0])}, "
            f"median={float(trades_per_day.median()):.2f}, "
            f"max={int(trades_per_day.max())}"
        )

        # 3) Checkmate audit
        sim_day = simulated["timestamp"].dt.floor("D")
        checkmated_days = simulated.groupby(sim_day, sort=False)["checkmated_day"].any()
        checkmated_days = checkmated_days[checkmated_days].index

        breach_candidates = simulated.loc[
            (simulated["checkmated_day"])
            & (~simulated["is_blocked_risk"])
            & (simulated["simulated_daily_pnl"] <= -daily_max_loss),
            ["timestamp", "simulated_daily_pnl"],
        ].copy()
        breach_candidates["day"] = breach_candidates["timestamp"].dt.floor("D")
        first_breach = (
            breach_candidates.sort_values("timestamp")
            .groupby("day", sort=False)
            .head(1)
            .set_index("day")
        )
        blocked_after = simulated.groupby(sim_day, sort=False)["is_blocked_risk"].sum()

        if len(checkmated_days) == 0:
            print("checkmate_audit: none")
        else:
            print(f"checkmate_audit: total_checkmated_days={len(checkmated_days)}")
            rows = []
            for d in checkmated_days:
                if d in first_breach.index:
                    breach_ts = first_breach.loc[d, "timestamp"]
                    breach_pnl = float(first_breach.loc[d, "simulated_daily_pnl"])
                else:
                    breach_ts = pd.NaT
                    breach_pnl = float("nan")
                rows.append(
                    {
                        "day": str(d.date()),
                        "breach_timestamp": str(breach_ts),
                        "simulated_daily_pnl_at_breach": breach_pnl,
                        "number_blocked_after": int(blocked_after.get(d, 0)),
                    }
                )

            full_df = pd.DataFrame(rows)
            print(full_df.to_string(index=False))
            print("checkmate_audit_first_3:")
            print(full_df.head(3).to_string(index=False))

        # 4) Revenge audit samples
        audit = flagged.copy()
        audit["prev_pnl"] = audit["pnl"].shift(1)
        audit["prev_size_usd"] = audit["size_usd"].shift(1)
        prev_size_nonzero = audit["prev_size_usd"].where(audit["prev_size_usd"] != 0)
        audit["size_multiplier"] = audit["size_usd"] / prev_size_nonzero
        audit["minutes_since_prev"] = (
            audit["timestamp"].diff().dt.total_seconds() / 60.0
        )

        sample_cols = [
            "timestamp",
            "asset",
            "pnl",
            "size_usd",
            "prev_pnl",
            "prev_size_usd",
            "size_multiplier",
            "minutes_since_prev",
        ]
        revenge_sample = audit.loc[audit["is_revenge"], sample_cols].head(15)

        print(f"revenge_audit_samples: count={int(audit['is_revenge'].sum())}")
        if revenge_sample.empty:
            print("none")
        else:
            print(revenge_sample.to_string(index=False))

        print(
            "counterfactual_summary: "
            f"actual_total_pnl={_fmt_float(float(summary['actual_total_pnl']))}, "
            f"simulated_total_pnl={_fmt_float(float(summary['simulated_total_pnl']))}, "
            f"delta_pnl={_fmt_float(float(summary['delta_pnl']))}, "
            f"cost_of_bias={_fmt_float(float(summary['cost_of_bias']))}, "
            f"daily_max_loss_recommended={_fmt_float(recommended_daily_max_loss)}, "
            f"daily_max_loss_used={_fmt_float(float(summary['daily_max_loss_used']))}, "
            f"outcome={summary['outcome']}"
        )


if __name__ == "__main__":
    main()
