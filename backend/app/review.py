"""
Temper – Review Adapter

Converts pipeline outputs into a chess-style, user-facing review payload.
The payload is dict-based and deterministic for easy API serialization.
"""

from __future__ import annotations

import pandas as pd


def build_trade_review(
    df: pd.DataFrame,
    summary: dict[str, float | int | str],
    *,
    top_n: int = 3,
) -> dict[str, object]:
    """
    Build a chess-style review payload from counterfactual output.

    Expected columns in `df`:
    - timestamp, asset, pnl, simulated_pnl
    - is_revenge, is_overtrading, is_loss_aversion
    - is_blocked_bias, is_blocked_risk, blocked_reason
    """
    required = {
        "timestamp",
        "asset",
        "pnl",
        "simulated_pnl",
        "is_revenge",
        "is_overtrading",
        "is_loss_aversion",
        "is_blocked_bias",
        "is_blocked_risk",
        "blocked_reason",
    }
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"DataFrame missing required columns: {missing}")

    working = df.copy()
    working["counterfactual_impact"] = working["simulated_pnl"] - working["pnl"]

    positive_impacts = working.loc[working["counterfactual_impact"] > 0, "counterfactual_impact"]
    mega_cutoff = float(positive_impacts.quantile(0.9)) if not positive_impacts.empty else 0.0
    blunder_cutoff = float(positive_impacts.quantile(0.6)) if not positive_impacts.empty else 0.0

    blocked = working[working["blocked_reason"] != "NONE"].copy()
    blocked = blocked.sort_values("counterfactual_impact", ascending=False)

    top_rows = blocked.head(top_n).copy()
    top_rows["label"] = "INACCURACY"
    top_rows.loc[
        (top_rows["counterfactual_impact"] >= blunder_cutoff)
        & (top_rows["counterfactual_impact"] > 0),
        "label",
    ] = "BLUNDER"
    top_rows.loc[
        (top_rows["counterfactual_impact"] >= mega_cutoff)
        & (top_rows["counterfactual_impact"] > 0),
        "label",
    ] = "MEGA_BLUNDER"
    top_rows["timestamp"] = pd.to_datetime(top_rows["timestamp"]).dt.strftime(
        "%Y-%m-%dT%H:%M:%S"
    )

    top_rows["bias_tags"] = (
        "revenge="
        + top_rows["is_revenge"].astype(str).str.lower()
        + ",overtrading="
        + top_rows["is_overtrading"].astype(str).str.lower()
        + ",loss_aversion="
        + top_rows["is_loss_aversion"].astype(str).str.lower()
    )

    top_moments = top_rows[
        [
            "timestamp",
            "asset",
            "label",
            "blocked_reason",
            "pnl",
            "simulated_pnl",
            "counterfactual_impact",
            "bias_tags",
        ]
    ].rename(
        columns={
            "pnl": "actual_pnl",
            "counterfactual_impact": "impact",
        }
    ).to_dict(orient="records")

    rates = {
        "revenge_rate": float(working["is_revenge"].mean()),
        "overtrading_rate": float(working["is_overtrading"].mean()),
        "loss_aversion_rate": float(working["is_loss_aversion"].mean()),
        "any_bias_rate": float(
            (
                working["is_revenge"]
                | working["is_overtrading"]
                | working["is_loss_aversion"]
            ).mean()
        ),
    }

    recommendations: list[str] = []
    if rates["overtrading_rate"] > 0.10:
        recommendations.append(
            "Set a per-hour trade cap based on your 80th percentile hourly volume."
        )
    if rates["revenge_rate"] > 0.01:
        recommendations.append(
            "Add a cooldown after large losses before taking the next position."
        )
    if rates["loss_aversion_rate"] > 0.05:
        recommendations.append(
            "Standardize take-profit/stop-loss sizing to reduce win/loss asymmetry."
        )
    if int(summary.get("blocked_risk_count", 0)) > 0:
        recommendations.append(
            "Lower risk when intraday drawdown approaches your daily max-loss limit."
        )
    if not recommendations:
        recommendations.append("Discipline is stable; maintain your current risk routine.")

    return {
        "headline": str(summary.get("outcome", "DRAW")),
        "scoreboard": {
            "delta_pnl": float(summary.get("delta_pnl", 0.0)),
            "cost_of_bias": float(summary.get("cost_of_bias", 0.0)),
            "blocked_bias_count": int(summary.get("blocked_bias_count", 0)),
            "blocked_risk_count": int(summary.get("blocked_risk_count", 0)),
        },
        "bias_rates": rates,
        "top_moments": top_moments,
        "recommendations": recommendations,
    }
