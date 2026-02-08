# Move Explanations Contract (Deterministic, v1)

## Contract
- Explanations are deterministic functions of persisted artifacts (`counterfactual.csv`, `review.json`, `job.json`) and never depend on LLM sampling.
- Grade assignment is fixed by code in `app/review.py` and evaluated with priority order: `MEGABLUNDER -> BLUNDER -> MISS -> MISTAKE -> INACCURACY -> BRILLIANT -> GREAT -> BEST -> EXCELLENT`, else `GOOD`.
- Every explanation must include `metric_refs` whose values are pulled from artifact fields or derived fields defined in this contract.
- `impact_abs` is always `abs(pnl - simulated_pnl)` and must match `labeling_rules.impact_definition`.
- Quantile thresholds (`impact_p95`, `win_p85`, etc.) must be read from `review.json.labeling_rules.thresholds`, not recomputed in UI/LLM.
- LLM usage is post-hoc paraphrase/coach only; it may rephrase explanations but cannot invent metrics, labels, or counterfactual claims.
- If required metrics are missing/corrupt, explanation generation must fail closed (surface explicit error), not backfill with guessed values.

## Grade Mapping Table
Helper signals used below:
- `bias_tagged = is_revenge OR is_overtrading OR is_loss_aversion`
- `blocked_bias = (blocked_reason == "BIAS")`
- `blocked_risk = (blocked_reason == "DAILY_MAX_LOSS")`
- `near_daily_limit = (simulated_daily_pnl <= -0.8 * daily_max_loss_used)` when `daily_max_loss_used > 0`, else `False`
- `post_loss_streak = rolling prior consecutive loss count`

