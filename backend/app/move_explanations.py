from __future__ import annotations

import math
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

BACKEND_DIR = Path(__file__).resolve().parents[1]
MOVE_EXPLANATIONS_DOC = BACKEND_DIR / "docs" / "MOVE_EXPLANATIONS.md"
ALLOWED_GRADES = {
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
}


class MoveExplanationError(ValueError):
    """Raised when deterministic move explanation rendering cannot proceed."""


def load_move_explanations_contract_text() -> str:
    try:
        text = MOVE_EXPLANATIONS_DOC.read_text(encoding="utf-8")
    except Exception as exc:
        raise MoveExplanationError(f"failed reading move explanations contract: {exc}") from exc
    if not text.strip():
        raise MoveExplanationError("move explanations contract is empty")
    return text


@lru_cache(maxsize=1)
def _grade_specs_from_contract() -> dict[str, dict[str, Any]]:
    text = load_move_explanations_contract_text()
    lines = text.splitlines()
    in_table = False
    specs: dict[str, dict[str, Any]] = {}

    for line in lines:
        stripped = line.strip()
        if stripped == "## Grade Mapping Table":
            in_table = True
            continue
        if in_table and stripped.startswith("## "):
            break
        if not in_table or not stripped.startswith("|"):
            continue
        if stripped.startswith("|---") or stripped.startswith("| Grade "):
            continue

        cols = [col.strip() for col in stripped.split("|")[1:-1]]
        if len(cols) < 5:
            continue

        grade = cols[0].strip().strip("`")
        if grade not in ALLOWED_GRADES:
            continue

        metric_specs: list[dict[str, str]] = []
        for match in re.finditer(
            r'\{name:"([^"]+)",\s*value_source:"([^"]+)",\s*unit:"([^"]+)"\}',
            cols[2],
        ):
            metric_specs.append(
                {
                    "name": match.group(1).strip(),
                    "value_source": match.group(2).strip(),
                    "unit": match.group(3).strip(),
                }
            )
        if not metric_specs:
            raise MoveExplanationError(f"contract missing metric specs for grade {grade}")

        template = cols[3].strip().strip("`")
        if not template:
            raise MoveExplanationError(f"contract missing template for grade {grade}")

        specs[grade] = {
            "label": grade,
            "condition_signature": cols[1].strip(),
            "metric_specs": metric_specs,
            "template": template,
        }

    missing = ALLOWED_GRADES - set(specs.keys())
    if missing:
        raise MoveExplanationError(f"contract missing grades: {sorted(missing)}")
    return specs


def _as_bool(value: Any, *, field: str) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value != 0
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "y"}:
            return True
        if normalized in {"false", "0", "no", "n", ""}:
            return False
    raise MoveExplanationError(f"missing/invalid boolean field: {field}")


def _as_float(value: Any, *, field: str) -> float:
    if isinstance(value, bool):
        raise MoveExplanationError(f"missing/invalid numeric field: {field}")
    try:
        parsed = float(value)
    except Exception as exc:
        raise MoveExplanationError(f"missing/invalid numeric field: {field}") from exc
    if not (parsed == parsed and parsed not in (float("inf"), float("-inf"))):
        raise MoveExplanationError(f"missing/invalid numeric field: {field}")
    return parsed


def _to_float(value: Any, *, field: str) -> float:
    if isinstance(value, bool):
        raise MoveExplanationError(f"missing/invalid numeric field: {field}")
    try:
        return float(value)
    except Exception as exc:
        raise MoveExplanationError(f"missing/invalid numeric field: {field}") from exc


def _required_text(mapping: dict[str, Any], key: str) -> str:
    value = mapping.get(key)
    if not isinstance(value, str):
        raise MoveExplanationError(f"missing/invalid text field: {key}")
    trimmed = value.strip()
    if not trimmed:
        raise MoveExplanationError(f"missing/invalid text field: {key}")
    return trimmed


def _required_thresholds(review_payload: dict[str, Any]) -> dict[str, float]:
    labeling_rules = review_payload.get("labeling_rules")
    if not isinstance(labeling_rules, dict):
        raise MoveExplanationError("review.json missing labeling_rules")
    thresholds_raw = labeling_rules.get("thresholds")
    if not isinstance(thresholds_raw, dict):
        raise MoveExplanationError("review.json missing labeling_rules.thresholds")

    thresholds: dict[str, float] = {}
    for key, value in thresholds_raw.items():
        thresholds[key] = _to_float(value, field=f"labeling_rules.thresholds.{key}")
    return thresholds


