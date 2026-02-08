# PLAN16 - CI and Governance TDD

## Goal
Stop regression from parallel agent churn.

## TDD Case 1 (Semantic protection)
Input: intentional change to replay reason string without golden update.
Expected outputs:
1. gate test fails on exact expected reason mismatch

## TDD Case 2 (Payload shape protection)
Input: remove `counterfactual_mechanics` key from moments payload in branch.
Expected outputs:
1. API contract gate fails
2. frontend contract test fails

## TDD Case 3 (Golden update policy)
Input: proposed expected-value update.
Expected outputs required before merge:
1. failing test demonstrating prior expected was wrong
2. fix commit
3. updated golden in same PR
