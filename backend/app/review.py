"""
Temper – Review and Trade Grading

Deterministic grading + review payload builder.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd


TRADE_GRADES: tuple[str, ...] = (
    "BRILLIANT",
    "GREAT",
    "BEST",
    "EXCELLENT",
    "GOOD",
    "INACCURACY",
    "MISTAKE",
    "MISS",
    "BLUNDER",
    "MEGABLUNDER",
)

SEVERE_BADGES: tuple[str, ...] = ("MEGABLUNDER", "BLUNDER", "MISS")
SPECIAL_TAGS: tuple[str, ...] = ("BOOK", "FORCED", "INTERESTING")
PHASES: tuple[str, ...] = ("OPENING", "MIDDLEGAME", "ENDGAME")


def _sorted_working(df: pd.DataFrame) -> pd.DataFrame:
    working = df.copy()
    working["_orig_order"] = range(len(working))
    sort_order = [
        col
        for col in ("timestamp", "asset", "side", "price", "size_usd", "pnl")
        if col in working.columns
    ] + ["_orig_order"]
    return working.sort_values(sort_order, kind="mergesort").reset_index(drop=True)


def _quantile_or_default(series: pd.Series, q: float, default: float) -> float:
    clean = pd.to_numeric(series, errors="coerce").dropna()
    if clean.empty:
        return default
    return float(clean.quantile(q))


def _assign_phases(n: int) -> np.ndarray:
    phase = np.full(n, "MIDDLEGAME", dtype=object)
    if n == 0:
        return phase

    if n < 200:
        left = max(1, n // 3)
        right = max(left + 1, (2 * n) // 3)
        right = min(right, n)
        phase[:left] = "OPENING"
        phase[right:] = "ENDGAME"
        return phase

    opening_end = 100
    endgame_start = n - 100
    phase[:opening_end] = "OPENING"
    phase[endgame_start:] = "ENDGAME"
    return phase


def _grade_rules(working: pd.DataFrame, daily_max_loss_used: float) -> dict[str, Any]:
    impact = (working["pnl"] - working["simulated_pnl"]).abs()
    impact_positive = impact[impact > 0]
    loss_abs = working["pnl"].clip(upper=0).abs()
    win = working["pnl"].clip(lower=0)
    bias_tagged = (
        working["is_revenge"] | working["is_overtrading"] | working["is_loss_aversion"]
    )
    blocked_bias = working["blocked_reason"].eq("BIAS")
    blocked_risk = working["blocked_reason"].eq("DAILY_MAX_LOSS")

    if daily_max_loss_used > 0 and "simulated_daily_pnl" in working.columns:
        near_daily_limit = working["simulated_daily_pnl"] <= (-0.8 * daily_max_loss_used)
    else:
        near_daily_limit = pd.Series(False, index=working.index)

    loss = working["pnl"] < 0
    loss_streak = loss.groupby((~loss).cumsum(), sort=False).cumsum()
    post_loss_streak = loss_streak.shift(1).fillna(0)

    size_usd = pd.to_numeric(working.get("size_usd", 0.0), errors="coerce").fillna(0.0)
    prev_size = size_usd.shift(1)
    valid_prev = prev_size > 0
    size_multiplier = (size_usd / prev_size.where(valid_prev)).fillna(1.0)

    thresholds = {
        "impact_p995": _quantile_or_default(impact_positive, 0.995, float("inf")),
        "impact_p99": _quantile_or_default(impact_positive, 0.99, float("inf")),
        "impact_p95": _quantile_or_default(impact_positive, 0.95, float("inf")),
        "impact_p90": _quantile_or_default(impact_positive, 0.90, float("inf")),
        "impact_p80": _quantile_or_default(impact_positive, 0.80, float("inf")),
        "impact_p65": _quantile_or_default(impact_positive, 0.65, float("inf")),
        "loss_abs_p95": _quantile_or_default(loss_abs, 0.95, float("inf")),
        "loss_abs_p85": _quantile_or_default(loss_abs, 0.85, float("inf")),
        "loss_abs_p70": _quantile_or_default(loss_abs, 0.70, float("inf")),
        "win_p995": _quantile_or_default(win, 0.995, float("inf")),
        "win_p95": _quantile_or_default(win, 0.95, float("inf")),
        "win_p85": _quantile_or_default(win, 0.85, float("inf")),
        "win_p70": _quantile_or_default(win, 0.70, float("inf")),
    }

    conditions = {
        "MEGABLUNDER": (
            (bias_tagged | blocked_bias | blocked_risk)
            & (impact > 0)
            & (impact >= thresholds["impact_p995"])
            & (working["pnl"] <= 0)
        ),
        "BLUNDER": (
            (bias_tagged | blocked_bias | blocked_risk)
            & (impact > 0)
            & (impact >= thresholds["impact_p95"])
            & (working["pnl"] <= 0)
        ),
        "MISS": (
            (
                bias_tagged
                & (working["pnl"] > 0)
                & (post_loss_streak >= 1)
                & (impact > 0)
                & (impact >= thresholds["impact_p90"])
            )
            | (
                blocked_risk
                & (working["pnl"] > 0)
                & (impact > 0)
                & (impact >= thresholds["impact_p80"])
            )
        ),
        "MISTAKE": (
            (working["pnl"] < 0)
            & (
                ((impact > 0) & (impact >= thresholds["impact_p80"]))
                | (bias_tagged & (loss_abs >= thresholds["loss_abs_p85"]))
            )
        ),
        "INACCURACY": (
            (working["pnl"] < 0)
            & (
                bias_tagged
                | near_daily_limit
                | (loss_abs >= thresholds["loss_abs_p70"])
                | (impact >= thresholds["impact_p65"])
            )
        ),
        "BRILLIANT": (
            (working["pnl"] >= thresholds["win_p995"])
            & ((near_daily_limit) | (post_loss_streak >= 2))
        ),
        "GREAT": (
            (working["pnl"] >= thresholds["win_p95"])
            & ((near_daily_limit) | (post_loss_streak >= 1))
        ),
        "BEST": working["pnl"] >= thresholds["win_p85"],
        "EXCELLENT": working["pnl"] >= thresholds["win_p70"],
    }

    tags = {
        "BOOK": None,  # filled below
        "FORCED": blocked_risk | near_daily_limit,
        "INTERESTING": (
            (bias_tagged & (working["pnl"] > 0))
            | (
                (~bias_tagged)
                & (impact >= thresholds["impact_p90"])
                & (size_multiplier >= 1.5)
            )
        ),
    }

    day_key = pd.to_datetime(working["timestamp"], errors="coerce").dt.floor("D")
    day_key = day_key.fillna(pd.Timestamp("1970-01-01"))
    rank_in_day = working.groupby(day_key, sort=False).cumcount() + 1
    tags["BOOK"] = (rank_in_day <= 3) & (~bias_tagged) & (~near_daily_limit)

    return {
        "impact": impact,
        "loss_abs": loss_abs,
        "bias_tagged": bias_tagged,
        "near_daily_limit": near_daily_limit,
        "post_loss_streak": post_loss_streak,
        "size_multiplier": size_multiplier,
        "thresholds": thresholds,
        "conditions": conditions,
        "tags": tags,
    }


def apply_trade_grades(
    df: pd.DataFrame,
    summary: dict[str, float | int | str],
) -> tuple[pd.DataFrame, dict[str, Any]]:
    required = {
        "timestamp",
        "asset",
        "pnl",
        "simulated_pnl",
        "is_revenge",
        "is_overtrading",
        "is_loss_aversion",
        "blocked_reason",
    }
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"DataFrame missing required columns: {missing}")

    daily_max_loss_used = float(summary.get("daily_max_loss_used", 0.0))
    working = _sorted_working(df)
    rules = _grade_rules(working, daily_max_loss_used)

    grade = np.full(len(working), "GOOD", dtype=object)
    priority = (
        "MEGABLUNDER",
        "BLUNDER",
        "MISS",
        "MISTAKE",
        "INACCURACY",
        "BRILLIANT",
        "GREAT",
        "BEST",
        "EXCELLENT",
    )
    for label in priority:
        mask = rules["conditions"][label].to_numpy()
        grade = np.where((grade == "GOOD") & mask, label, grade)
    working["trade_grade"] = grade

    special = (
        np.where(rules["tags"]["BOOK"], "BOOK|", "")
        + np.where(rules["tags"]["FORCED"], "FORCED|", "")
        + np.where(rules["tags"]["INTERESTING"], "INTERESTING|", "")
    )
    special_tags = pd.Series(special, index=working.index).str.rstrip("|")
    working["special_tags"] = special_tags.fillna("")

    working["impact_abs"] = rules["impact"]
    working["phase"] = _assign_phases(len(working))

    badge_counts = {
        label: int((working["trade_grade"] == label).sum()) for label in TRADE_GRADES
    }

    badge_examples: dict[str, list[dict[str, Any]]] = {}
    for label in SEVERE_BADGES:
        subset = working[working["trade_grade"] == label].sort_values(
            ["impact_abs", "timestamp"],
            ascending=[False, True],
            kind="mergesort",
        ).head(3)
        examples = []
        for _, row in subset.iterrows():
            examples.append(
                {
                    "timestamp": pd.to_datetime(row["timestamp"]).strftime("%Y-%m-%dT%H:%M:%S"),
                    "asset": str(row["asset"]),
                    "actual_pnl": float(row["pnl"]),
                    "simulated_pnl": float(row["simulated_pnl"]),
                    "impact_abs": float(row["impact_abs"]),
                    "blocked_reason": str(row["blocked_reason"]),
                    "special_tags": str(row["special_tags"]),
                }
            )
        badge_examples[label] = examples

    distribution_df = (
        working.groupby(["phase", "trade_grade"], sort=False)
        .size()
        .unstack(fill_value=0)
        .reindex(index=list(PHASES), columns=list(TRADE_GRADES), fill_value=0)
    )
    grade_distribution_by_phase = {
        phase: {label: int(distribution_df.loc[phase, label]) for label in TRADE_GRADES}
        for phase in PHASES
    }

    labeling_rules = {
        "impact_definition": "impact_abs = abs(actual_pnl - simulated_pnl)",
        "grade_rules": {
            "MEGABLUNDER": (
                "bias/risk context + negative pnl + impact_abs >= p99.5(impact_abs)"
            ),
            "BLUNDER": (
                "bias/risk context + negative pnl + impact_abs >= p95(impact_abs)"
            ),
            "MISS": "positive pnl in risky context with missed opportunity impact >= p90",
            "MISTAKE": "negative pnl with moderate/high impact or bias-linked loss",
            "INACCURACY": "smaller negative execution errors",
            "BRILLIANT": "top-tier win in danger context (near limit / post-loss streak)",
            "GREAT": "strong win in pressure context",
            "BEST": "high-percentile positive pnl",
            "EXCELLENT": "above-average positive pnl",
            "GOOD": "default stable trade",
        },
        "thresholds": rules["thresholds"],
        "special_tags": {
            "BOOK": "early disciplined trades per day (first 3) outside risk pressure",
            "FORCED": "trade occurred near/under risk pressure or risk-block context",
            "INTERESTING": "ambiguous/high-variance context warranting review",
        },
    }

    graded = working.sort_values("_orig_order", kind="mergesort").drop(
        columns=["_orig_order", "impact_abs", "phase"]
    )

    meta = {
        "labeling_rules": labeling_rules,
        "badge_counts": badge_counts,
        "badge_examples": badge_examples,
        "grade_distribution_by_phase": grade_distribution_by_phase,
    }
    return graded, meta


def build_trade_review(
    df: pd.DataFrame,
    summary: dict[str, float | int | str],
    *,
    top_n: int = 3,
    critical_window: int = 3,
    data_quality_warnings: list[str] | None = None,
    grading_meta: dict[str, Any] | None = None,
) -> dict[str, object]:
    graded_df, computed_meta = apply_trade_grades(df, summary)
    meta = grading_meta or computed_meta

    working = _sorted_working(graded_df).reset_index(drop=True)
    working["_row_num"] = range(len(working))
    working["counterfactual_impact"] = working["simulated_pnl"] - working["pnl"]

    severe_pool = working[
        working["trade_grade"].isin(["MEGABLUNDER", "BLUNDER", "MISS", "MISTAKE", "INACCURACY"])
    ]
    if severe_pool.empty:
        severe_pool = working
    top_rows = severe_pool.sort_values(
        ["counterfactual_impact", "timestamp"],
        ascending=[False, True],
        kind="mergesort",
    ).head(top_n)

    top_moments: list[dict[str, Any]] = []
    for _, row in top_rows.iterrows():
        center = int(row["_row_num"])
        left = max(0, center - critical_window)
        right = min(len(working) - 1, center + critical_window)
        critical = working.iloc[left : right + 1][
            [
                "timestamp",
                "asset",
                "pnl",
                "simulated_pnl",
                "blocked_reason",
                "trade_grade",
                "special_tags",
                "_row_num",
            ]
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
                "trade_grade",
                "special_tags",
            ]
        ].rename(columns={"pnl": "actual_pnl"}).to_dict(orient="records")

        top_moments.append(
            {
                "timestamp": pd.to_datetime(row["timestamp"]).strftime("%Y-%m-%dT%H:%M:%S"),
                "asset": str(row["asset"]),
                "label": str(row["trade_grade"]),
                "blocked_reason": str(row["blocked_reason"]),
                "actual_pnl": float(row["pnl"]),
                "simulated_pnl": float(row["simulated_pnl"]),
                "impact": float(row["counterfactual_impact"]),
                "special_tags": str(row["special_tags"]),
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
        working.groupby(working["timestamp"].dt.floor("h"), sort=False).size().astype(float)
    )
    trades_per_hour_p95 = float(hourly_counts.quantile(0.95)) if not hourly_counts.empty else 0.0
    median_win = (
        float(working.loc[working["pnl"] > 0, "pnl"].median())
        if (working["pnl"] > 0).any()
        else 0.0
    )
    median_loss_abs = (
        float(working.loc[working["pnl"] < 0, "pnl"].abs().median())
        if (working["pnl"] < 0).any()
        else 0.0
    )
    loss_to_win_ratio = (median_loss_abs / median_win) if median_win > 0 else 0.0
    minutes_between = working["timestamp"].diff().dt.total_seconds().div(60.0).dropna()
    median_minutes_between = float(minutes_between.median()) if not minutes_between.empty else 0.0

    prev_loss = working["pnl"].shift(1) < 0
    prev_size = pd.to_numeric(working.get("size_usd", 0.0), errors="coerce").shift(1)
    curr_size = pd.to_numeric(working.get("size_usd", 0.0), errors="coerce")
    valid_prev = prev_size > 0
    post_loss_multipliers = (curr_size / prev_size.where(valid_prev))[prev_loss & valid_prev]
    median_post_loss_size_multiplier = (
        float(post_loss_multipliers.median()) if not post_loss_multipliers.empty else 1.0
    )

    daily_max_loss_used = float(summary.get("daily_max_loss_used", 0.0))
    near_limit_rows = 0
    if daily_max_loss_used > 0 and "simulated_daily_pnl" in working.columns:
        near_limit_rows = int((working["simulated_daily_pnl"] <= (-0.8 * daily_max_loss_used)).sum())

    bias_event = (working["is_revenge"] | working["is_overtrading"]).astype(bool)
    streak_id = (bias_event != bias_event.shift(fill_value=False)).cumsum()
    streak_lengths = bias_event[bias_event].groupby(streak_id[bias_event], sort=False).size()
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

    recommendations = [
        (
            "Bias-impacted trades: "
            f"{derived_stats['any_bias_rate_pct']:.2f}% across "
            f"{derived_stats['trade_count']} trades."
        ),
        (
            "Limits: keep hourly volume under "
            f"{derived_stats['trades_per_hour_p95']:.0f} trades in high-activity periods."
        ),
        (
            "Cooldown: after losses, median size jumps to "
            f"{derived_stats['median_post_loss_size_multiplier']:.2f}x; enforce a "
            f"{max(5, int(round(derived_stats['median_minutes_between_trades'] * 2)))} minute pause."
        ),
        (
            "Sizing discipline: near-limit pressure appeared on "
            f"{derived_stats['near_daily_limit_trade_count']} trades with daily cap "
            f"{daily_max_loss_used:.2f}; trim size as drawdown approaches 80%."
        ),
        (
            "Exit discipline: loss/win median ratio is "
            f"{derived_stats['loss_to_win_ratio']:.2f} "
            f"({derived_stats['median_loss_abs_pnl']:.2f}/{derived_stats['median_win_pnl']:.2f})."
        ),
        (
            "Journaling prompt: log why you traded after a loss on each revenge-flagged setup "
            f"({derived_stats['revenge_rate_pct']:.2f}% of trades)."
        ),
        (
            "Journaling prompt: during tilt streaks (longest "
            f"{derived_stats['longest_tilt_streak']} trades), note trigger/context before re-entry."
        ),
    ]
    if data_quality_warnings:
        recommendations.append(
            "Data quality warning: some behavioral signals are downweighted due to input issues."
        )

    opening_window = min(100, len(working))
    opening_df = working.head(opening_window)
    endgame_df = working.tail(opening_window)
    mid_start = opening_window
    mid_end = max(mid_start, len(working) - opening_window)
    middlegame_df = working.iloc[mid_start:mid_end]
    if middlegame_df.empty:
        middlegame_df = working.iloc[mid_start:]

    def _phase_summary(frame: pd.DataFrame, phase_name: str) -> dict[str, Any]:
        if frame.empty:
            return {"trades": 0, "pnl": 0.0, "summary": f"{phase_name}: no trades."}
        bias_pct = float(
            (
                frame["is_revenge"] | frame["is_overtrading"] | frame["is_loss_aversion"]
            ).mean()
            * 100.0
        )
        return {
            "trades": int(len(frame)),
            "pnl": float(frame["pnl"].sum()),
            "bias_rate_pct": bias_pct,
            "summary": (
                f"{phase_name}: {len(frame)} trades, pnl {float(frame['pnl'].sum()):.2f}, "
                f"bias rate {bias_pct:.2f}%."
            ),
        }

    opening = _phase_summary(opening_df, "Opening")
    middlegame = _phase_summary(middlegame_df, "Middlegame")
    endgame = _phase_summary(endgame_df, "Endgame")

    coach_plan = [
        (
            "Step 1 (Limits): cap hourly trades at or below "
            f"{derived_stats['trades_per_hour_p95']:.0f}."
        ),
        (
            "Step 2 (Cooldown): enforce a "
            f"{max(5, int(round(derived_stats['median_minutes_between_trades'] * 2)))} minute pause after losses."
        ),
        "Step 3 (Execution): protect loss/win symmetry and reduce size near 80% drawdown.",
    ]

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
        "labeling_rules": meta["labeling_rules"],
        "badge_counts": meta["badge_counts"],
        "badge_examples": meta["badge_examples"],
        "grade_distribution_by_phase": meta["grade_distribution_by_phase"],
        "opening": opening,
        "middlegame": middlegame,
        "endgame": endgame,
        "top_moments": top_moments,
        "recommendations": recommendations,
        "coach_plan": coach_plan,
        "data_quality_warnings": data_quality_warnings or [],
    }