def _lookup_trade_grade(row: dict[str, Any]) -> str:
    for key in ("trade_grade", "label"):
        if isinstance(row.get(key), str) and row[key].strip():
            grade = row[key].strip()
            if grade in ALLOWED_GRADES:
                return grade
    raise MoveExplanationError("counterfactual row missing valid trade_grade")


def _lookup_pnl(row: dict[str, Any]) -> float:
    if "pnl" in row:
        return _as_float(row.get("pnl"), field="pnl")
    if "actual_pnl" in row:
        return _as_float(row.get("actual_pnl"), field="actual_pnl")
    raise MoveExplanationError("counterfactual row missing pnl/actual_pnl")


def _lookup_simulated_pnl(row: dict[str, Any]) -> float:
    return _as_float(row.get("simulated_pnl"), field="simulated_pnl")


def _lookup_impact_abs(row: dict[str, Any], pnl: float, simulated_pnl: float) -> float:
    if "impact_abs" in row:
        return _as_float(row.get("impact_abs"), field="impact_abs")
    return abs(pnl - simulated_pnl)


def _lookup_post_loss_streak(row: dict[str, Any]) -> int:
    if "post_loss_streak" not in row:
        raise MoveExplanationError("counterfactual row missing post_loss_streak")
    raw = row.get("post_loss_streak")
    if isinstance(raw, bool):
        raise MoveExplanationError("counterfactual row missing post_loss_streak")
    try:
        value = int(raw)
    except Exception as exc:
        raise MoveExplanationError("counterfactual row missing post_loss_streak") from exc
    if value < 0:
        raise MoveExplanationError("counterfactual row missing post_loss_streak")
    return value


