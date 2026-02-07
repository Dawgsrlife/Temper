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
    critical_window: int = 3,
    data_quality_warnings: list[str] | None = None,
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
    sort_order = [
        col
        for col in ("timestamp", "asset", "side", "price", "size_usd", "pnl")
        if col in working.columns
    ]
    working = working.sort_values(sort_order, kind="mergesort").reset_index(drop=True)
    working["_row_num"] = range(len(working))
    working["counterfactual_impact"] = working["simulated_pnl"] - working["pnl"]

    bias_tagged = working["is_revenge"] | working["is_overtrading"] | working["is_loss_aversion"]
    positive_impacts = working.loc[
        bias_tagged & (working["counterfactual_impact"] > 0),
        "counterfactual_impact",
    ]
    mega_cutoff = float(positive_impacts.quantile(0.99)) if not positive_impacts.empty else 0.0
    blunder_cutoff = float(positive_impacts.quantile(0.95)) if not positive_impacts.empty else 0.0
    inaccuracy_cutoff = (
        float(positive_impacts.quantile(0.80)) if not positive_impacts.empty else 0.0
    )

    blocked = working[working["blocked_reason"] != "NONE"].copy()
    blocked = blocked.sort_values(
        ["counterfactual_impact", "timestamp"],
        ascending=[False, True],
        kind="mergesort",
    )

    top_rows = blocked.head(top_n).copy()
    top_rows["label"] = "INACCURACY"
    top_rows.loc[
        (top_rows["counterfactual_impact"] >= inaccuracy_cutoff)
        & (top_rows["counterfactual_impact"] > 0),
        "label",
    ] = "INACCURACY"
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

    top_moments: list[dict[str, object]] = []
    for _, row in top_rows.iterrows():
        center = int(row["_row_num"])
        left = max(0, center - critical_window)
        right = min(len(working) - 1, center + critical_window)

        critical = working.iloc[left : right + 1][
            ["timestamp", "asset", "pnl", "simulated_pnl", "blocked_reason", "_row_num"]
        ].copy()
        critical["timestamp"] = pd.to_datetime(critical["timestamp"]).dt.strftime(
            "%Y-%m-%dT%H:%M:%S"
        )
        critical["offset"] = critical["_row_num"] - center
        critical["is_focus"] = critical["offset"] == 0
        critical_line = critical[
            [
                "offset",
                "is_focus",
                "timestamp",
                "asset",
                "pnl",
                "simulated_pnl",
                "blocked_reason",
            ]
        ].rename(
            columns={"pnl": "actual_pnl"}
        ).to_dict(orient="records")

        top_moments.append(
            {
                "timestamp": str(row["timestamp"]),
                "asset": str(row["asset"]),
                "label": str(row["label"]),
                "blocked_reason": str(row["blocked_reason"]),
                "actual_pnl": float(row["pnl"]),
                "simulated_pnl": float(row["simulated_pnl"]),
                "impact": float(row["counterfactual_impact"]),
                "bias_tags": str(row["bias_tags"]),
                "critical_line": critical_line,
            }
        )

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

    hourly_counts = (
        working.groupby(working["timestamp"].dt.floor("h"), sort=False)
        .size()
        .astype(float)
    )
    trades_per_hour_p95 = float(hourly_counts.quantile(0.95)) if not hourly_counts.empty else 0.0
    median_win = float(working.loc[working["pnl"] > 0, "pnl"].median()) if (working["pnl"] > 0).any() else 0.0
    median_loss_abs = (
        float(working.loc[working["pnl"] < 0, "pnl"].abs().median())
        if (working["pnl"] < 0).any()
        else 0.0
    )
    loss_to_win_ratio = (median_loss_abs / median_win) if median_win > 0 else 0.0
    minutes_between = (
        working["timestamp"].diff().dt.total_seconds().div(60.0).dropna()
    )
    median_minutes_between = (
        float(minutes_between.median()) if not minutes_between.empty else 0.0
    )

    prev_loss = working["pnl"].shift(1) < 0
    prev_size = working.get("size_usd", pd.Series(0.0, index=working.index)).shift(1)
    curr_size = working.get("size_usd", pd.Series(0.0, index=working.index))
    valid_size = prev_size > 0
    post_loss_multipliers = (curr_size / prev_size.where(valid_size))[prev_loss & valid_size]
    median_post_loss_size_multiplier = (
        float(post_loss_multipliers.median()) if not post_loss_multipliers.empty else 1.0
    )

    daily_max_loss_used = float(summary.get("daily_max_loss_used", 0.0))
    near_limit_rows = 0
    if daily_max_loss_used > 0 and "simulated_daily_pnl" in working.columns:
        near_limit_rows = int(
            (working["simulated_daily_pnl"] <= (-0.8 * daily_max_loss_used)).sum()
        )

    bias_event = (working["is_revenge"] | working["is_overtrading"]).astype(bool)
    streak_id = (bias_event != bias_event.shift(fill_value=False)).cumsum()
    streak_lengths = (
        bias_event[bias_event]
        .groupby(streak_id[bias_event], sort=False)
        .size()
    )
    tilt_streak_count = int((streak_lengths >= 3).sum()) if not streak_lengths.empty else 0
    longest_tilt_streak = int(streak_lengths.max()) if not streak_lengths.empty else 0

    derived_stats = {
        "trade_count": int(len(working)),
        "any_bias_rate_pct": rates["any_bias_rate"] * 100.0,
        "revenge_rate_pct": rates["revenge_rate"] * 100.0,
        "overtrading_rate_pct": rates["overtrading_rate"] * 100.0,
        "loss_aversion_rate_pct": rates["loss_aversion_rate"] * 100.0,
        "trades_per_hour_p95": trades_per_hour_p95,
        "median_minutes_between_trades": median_minutes_between,
        "median_win_pnl": median_win,
        "median_loss_abs_pnl": median_loss_abs,
        "loss_to_win_ratio": loss_to_win_ratio,
        "median_post_loss_size_multiplier": median_post_loss_size_multiplier,
        "near_daily_limit_trade_count": near_limit_rows,
        "daily_max_loss_used": daily_max_loss_used,
        "tilt_streak_count": tilt_streak_count,
        "longest_tilt_streak": longest_tilt_streak,
    }

    recommendations: list[str] = []
    recommendations.append(
        "Bias-impacted trades: "
        f"{derived_stats['any_bias_rate_pct']:.2f}% across "
        f"{derived_stats['trade_count']} trades."
    )
    recommendations.append(
        "Limits: keep hourly volume under "
        f"{derived_stats['trades_per_hour_p95']:.0f} trades in high-activity periods."
    )
    recommendations.append(
        "Cooldown: after losses, median size jumps to "
        f"{derived_stats['median_post_loss_size_multiplier']:.2f}x; enforce a "
        f"{max(5, int(round(derived_stats['median_minutes_between_trades'] * 2)))} minute pause."
    )
    recommendations.append(
        "Sizing discipline: near-limit pressure appeared on "
        f"{derived_stats['near_daily_limit_trade_count']} trades with daily cap "
        f"{daily_max_loss_used:.2f}; trim size as drawdown approaches 80%."
    )
    recommendations.append(
        "Exit discipline: loss/win median ratio is "
        f"{derived_stats['loss_to_win_ratio']:.2f} "
        f"({derived_stats['median_loss_abs_pnl']:.2f}/{derived_stats['median_win_pnl']:.2f})."
    )
    recommendations.append(
        "Journaling prompt: log why you traded after a loss on each revenge-flagged setup "
        f"({derived_stats['revenge_rate_pct']:.2f}% of trades)."
    )
    recommendations.append(
        "Journaling prompt: during tilt streaks (longest "
        f"{derived_stats['longest_tilt_streak']} trades), note trigger/context before re-entry."
    )

    opening_window = min(100, len(working))
    opening_df = working.head(opening_window)
    endgame_df = working.tail(opening_window)
    mid_start = opening_window
    mid_end = max(mid_start, len(working) - opening_window)
    middlegame_df = working.iloc[mid_start:mid_end]
    if middlegame_df.empty:
        middlegame_df = working.iloc[mid_start:]

    opening = {
        "trades": int(len(opening_df)),
        "pnl": float(opening_df["pnl"].sum()),
        "bias_rate_pct": float(
            (
                opening_df["is_revenge"]
                | opening_df["is_overtrading"]
                | opening_df["is_loss_aversion"]
            ).mean()
            * 100.0
        )
        if len(opening_df) > 0
        else 0.0,
        "summary": (
            f"Opening pace: {len(opening_df)} trades, pnl {float(opening_df['pnl'].sum()):.2f}, "
            f"bias rate {float(((opening_df['is_revenge'] | opening_df['is_overtrading'] | opening_df['is_loss_aversion']).mean() * 100.0) if len(opening_df) > 0 else 0.0):.2f}%."
        ),
    }
    middlegame = {
        "trades": int(len(middlegame_df)),
        "pnl": float(middlegame_df["pnl"].sum()) if len(middlegame_df) > 0 else 0.0,
        "tilt_streak_count": tilt_streak_count,
        "longest_tilt_streak": longest_tilt_streak,
        "summary": (
            f"Middlegame pressure: {tilt_streak_count} tilt streaks, longest run {longest_tilt_streak} trades."
        ),
    }
    endgame = {
        "trades": int(len(endgame_df)),
        "pnl": float(endgame_df["pnl"].sum()),
        "near_limit_trade_count": int(
            (endgame_df["simulated_daily_pnl"] <= (-0.8 * daily_max_loss_used)).sum()
        )
        if daily_max_loss_used > 0 and "simulated_daily_pnl" in endgame_df.columns
        else 0,
        "summary": (
            f"Endgame discipline: pnl {float(endgame_df['pnl'].sum()):.2f}, "
            f"near-limit trades {int((endgame_df['simulated_daily_pnl'] <= (-0.8 * daily_max_loss_used)).sum()) if daily_max_loss_used > 0 and 'simulated_daily_pnl' in endgame_df.columns else 0}."
        ),
    }

    coach_plan = [
        "Step 1 (Limits): cap hourly trades at or below "
        f"{derived_stats['trades_per_hour_p95']:.0f}.",
        "Step 2 (Cooldown): enforce a "
        f"{max(5, int(round(derived_stats['median_minutes_between_trades'] * 2)))} minute pause after losses.",
        "Step 3 (Sizing/Exit): keep loss/win ratio under 1.00 and reduce size near 80% daily drawdown.",
    ]

    labeling_rules = {
        "impact_definition": "impact = simulated_pnl - actual_pnl",
        "population": "bias-tagged trades with positive impact",
        "mega_blunder": {
            "rule": "impact >= p99(impact)",
            "cutoff": mega_cutoff,
            "percentile": 99,
        },
        "blunder": {
            "rule": "impact >= p95(impact) and impact < p99(impact)",
            "cutoff": blunder_cutoff,
            "percentile": 95,
        },
        "inaccuracy": {
            "rule": "impact > 0 and impact < p95(impact)",
            "cutoff": inaccuracy_cutoff,
            "percentile": 80,
        },
    }

    return {
        "headline": str(summary.get("outcome", "DRAW")),
        "scoreboard": {
            "delta_pnl": float(summary.get("delta_pnl", 0.0)),
            "cost_of_bias": float(summary.get("cost_of_bias", 0.0)),
            "blocked_bias_count": int(summary.get("blocked_bias_count", 0)),
            "blocked_risk_count": int(summary.get("blocked_risk_count", 0)),
        },
        "bias_rates": rates,
        "derived_stats": derived_stats,
        "labeling_rules": labeling_rules,
        "opening": opening,
        "middlegame": middlegame,
        "endgame": endgame,
        "top_moments": top_moments,
        "recommendations": recommendations,
        "coach_plan": coach_plan,
        "data_quality_warnings": data_quality_warnings or [],
    }
