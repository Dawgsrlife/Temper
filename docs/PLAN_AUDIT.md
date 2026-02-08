# PLAN Audit - Architecture and NBC Challenge Alignment

## Architecture Alignment Check

Pipeline target:
`Input -> Normalize -> BiasDetective -> Counterfactual Replay -> Review/Grading -> Artifacts -> API -> UI -> Coach(post-hoc)`

Status:
1. Deterministic core preserved in plans: YES
2. API wrapper-only changes emphasized: YES
3. Coach post-hoc only: YES
4. Artifact-first explainability: YES
5. Refactor freeze under deadline: YES

## NBC Challenge Alignment Check

### 1) Trading History Input
1. CSV upload path: covered
2. XLSX path: explicitly included in PLAN2 TDD
3. Optional manual form path: included in PLAN10 TDD
4. Canonical required columns: enforced in PLAN1

### 2) Bias Detection Components
1. Overtrading:
   - rolling window clustering: covered
   - frequent switching: added in PLAN6 with `F09`
   - post-loss/win bursts: added in PLAN6 with `F09`
2. Loss Aversion:
   - distributional metrics + exemplars: covered
   - no fake winner-extension replay without path data: enforced in PLAN7
3. Revenge Trading:
   - post-loss escalation episode with anchors: covered

### 3) Feedback & Recommendations
1. Bias summaries: covered
2. Graphical insights:
   - timeline/chart: covered
   - heatmap: added in PLAN11
3. Personalized suggestions:
   - user-relative thresholds and metric refs: covered (PLAN14/PLAN19)

### 4) Judging Criteria
1. Performance/scalability:
   - bounded series/downsampling
   - 20x fixture direction (`F08`)
2. Creativity:
   - chess-style move review + timeline + markers + heatmap
3. Behavioral Finance Insight:
   - pattern-first modeling with trade anchors
   - deterministic receipts
4. Personalization:
   - user-relative thresholds, per-user recommendation metrics

## Remaining Risk Areas (Honest)

1. XLSX ingestion may still require implementation time; CSV path is stable baseline.
2. Heatmap is planned and tested in docs but may still need frontend implementation.
3. Manual form path is optional but included as boost; not required if CSV path is solid.
4. Supabase/Uploadthing/Vertex integration quality depends on available credentials/runtime.

## Immediate Priorities

1. Execute PLAN20 in order without refactor detours.
2. Keep gates green at every phase transition.
3. Use `F01` for deterministic baseline and `F05/F09/F08` for robustness/scalability checks.