def _format_for_template(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if not math.isfinite(float(value)):
            raise MoveExplanationError("template field value must be finite number")
        return f"{float(value):.2f}"
    return str(value)


def _render_template(template: str, context: dict[str, Any]) -> str:
    placeholders = re.findall(r"{([a-zA-Z0-9_]+)}", template)
    rendered = template
    for name in placeholders:
        if name not in context:
            raise MoveExplanationError(f"missing template field: {name}")
        rendered = rendered.replace("{" + name + "}", _format_for_template(context[name]))
    if not rendered.strip():
        raise MoveExplanationError("rendered explanation template is empty")
    return rendered


def _metric_value(name: str, context: dict[str, Any]) -> Any:
    if name not in context:
        raise MoveExplanationError(f"missing metric source value: {name}")
    value = context[name]
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if not math.isfinite(float(value)):
            raise MoveExplanationError(f"missing metric source value: {name}")
    return value


def render_move_explanation(review_payload: dict[str, Any], counterfactual_row: dict[str, Any]) -> dict[str, Any]:
    grade_specs = _grade_specs_from_contract()
    thresholds = _required_thresholds(review_payload)
    grade = _lookup_trade_grade(counterfactual_row)
    spec = grade_specs.get(grade)
    if spec is None:
        raise MoveExplanationError(f"no template/signature configured for grade: {grade}")

    timestamp = _required_text(counterfactual_row, "timestamp")
    asset = _required_text(counterfactual_row, "asset")
    pnl = _lookup_pnl(counterfactual_row)
    simulated_pnl = _lookup_simulated_pnl(counterfactual_row)
    impact_abs = _lookup_impact_abs(counterfactual_row, pnl, simulated_pnl)
    loss_abs = abs(pnl) if pnl < 0 else 0.0
    blocked_reason = str(counterfactual_row.get("blocked_reason", "NONE")).strip() or "NONE"
    is_revenge = _as_bool(counterfactual_row.get("is_revenge"), field="is_revenge")
    is_overtrading = _as_bool(counterfactual_row.get("is_overtrading"), field="is_overtrading")
    is_loss_aversion = _as_bool(counterfactual_row.get("is_loss_aversion"), field="is_loss_aversion")
    bias_tagged = is_revenge or is_overtrading or is_loss_aversion
    blocked_bias = _as_bool(
        counterfactual_row.get("is_blocked_bias", blocked_reason == "BIAS"),
        field="is_blocked_bias",
    ) or blocked_reason == "BIAS"
    blocked_risk = _as_bool(
        counterfactual_row.get("is_blocked_risk", blocked_reason == "DAILY_MAX_LOSS"),
        field="is_blocked_risk",
    ) or blocked_reason == "DAILY_MAX_LOSS"
    post_loss_streak = _lookup_post_loss_streak(counterfactual_row)

    derived_stats = review_payload.get("derived_stats", {})
    if not isinstance(derived_stats, dict):
        raise MoveExplanationError("review.json missing derived_stats")
    daily_max_loss_used = _as_float(
        derived_stats.get("daily_max_loss_used"),
        field="derived_stats.daily_max_loss_used",
    )
    simulated_daily_pnl = _as_float(
        counterfactual_row.get("simulated_daily_pnl"),
        field="simulated_daily_pnl",
    )
    near_daily_limit = (
        simulated_daily_pnl <= (-0.8 * daily_max_loss_used)
        if daily_max_loss_used > 0
        else False
    )

    context: dict[str, Any] = {
        "pnl": pnl,
        "simulated_pnl": simulated_pnl,
        "impact_abs": impact_abs,
        "loss_abs": loss_abs,
        "blocked_reason": blocked_reason,
        "blocked_bias": blocked_bias,
        "blocked_risk": blocked_risk,
        "bias_tagged": bias_tagged,
        "near_daily_limit": near_daily_limit,
        "post_loss_streak": post_loss_streak,
        "win_percentile": 99.5,
    }
    context.update(thresholds)

    metric_refs: list[dict[str, Any]] = []
    for metric_spec in spec["metric_specs"]:
        metric_refs.append(
            {
                "name": metric_spec["name"],
                "value": _metric_value(metric_spec["name"], context),
                "unit": metric_spec["unit"],
            }
        )

    explanation = _render_template(spec["template"], context)

    return {
        "label": grade,
        "timestamp": timestamp,
        "asset": asset,
        "explanation": explanation,
        "metric_refs": metric_refs,
    }


def _row_key(row: dict[str, Any]) -> tuple[str, str]:
    return (_required_text(row, "timestamp"), _required_text(row, "asset"))


def _with_post_loss_streak(counterfactual_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    enriched: list[dict[str, Any]] = []
    loss_streak = 0
    for index, row in enumerate(counterfactual_rows):
        row_copy = dict(row)
        row_copy["_index"] = index
        row_copy["post_loss_streak"] = loss_streak
        pnl = _lookup_pnl(row_copy)
        if pnl < 0:
            loss_streak += 1
        else:
            loss_streak = 0
        row_copy["impact_abs"] = _lookup_impact_abs(row_copy, pnl, _lookup_simulated_pnl(row_copy))
        enriched.append(row_copy)
    return enriched


def top_three_moment_rows(review_payload: dict[str, Any], counterfactual_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not counterfactual_rows:
        raise MoveExplanationError("counterfactual.csv has no rows for deterministic move review")
    enriched_rows = _with_post_loss_streak(counterfactual_rows)
    selected: list[dict[str, Any]] = []

    top_moments = review_payload.get("top_moments")
    if isinstance(top_moments, list) and top_moments:
        used_indexes: set[int] = set()
        for moment in top_moments:
            if len(selected) >= 3:
                break
            if not isinstance(moment, dict):
                continue
            ts = moment.get("timestamp")
            asset = moment.get("asset")
            if not isinstance(ts, str) or not isinstance(asset, str):
                raise MoveExplanationError("review.json top_moments missing timestamp/asset")
            match: dict[str, Any] | None = None
            for row in enriched_rows:
                idx = int(row["_index"])
                if idx in used_indexes:
                    continue
                if row.get("timestamp") == ts and row.get("asset") == asset:
                    match = dict(row)
                    used_indexes.add(idx)
                    break
            if match is None:
                raise MoveExplanationError(
                    f"top_moments entry not found in counterfactual rows: timestamp={ts}, asset={asset}"
                )
            if "trade_grade" not in match and isinstance(moment.get("trade_grade"), str):
                match["trade_grade"] = moment.get("trade_grade")
            if "trade_grade" not in match and isinstance(moment.get("label"), str):
                match["trade_grade"] = moment.get("label")
            selected.append(match)

    seen_keys: set[tuple[str, str]] = {_row_key(row) for row in selected}
    ranked = sorted(
        enriched_rows,
        key=lambda row: (
            -_as_float(row.get("impact_abs"), field="impact_abs"),
            str(row.get("timestamp", "")),
            str(row.get("asset", "")),
            int(row.get("_index", 0)),
        ),
    )
    for row in ranked:
        if len(selected) >= 3:
            break
        key = _row_key(row)
        if key in seen_keys:
            continue
        seen_keys.add(key)
        selected.append(dict(row))

    if len(selected) < 3:
        raise MoveExplanationError(f"need 3 top moments, found {len(selected)}")
    return selected[:3]


def build_deterministic_move_review(
    review_payload: dict[str, Any],
    counterfactual_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    rows = top_three_moment_rows(review_payload, counterfactual_rows)
    move_review: list[dict[str, Any]] = []
    for row in rows:
        move_review.append(render_move_explanation(review_payload, row))
    if len(move_review) != 3:
        raise MoveExplanationError(f"need deterministic move_review length=3, got {len(move_review)}")
    return move_review
