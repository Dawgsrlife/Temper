from __future__ import annotations

from pathlib import Path
import os
import subprocess

import pandas as pd

from app.counterfactual import CounterfactualEngine
from app.detective import BiasDetective
from app.normalizer import DataNormalizer
from app.review import TRADE_GRADES, apply_trade_grades
from app.risk import recommend_daily_max_loss


def test_badge_labels_are_valid_and_deterministic() -> None:
    root = Path(__file__).resolve().parents[2]
    csv_path = root / "trading_datasets" / "calm_trader.csv"

    normalized = DataNormalizer(source=csv_path, dayfirst=False).normalize()
    flagged = BiasDetective(normalized).detect().copy()
    flagged["trade_id"] = range(len(flagged))
    dml = recommend_daily_max_loss(normalized)

    out_a, summary_a = CounterfactualEngine(flagged, daily_max_loss=dml).run()
    graded_a, _ = apply_trade_grades(out_a, summary_a)

    shuffled = flagged.sample(frac=1.0, random_state=7).reset_index(drop=True)
    out_b, summary_b = CounterfactualEngine(shuffled, daily_max_loss=dml).run()
    graded_b, _ = apply_trade_grades(out_b, summary_b)

    assert summary_a == summary_b
    assert set(graded_a["trade_grade"].unique()).issubset(set(TRADE_GRADES))
    assert graded_a["special_tags"].notna().all()

    cols = ["trade_grade", "special_tags"]
    aligned_a = graded_a.sort_values("trade_id")[cols].reset_index(drop=True)
    aligned_b = graded_b.sort_values("trade_id")[cols].reset_index(drop=True)
    pd.testing.assert_frame_equal(aligned_a, aligned_b)


def test_severe_badges_are_rare_and_high_impact() -> None:
    root = Path(__file__).resolve().parents[2]
    csv_path = root / "trading_datasets" / "revenge_trader.csv"

    normalized = DataNormalizer(source=csv_path, dayfirst=False).normalize()
    flagged = BiasDetective(normalized).detect()
    dml = recommend_daily_max_loss(normalized)
    out, summary = CounterfactualEngine(flagged, daily_max_loss=dml).run()
    graded, _ = apply_trade_grades(out, summary)

    impact_abs = (graded["pnl"] - graded["simulated_pnl"]).abs()
    severe = graded["trade_grade"].isin(["MEGABLUNDER", "BLUNDER", "MISS"])
    severe_ratio = float(severe.mean())
    assert severe_ratio <= 0.20

    if severe.any():
        severe_impact = impact_abs[severe]
        assert float(severe_impact.median()) >= float(impact_abs.quantile(0.80))


def test_grade_columns_present_in_judge_pack_outputs() -> None:
    root = Path(__file__).resolve().parents[2]
    out_dir = root / "backend" / "outputs" / "calm_pack_grade_test"
    cmd = [
        str(root / "backend" / "venv" / "bin" / "python"),
        str(root / "backend" / "scripts" / "judge_pack.py"),
        "--input",
        str(root / "trading_datasets" / "calm_trader.csv"),
        "--out_dir",
        str(out_dir),
    ]
    env = os.environ.copy()
    env["PYTHONPATH"] = "backend"
    subprocess.run(cmd, cwd=root, check=True, env=env)

    cf = pd.read_csv(out_dir / "counterfactual.csv")
    assert "trade_grade" in cf.columns
    assert "special_tags" in cf.columns
    assert set(cf["trade_grade"].dropna().unique()).issubset(set(TRADE_GRADES))
