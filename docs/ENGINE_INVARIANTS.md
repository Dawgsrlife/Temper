# Engine Invariants (v2)

## 1. Canonical Input Resolution
Invariant: `normalize()` must either resolve a valid mapping and proceed, or fail with `ValueError`; partial/ambiguous mapping is invalid.
Enforcement: `backend/app/normalizer.py` (`_resolve_column_mapping`, `_validate_source_columns`).
Test Coverage: `backend/tests/test_normalizer_judge.py::test_judge_csvs_normalize_to_canonical_schema_and_types`, `backend/tests/test_pipeline_guardrails.py::test_judge_schema_without_balance_still_runs` (indirect).
Failure Mode: Wrong columns pass downstream, causing silent misclassification or hard failures.

## 2. Required Canonical Columns Always Present
Invariant: Normalized output must include `timestamp, asset, price, size_usd, side, pnl` (optional `balance` allowed).
Enforcement: `backend/app/normalizer.py` (`REQUIRED_COLUMNS`, `_select_columns`, `_ensure_size_usd`).
Test Coverage: `test_judge_csvs_normalize_to_canonical_schema_and_types`, `test_judge_schema_without_balance_still_runs`.
Failure Mode: `BiasDetective`/`CounterfactualEngine` input contracts break.

## 3. Timestamp Type and Parse Quality
Invariant: `timestamp` must be datetime; if parse failures exceed 5%, normalization must fail.
Enforcement: `backend/app/normalizer.py` (`_parse_timestamp`), downstream dtype guards in `backend/app/detective.py` and `backend/app/counterfactual.py`.
Test Coverage: `test_judge_csvs_normalize_to_canonical_schema_and_types`, `backend/tests/test_data_quality.py::test_data_quality_metrics_smoke`.
Failure Mode: Day bucketing/risk logic becomes undefined and non-deterministic.

## 4. Numeric Coercion Safety
Invariant: Numeric fields used by the engine are numeric and NaN-safe after normalization.
Enforcement: `backend/app/normalizer.py` (`_coerce_numeric`).
Test Coverage: `test_judge_csvs_normalize_to_canonical_schema_and_types`.
Failure Mode: NaNs/objects corrupt cumsums, quantiles, and review metrics.

## 5. Order-Invariant Determinism
Invariant: Row permutation must not change simulation or grading results (after alignment by identity).
Enforcement: Stable sorts in `backend/app/normalizer.py`, `backend/app/risk.py`, `backend/app/counterfactual.py`, `backend/app/review.py`.
Test Coverage: `backend/tests/test_pipeline_guardrails.py::test_shuffle_invariance_counterfactual_outputs`, `backend/tests/test_badge_grading.py::test_badge_labels_are_valid_and_deterministic`.
Failure Mode: Artifact hashes and conclusions change with CSV row order.

## 6. Optional Field Robustness
Invariant: Missing optional fields (notably `balance`) must not break pipeline execution.
Enforcement: Optional judge mapping path in `backend/app/normalizer.py`; no-balance fallback in `backend/app/risk.py`.
Test Coverage: `test_judge_schema_without_balance_still_runs`, `backend/tests/test_risk_recommender.py::test_recommend_daily_max_loss_without_balance_uses_day_pnl_quantiles`.
Failure Mode: Schema drift causes runtime failure.

## 7. Positive Daily Max Loss Threshold
Invariant: Effective daily max loss used by counterfactual must be strictly `> 0`.
Enforcement: `backend/app/risk.py` recommendation logic and guard in `backend/app/counterfactual.py::__init__`.
Test Coverage: `test_recommend_daily_max_loss_with_balance`, `test_recommend_daily_max_loss_without_balance_uses_day_pnl_quantiles` (indirect), constructor guard.
Failure Mode: Risk blocking semantics are invalid or engine fails unpredictably.

## 8. Missing Bias Flags Default to False
Invariant: If `is_revenge`/`is_overtrading` are absent, counterfactual must treat them as all-False.
Enforcement: `backend/app/counterfactual.py::run`.
Test Coverage: `backend/tests/test_counterfactual.py::test_missing_flag_columns_default_to_false`.
Failure Mode: Valid normalized-only inputs crash or over-block.

## 9. Bias Blocking Precedes Risk Blocking
Invariant: Risk breach logic must run on pre-filtered stream after bias-blocking.
Enforcement: `backend/app/counterfactual.py` (`blocked_by_bias` -> `pre_keep` -> breach logic).
Test Coverage: `test_bias_blocking_happens_before_daily_loss_logic`.
Failure Mode: Wrong breach timing and incorrect blocked trade set.

## 10. Daily Max Loss Semantics
Invariant: Breach trade is allowed; only subsequent same-day trades are risk-blocked; reset at day boundary.
Enforcement: `backend/app/counterfactual.py` (`breach_rank`, `first_breach`, `blocked_after_breach`, day floor).
Test Coverage: `test_daily_max_loss_breach_trade_allowed_then_block_same_day_and_reset_next_day`.
Failure Mode: Core strategy policy is violated.