| Grade | Condition signature (deterministic) | Required metric_refs | 1-sentence explanation template | What to show in UI (max 2) |
|---|---|---|---|---|
| `BRILLIANT` | `(pnl >= win_p995) AND (near_daily_limit OR post_loss_streak >= 2)` and no higher-priority negative grade matched | `{name:"pnl", value_source:"counterfactual.csv.pnl", unit:"USD"}`, `{name:"win_p995", value_source:"review.json.labeling_rules.thresholds.win_p995", unit:"USD"}`, `{name:"post_loss_streak", value_source:"derived_from_counterfactual_sequence", unit:"trades"}` | `This was a top-{win_percentile} win ({pnl}) executed under pressure (post-loss streak {post_loss_streak}/near-limit {near_daily_limit}).` | `Trade card: pnl vs win_p995 threshold`; `Context chip: post-loss streak / near-limit state` |
| `GREAT` | `(pnl >= win_p95) AND (near_daily_limit OR post_loss_streak >= 1)` and no earlier matched grade | `{name:"pnl", value_source:"counterfactual.csv.pnl", unit:"USD"}`, `{name:"win_p95", value_source:"review.json.labeling_rules.thresholds.win_p95", unit:"USD"}`, `{name:"near_daily_limit", value_source:"counterfactual.csv.simulated_daily_pnl + review.derived_stats.daily_max_loss_used", unit:"bool"}` | `You produced a high-percentile win ({pnl} >= {win_p95}) while in a pressure context (near-limit={near_daily_limit}, post-loss streak={post_loss_streak}).` | `Win percentile badge`; `Pressure context badge` |
| `BEST` | `(pnl >= win_p85)` and no earlier matched grade | `{name:"pnl", value_source:"counterfactual.csv.pnl", unit:"USD"}`, `{name:"win_p85", value_source:"review.json.labeling_rules.thresholds.win_p85", unit:"USD"}`, `{name:"blocked_reason", value_source:"counterfactual.csv.blocked_reason", unit:"enum"}` | `This trade cleared the BEST threshold ({pnl} >= {win_p85}) with blocked_reason={blocked_reason}.` | `Threshold bar: pnl vs win_p85`; `Blocked reason chip` |
| `EXCELLENT` | `(pnl >= win_p70)` and no earlier matched grade | `{name:"pnl", value_source:"counterfactual.csv.pnl", unit:"USD"}`, `{name:"win_p70", value_source:"review.json.labeling_rules.thresholds.win_p70", unit:"USD"}`, `{name:"impact_abs", value_source:"abs(pnl-simulated_pnl)", unit:"USD"}` | `Execution landed above the EXCELLENT threshold ({pnl} >= {win_p70}) with impact delta {impact_abs}.` | `Pnl threshold card`; `Impact delta mini-chart` |
| `GOOD` | `NOT(MEGABLUNDER OR BLUNDER OR MISS OR MISTAKE OR INACCURACY OR BRILLIANT OR GREAT OR BEST OR EXCELLENT)` | `{name:"pnl", value_source:"counterfactual.csv.pnl", unit:"USD"}`, `{name:"impact_abs", value_source:"abs(pnl-simulated_pnl)", unit:"USD"}`, `{name:"bias_tagged", value_source:"is_revenge|is_overtrading|is_loss_aversion", unit:"bool"}` | `No high-severity error or high-percentile win rule fired; this trade remained stable with pnl {pnl} and impact delta {impact_abs}.` | `Neutral badge`; `Compact trade context` |
| `INACCURACY` | `(pnl < 0) AND (bias_tagged OR near_daily_limit OR loss_abs >= loss_abs_p70 OR impact_abs >= impact_p65)` and no earlier matched grade | `{name:"pnl", value_source:"counterfactual.csv.pnl", unit:"USD"}`, `{name:"loss_abs_p70", value_source:"review.json.labeling_rules.thresholds.loss_abs_p70", unit:"USD"}`, `{name:"impact_p65", value_source:"review.json.labeling_rules.thresholds.impact_p65", unit:"USD"}` | `This loss qualified as an inaccuracy because pnl {pnl} triggered low-severity risk/error thresholds (bias={bias_tagged}, near_limit={near_daily_limit}, impact={impact_abs}).` | `Loss threshold indicator`; `Bias/near-limit context chip` |
| `MISTAKE` | `(pnl < 0) AND ((impact_abs > 0 AND impact_abs >= impact_p80) OR (bias_tagged AND loss_abs >= loss_abs_p85))` and no earlier matched grade | `{name:"impact_abs", value_source:"abs(pnl-simulated_pnl)", unit:"USD"}`, `{name:"impact_p80", value_source:"review.json.labeling_rules.thresholds.impact_p80", unit:"USD"}`, `{name:"loss_abs_p85", value_source:"review.json.labeling_rules.thresholds.loss_abs_p85", unit:"USD"}` | `This trade was a mistake: negative pnl with either elevated counterfactual impact ({impact_abs} >= {impact_p80}) or bias-linked loss magnitude ({loss_abs} >= {loss_abs_p85}).` | `Impact comparison bar`; `Bias-linked loss tag` |
| `MISS` | `((bias_tagged AND pnl > 0 AND post_loss_streak >= 1 AND impact_abs > 0 AND impact_abs >= impact_p90) OR (blocked_risk AND pnl > 0 AND impact_abs > 0 AND impact_abs >= impact_p80))` and no earlier matched grade | `{name:"impact_abs", value_source:"abs(pnl-simulated_pnl)", unit:"USD"}`, `{name:"post_loss_streak", value_source:"derived_from_counterfactual_sequence", unit:"trades"}`, `{name:"blocked_reason", value_source:"counterfactual.csv.blocked_reason", unit:"enum"}` | `This was a miss: positive pnl occurred in a risky context (post-loss or risk-block pressure) with large opportunity delta {impact_abs}.` | `Opportunity-loss card (actual vs simulated)`; `Risk-context badge` |
| `BLUNDER` | `(bias_tagged OR blocked_bias OR blocked_risk) AND (impact_abs > 0) AND (impact_abs >= impact_p95) AND (pnl <= 0)` and no earlier matched grade | `{name:"impact_abs", value_source:"abs(pnl-simulated_pnl)", unit:"USD"}`, `{name:"impact_p95", value_source:"review.json.labeling_rules.thresholds.impact_p95", unit:"USD"}`, `{name:"blocked_reason", value_source:"counterfactual.csv.blocked_reason", unit:"enum"}` | `This is a blunder: bias/risk context with non-positive pnl and high avoidable impact ({impact_abs} >= {impact_p95}).` | `Blunder card: actual vs disciplined replay`; `Bias trigger flags` |
| `MEGABLUNDER` | `(bias_tagged OR blocked_bias OR blocked_risk) AND (impact_abs > 0) AND (impact_abs >= impact_p995) AND (pnl <= 0)` | `{name:"impact_abs", value_source:"abs(pnl-simulated_pnl)", unit:"USD"}`, `{name:"impact_p995", value_source:"review.json.labeling_rules.thresholds.impact_p995", unit:"USD"}`, `{name:"blocked_reason", value_source:"counterfactual.csv.blocked_reason", unit:"enum"}` | `This is a megablunder: extreme avoidable impact in a bias/risk context ({impact_abs} >= {impact_p995}) with non-positive pnl.` | `Top-loss spotlight tile`; `Critical moment timeline context` |

