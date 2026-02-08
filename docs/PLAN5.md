# PLAN5 - Architecture Freeze TDD

## Goal
Prevent semantic churn while shipping.

## Frozen modules
1. normalization formulas
2. bias detection formulas
3. counterfactual mechanics formulas (unless golden fails)
4. grading taxonomy definitions

## TDD Case 1 (Freeze check)
Input: run F01 before and after router/UI changes.
Expected outputs:
1. identical replay rows
2. identical summary metrics
3. identical moments (ordering + labels)

## TDD Case 2 (Allowed wrapper change)
Input: add route alias `/api/jobs/{id}`.
Expected outputs:
1. payload matches `GET /jobs/{id}` exactly for same id
2. no engine artifact changes
