from __future__ import annotations

from pathlib import Path
import os
import sys

import pandas as pd

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.counterfactual import CounterfactualEngine
from app.detective import BiasDetective
from app.normalizer import DataNormalizer
from app.risk import recommend_daily_max_loss


def _fmt(v: float) -> str:
    return f"{v:.6f}"


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    csv_path = root / "trading_datasets" / "calm_trader.csv"

    daily_max_loss_override = os.getenv("DAILY_MAX_LOSS")
    daily_max_loss_override_value = (
        float(daily_max_loss_override) if daily_max_loss_override else None
    )

    normalized = DataNormalizer(source=csv_path, dayfirst=False).normalize()
    flagged = BiasDetective(normalized).detect()
    recommended_daily_max_loss = recommend_daily_max_loss(normalized)
    daily_max_loss = (
        daily_max_loss_override_value
        if daily_max_loss_override_value is not None
        else recommended_daily_max_loss
    )
    simulated, summary = CounterfactualEngine(flagged, daily_max_loss=daily_max_loss).run()

    print("Calm Regression Audit")
    print("=" * 88)
    print(f"file: {csv_path}")
    print(f"daily_max_loss_recommended: {_fmt(recommended_daily_max_loss)}")
    print(f"daily_max_loss_used: {_fmt(float(summary['daily_max_loss_used']))}")
    print(
        "totals: "
        f"actual={_fmt(float(summary['actual_total_pnl']))}, "
        f"simulated={_fmt(float(summary['simulated_total_pnl']))}, "
        f"delta={_fmt(float(summary['delta_pnl']))}"
    )

    # 1) Bias-block impact
    bias_block = simulated["is_blocked_bias"]
    risk_block = simulated["is_blocked_risk"]
    print("\n1) Blocked-by-bias impact")
    print(
        "count="
        f"{int(bias_block.sum())}, "
        f"sum_pnl={_fmt(float(simulated.loc[bias_block, 'pnl'].sum()))}, "
        f"mean_pnl={_fmt(float(simulated.loc[bias_block, 'pnl'].mean()))}"
    )

    # 2) Risk-block impact
    print("\n2) Blocked-by-risk impact")
    print(
        "count="
        f"{int(risk_block.sum())}, "
        f"sum_pnl={_fmt(float(simulated.loc[risk_block, 'pnl'].sum()))}, "
        f"mean_pnl={_fmt(float(simulated.loc[risk_block, 'pnl'].mean()))}"
    )

    # 3) Actual vs simulated daily deterioration
    day = simulated["timestamp"].dt.floor("D")
    daily = pd.DataFrame(
        {
            "actual_daily_pnl": simulated.groupby(day, sort=False)["pnl"].sum(),
            "simulated_daily_pnl": simulated.groupby(day, sort=False)["simulated_pnl"].sum(),
        }
    )
    daily["deterioration_actual_minus_simulated"] = (
        daily["actual_daily_pnl"] - daily["simulated_daily_pnl"]
    )
    worst_days = daily.sort_values(
        "deterioration_actual_minus_simulated", ascending=False
    ).head(5)

    print("\n3) Top 5 deterioration days (actual - simulated)")
    print(worst_days.to_string())

    # 4) Per-day breach + blocked-after-breach detail
    print("\n4) Breach-day details")
    detailed_rows = []
    for d in worst_days.index:
        day_mask = day == d
        day_df = simulated.loc[day_mask].copy()

        breach_candidates = day_df.loc[
            (day_df["simulated_daily_pnl"] <= -daily_max_loss)
            & (~day_df["is_blocked_risk"])
            & (day_df["simulated_pnl"] != 0)
        ]
        breach_timestamp = (
            str(breach_candidates["timestamp"].iloc[0])
            if not breach_candidates.empty
            else "None"
        )

        blocked_after = day_df.loc[day_df["is_blocked_risk"]]
        detailed_rows.append(
            {
                "day": str(d.date()),
                "breach_timestamp": breach_timestamp,
                "count_blocked_after": int(blocked_after.shape[0]),
                "sum_pnl_blocked_after": float(blocked_after["pnl"].sum()),
            }
        )

        print(
            f"\nDay {d.date()} | breach={breach_timestamp} | "
            f"blocked_after={int(blocked_after.shape[0])} | "
            f"sum_blocked_after_pnl={_fmt(float(blocked_after['pnl'].sum()))}"
        )
        if blocked_after.empty:
            print("No blocked-after-breach trades.")
        else:
            top10 = blocked_after.nlargest(10, "pnl")[
                ["timestamp", "asset", "pnl", "simulated_daily_pnl", "blocked_reason"]
            ]
            print("Top 10 blocked-after-breach trades by pnl:")
            print(top10.to_string(index=False))

    print("\nBreach detail summary")
    print(pd.DataFrame(detailed_rows).to_string(index=False))

    # 5) Revenge false-positive audit
    print("\n5) Revenge-flag diagnostics")
    audit = simulated.copy()
    audit["prev_pnl"] = audit["pnl"].shift(1)
    audit["prev_size_usd"] = audit["size_usd"].shift(1)
    valid_prev_size = audit["prev_size_usd"].where(audit["prev_size_usd"] > 0)
    audit["size_multiplier"] = audit["size_usd"] / valid_prev_size
    audit["minutes_since_prev"] = (
        audit["timestamp"].diff().dt.total_seconds() / 60.0
    )

    revenge = audit.loc[audit["is_revenge"]].copy()
    suspicious = revenge["prev_size_usd"].isna() | revenge["prev_size_usd"].le(0)
    print(
        "revenge_count="
        f"{int(revenge.shape[0])}, "
        f"suspicious_prev_size_count={int(suspicious.sum())}"
    )
    if not revenge.empty:
        dist = revenge[
            ["minutes_since_prev", "size_multiplier", "prev_pnl"]
        ].describe(percentiles=[0.05, 0.25, 0.5, 0.75, 0.95])
        print("revenge_distribution:")
        print(dist.to_string())
        print("\nSample suspicious revenge rows:")
        cols = [
            "timestamp",
            "asset",
            "pnl",
            "size_usd",
            "prev_pnl",
            "prev_size_usd",
            "size_multiplier",
            "minutes_since_prev",
        ]
        print(revenge.loc[suspicious, cols].head(15).to_string(index=False))


if __name__ == "__main__":
    main()
