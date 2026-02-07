from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
import os
import subprocess
import sys

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.counterfactual import CounterfactualEngine
from app.detective import BiasDetective, BiasThresholds
from app.normalizer import DataNormalizer
from app.risk import (
    DEFAULT_BALANCE_BASE_FRACTION,
    DEFAULT_BALANCE_CAP_FRACTION,
    DEFAULT_DAY_TOTAL_BASE_QUANTILE,
    DEFAULT_INTRADAY_BASE_QUANTILE,
    DEFAULT_INTRADAY_CAP_MULTIPLIER,
    DEFAULT_MIN_DAILY_MAX_LOSS,
    DEFAULT_SAFETY_BUFFER,
    recommend_daily_max_loss,
)


def _git_commit_and_dirty(root: Path) -> tuple[str, str]:
    commit = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    dirty_output = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    dirty_state = "DIRTY" if dirty_output else "CLEAN"
    return commit, dirty_state


def _pct(value: float) -> str:
    return f"{value * 100:.2f}%"


def main() -> int:
    root = Path(__file__).resolve().parents[2]
    datasets_dir = root / "trading_datasets"
    names = [
        "calm_trader.csv",
        "loss_averse_trader.csv",
        "overtrader.csv",
        "revenge_trader.csv",
    ]

    commit, dirty_state = _git_commit_and_dirty(root)
    thresholds = asdict(BiasThresholds())
    daily_max_loss_override = os.getenv("DAILY_MAX_LOSS")
    daily_max_loss_override_value = (
        float(daily_max_loss_override) if daily_max_loss_override else None
    )

    metrics: dict[str, dict[str, float | int | str]] = {}

    print("Temper Policy Report")
    print("=" * 80)
    print(f"git_commit: {commit}")
    print(f"git_state: {dirty_state}")

    print("\nBiasThresholds:")
    for key, value in thresholds.items():
        print(f"  {key}: {value}")

    print("\nRisk Recommender Parameters:")
    print(f"  min_daily_max_loss: {DEFAULT_MIN_DAILY_MAX_LOSS}")
    print(f"  safety_buffer: {DEFAULT_SAFETY_BUFFER}")
    print(f"  day_total_base_quantile: {DEFAULT_DAY_TOTAL_BASE_QUANTILE}")
    print(f"  intraday_base_quantile: {DEFAULT_INTRADAY_BASE_QUANTILE}")
    print(f"  balance_base_fraction: {DEFAULT_BALANCE_BASE_FRACTION}")
    print(f"  balance_cap_fraction: {DEFAULT_BALANCE_CAP_FRACTION}")
    print(f"  intraday_cap_multiplier: {DEFAULT_INTRADAY_CAP_MULTIPLIER}")

    for name in names:
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
            flagged,
            daily_max_loss=daily_max_loss,
        ).run()

        any_bias = (
            flagged["is_revenge"] | flagged["is_overtrading"] | flagged["is_loss_aversion"]
        )
        checkmated_days = int(
            simulated.groupby(simulated["timestamp"].dt.floor("D"), sort=False)[
                "checkmated_day"
            ].any().sum()
        )

        metrics[name] = {
            "rows": int(len(simulated)),
            "revenge_rate": float(flagged["is_revenge"].mean()),
            "overtrading_rate": float(flagged["is_overtrading"].mean()),
            "loss_aversion_rate": float(flagged["is_loss_aversion"].mean()),
            "any_bias_rate": float(any_bias.mean()),
            "recommended_daily_max_loss": float(recommended_daily_max_loss),
            "used_daily_max_loss": float(summary["daily_max_loss_used"]),
            "blocked_bias_count": int(summary["blocked_bias_count"]),
            "blocked_risk_count": int(summary["blocked_risk_count"]),
            "checkmated_days": checkmated_days,
            "actual_total_pnl": float(summary["actual_total_pnl"]),
            "simulated_total_pnl": float(summary["simulated_total_pnl"]),
            "delta_pnl": float(summary["delta_pnl"]),
            "cost_of_bias": float(summary["cost_of_bias"]),
            "outcome": str(summary["outcome"]),
        }

    print("\nJudge Dataset Metrics:")
    for name in names:
        m = metrics[name]
        print(f"\n{name}")
        print(f"  rows: {m['rows']}")
        print(
            "  bias_rates: "
            f"revenge={_pct(float(m['revenge_rate']))}, "
            f"overtrading={_pct(float(m['overtrading_rate']))}, "
            f"loss_aversion={_pct(float(m['loss_aversion_rate']))}, "
            f"any={_pct(float(m['any_bias_rate']))}"
        )
        print(
            "  daily_max_loss: "
            f"recommended={float(m['recommended_daily_max_loss']):.6f}, "
            f"used={float(m['used_daily_max_loss']):.6f}"
        )
        print(
            "  blocked_counts: "
            f"bias={m['blocked_bias_count']}, risk={m['blocked_risk_count']}"
        )
        print(f"  checkmated_days: {m['checkmated_days']}")
        print(
            "  pnl: "
            f"actual={float(m['actual_total_pnl']):.6f}, "
            f"simulated={float(m['simulated_total_pnl']):.6f}, "
            f"delta={float(m['delta_pnl']):.6f}, "
            f"cost_of_bias={float(m['cost_of_bias']):.6f}"
        )
        print(f"  outcome: {m['outcome']}")

    calm = metrics["calm_trader.csv"]
    loss_averse = metrics["loss_averse_trader.csv"]
    overtrader = metrics["overtrader.csv"]
    revenge = metrics["revenge_trader.csv"]

    sanity_checks = {
        "calm_not_checkmated": int(calm["checkmated_days"]) == 0,
        "overtrader_highest_overtrading": float(overtrader["overtrading_rate"]) > max(
            float(calm["overtrading_rate"]),
            float(loss_averse["overtrading_rate"]),
            float(revenge["overtrading_rate"]),
        ),
        "revenge_trader_highest_revenge": float(revenge["revenge_rate"]) > max(
            float(calm["revenge_rate"]),
            float(loss_averse["revenge_rate"]),
            float(overtrader["revenge_rate"]),
        ),
        "loss_averse_highest_loss_aversion": float(loss_averse["loss_aversion_rate"])
        > max(
            float(calm["loss_aversion_rate"]),
            float(overtrader["loss_aversion_rate"]),
            float(revenge["loss_aversion_rate"]),
        ),
    }

    print("\nSanity Summary:")
    failed = []
    for check_name, passed in sanity_checks.items():
        status = "PASS" if passed else "FAIL"
        print(f"  {check_name}: {status}")
        if not passed:
            failed.append(check_name)

    if failed:
        print("\nResult: FAIL")
        print("Failed checks: " + ", ".join(failed))
        return 1

    print("\nResult: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