## 11. Closed Blocked Reason Domain
Invariant: `blocked_reason` must be one of `{"NONE","BIAS","DAILY_MAX_LOSS"}` and blocked trades must have `simulated_pnl == 0`.
Enforcement: `backend/app/counterfactual.py` reason assignment and `keep_trade`.
Test Coverage: `test_counterfactual_invariants`, `test_judge_fixtures_pipeline_contract`, `backend/tests/test_invariants_property.py::test_invariants_on_synthetic_property_sets`.
Failure Mode: Review/badge logic receives contradictory state.

## 12. CHECKMATED Equivalence
Invariant: Summary outcome is `CHECKMATED` iff at least one row has `checkmated_day == True`.
Enforcement: `backend/app/counterfactual.py` outcome logic from `day_has_breach`.
Test Coverage: `test_invariants_on_synthetic_property_sets`, `test_daily_max_loss_breach_trade_allowed_then_block_same_day_and_reset_next_day`.
Failure Mode: Top-level result contradicts row-level simulation.

## 13. Delta/Cost Identity
Invariant: `delta_pnl = simulated_total_pnl - actual_total_pnl` and `cost_of_bias = max(0, delta_pnl)`.
Enforcement: `backend/app/counterfactual.py`.
Test Coverage: `test_cost_metric_sign_behavior`, `test_invariants_on_synthetic_property_sets`.
Failure Mode: Scoring and coaching become mathematically wrong.

## 14. Counterfactual Output Contract
Invariant: Required simulation outputs must exist and remain finite (`simulated_pnl`, `simulated_equity`, `simulated_daily_pnl`, block flags/reason/checkmated).
Enforcement: Deterministic column assignment in `backend/app/counterfactual.py`.
Test Coverage: `test_pipeline_end_to_end_judge_defaults`, `test_invariants_on_synthetic_property_sets`.
Failure Mode: Artifact generation and consumers break.

## 15. Closed Trade Grade Taxonomy
Invariant: `trade_grade` must always be one of the 10 allowed labels; `special_tags` must be present and non-null.
Enforcement: `backend/app/review.py` (`TRADE_GRADES`, `apply_trade_grades`).
Test Coverage: `test_badge_labels_are_valid_and_deterministic`, `test_grade_columns_present_in_judge_pack_outputs`, `test_review_adapter_contract_and_determinism`.
Failure Mode: Badge analytics/review schema invalid.

## 16. Deterministic Grading Under Shuffle
Invariant: Same trades in different row order must produce identical `trade_grade` and `special_tags`.
Enforcement: Stable sorting + `_orig_order` restoration in `backend/app/review.py`.
Test Coverage: `test_badge_labels_are_valid_and_deterministic`, `test_shuffle_invariance_counterfactual_outputs`.
Failure Mode: Badge counts/examples drift between runs.

## 17. Bounded Review Payload Shape
Invariant: Review payload keys are stable and top-moment context is bounded by configured window.
Enforcement: `backend/app/review.py` (`top_n`, `critical_window`); fixed review schema.
Test Coverage: `test_review_adapter_contract_and_determinism`, `test_review_includes_labeling_rules_and_sections`.
Failure Mode: Unstable API contract or unbounded review payload growth.

## 18. Judge Pack Grade Columns in Artifacts
Invariant: `judge_pack` output `counterfactual.csv` must include `trade_grade` and `special_tags`.
Enforcement: `backend/scripts/judge_pack.py` calls `apply_trade_grades` before write.
Test Coverage: `test_grade_columns_present_in_judge_pack_outputs`.
Failure Mode: Chess-style grading absent from export artifacts.

## 19. Deterministic Data Quality Accounting
Invariant: Data quality metrics/warnings must deterministically reflect raw counts (missing assets, nonpositive price/size, invalid/duplicate/out-of-order timestamps, pnl coercions).
Enforcement: `backend/app/data_quality.py`.
Test Coverage: `test_data_quality_metrics_smoke`.
Failure Mode: Warning layer becomes untrustworthy and misleading.

## 20. Job Hash Integrity
Invariant: `input_sha256` must be deterministic for identical bytes and change on content change.
Enforcement: `backend/app/job_store.py::file_sha256`.
Test Coverage: `test_job_record_input_hash_determinism`.
Failure Mode: Duplicate detection/audit identity becomes invalid.

## 21. Job Persistence Roundtrip Integrity
Invariant: Job write/read roundtrip must preserve all job fields exactly.
Enforcement: `backend/app/job_store.py` (`LocalJobStore.write/read`, `JobRecord.from_dict`).
Test Coverage: `test_job_write_read_roundtrip`.
Failure Mode: Persistent history becomes corrupted or non-reproducible.
