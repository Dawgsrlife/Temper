# Review Selector Policy

This policy defines deterministic signal compression for top moments.

## Purpose

When one bias dominates (for example overtrading bursts), avoid repetitive top-moment spam and preserve representative insight diversity.

## Selection Order (Top 3)

1. Highest-impact `revenge` moment.
2. Highest-impact `overtrading` moment.
3. Highest-impact `loss aversion` exemplar.

Fallback: if any category is absent, fill remaining slots by descending impact while keeping deterministic tie-breaks (timestamp, asset, source index).

## Human-First Rule

Each selected moment must include:

1. `explanation_human` as first-line layman text.
2. `evidence` with:
   - `rule_signature`
   - `metric_refs`
   - deterministic rule-hit details.

## Inspector Anchor Contract

The first selected moment is the default inspector anchor.
Use `trace_trade_id` to fetch `/jobs/{id}/trade/{trace_trade_id}` and avoid random/default trade selection.

## Bias Coverage Targets

When present in data, include representative moments from:

1. revenge trading
2. overtrading
3. loss aversion

This policy is deterministic and independent of any LLM output.