## Special Tags
| Tag | Signature | Template |
|---|---|---|
| `BOOK` | `(rank_in_day <= 3) AND (NOT bias_tagged) AND (NOT near_daily_limit)` | `Book line: early-session disciplined setup (rank {rank_in_day}) without bias or near-limit pressure.` |
| `FORCED` | `blocked_risk OR near_daily_limit` | `Forced context: drawdown/risk pressure was active (blocked_risk={blocked_risk}, near_limit={near_daily_limit}).` |
| `INTERESTING` | `(bias_tagged AND pnl > 0) OR ((NOT bias_tagged) AND impact_abs >= impact_p90 AND size_multiplier >= 1.5)` | `Interesting case: outcome diverged from baseline context (bias-positive win or high-impact high-size move).` |

## Result Labels
Result labels come from two existing fields and must not be reinterpreted:
- `summary.outcome` from `counterfactual.py` (`CHECKMATED`, `WINNER`, `DRAW`, `RESIGN`)
- `job.execution_status` (`PENDING`, `RUNNING`, `COMPLETED`, `FAILED`, `TIMEOUT`)

| Label | Deterministic definition | Source |
|---|---|---|
| `CHECKMATED` | `any(checkmated_day == True)` in replay timeline | `counterfactual.summary.outcome` |
| `WINNER` | `checkmated_day all False` and `delta_pnl > 1e-12` | `counterfactual.summary.outcome` |
| `DRAW` | `checkmated_day all False` and `abs(delta_pnl) <= 1e-12` | `counterfactual.summary.outcome` |
| `RESIGN` | `checkmated_day all False` and `delta_pnl < -1e-12` | `counterfactual.summary.outcome` |
| `ABANDON` | Not emitted by current backend semantics; treat as unsupported/reserved and never synthesize in UI/LLM. | N/A in current code paths |
| `TIMEOUT` | Job run exceeded wall-clock budget and terminal status set to `TIMEOUT`; this is execution status, not a trade-outcome grade. | `job.execution_status` |

## Edge Cases
- No winning trades (loss aversion detector): `detective.py` payoff proxy returns no loss-aversion flags when wins are absent; explanation layer must state that win-based asymmetry metrics are unavailable.
- Single-trade dataset: quantile thresholds collapse to single-point values; grade may be driven by default ordering and sparse context, so explain with explicit threshold values.
- All `pnl = 0`: positive quantiles can become `0`, making `BEST/EXCELLENT` thresholds trivially reachable; explanation must surface threshold value to avoid “arbitrary” perception.
- Normalizer ambiguous preset match warning: when multiple schemas match, deterministic precedence applies (`hyperliquid -> judge -> canonical`); explanations must include warning context if present.
- 20x scale datasets: grading/review path remains vectorized (`O(n)` scans + quantiles); explanation generation should consume precomputed artifacts, not re-run heavy transforms.
