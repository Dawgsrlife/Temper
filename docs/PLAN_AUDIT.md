# PLAN Audit - Architecture and NBC Challenge Alignment

## Architecture Alignment Check

Pipeline target:
`Input -> Normalize -> BiasDetective -> Counterfactual Replay -> Review/Grading -> Artifacts -> API -> UI -> Coach(post-hoc)`

Status:
1. Deterministic core preserved in plans: YES
2. API wrapper-only changes emphasized: YES
3. Coach post-hoc only: YES
4. Coach payload carries deterministic personalization metrics: YES
5. Artifact-first explainability: YES
6. Refactor freeze under deadline: YES
7. Required service seams covered by gates (Uploadthing/Supabase/Vertex): YES (PLAN15)
8. CI governance + golden-change policy gate: YES (PLAN16 with `F21`)
9. Fixture catalog + determinism audit gate: YES (PLAN17 with `F22`)
10. Review selector signal-compression gate: YES (PLAN18 with `F23`)
11. Judge demo script HTTP contract gate: YES (PLAN19 with `F24`)
12. Final rubric board gate with unseen-scale fixture: YES (PLAN20 with `F25`)

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
   - heatmap: backend contract implemented (`/jobs/{id}/counterfactual/heatmap`) + PLAN11 gate
3. Personalized suggestions:
   - user-relative thresholds and metric refs: covered (PLAN14/PLAN19)
4. Deterministic move explanations:
   - contract-backed renderer available via `/jobs/{id}/move-review` (PLAN13)

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
   - deterministic per-session ELO progression contract (PLAN12)
   - coach numeric-drift rejection contract (PLAN14 with `F19`)
5. Required integrations:
   - uploadthing ingest + signature rejection contract (PLAN15 with `F20`)
   - supabase lifecycle/coach-status persistence contract (PLAN15)
6. Delivery reliability:
   - semantic/payload contract freeze gate on real fixture (`F21`)
   - explicit golden update policy document (`docs/GOLDEN_CHANGE_POLICY.md`)
   - fixture matrix truth table and repeated-run determinism checks (`docs/FIXTURE_CATALOG.md`, `F22`)
   - selector diversity + representative anchoring policy (`docs/REVIEW_SELECTOR_POLICY.md`, `F23`)
   - judge walkthrough script emits personalized evidence + structured failure metadata (`F24`)
   - final rubric + unseen-scale readiness validated (`F25`)

## Remaining Risk Areas (Honest)

1. XLSX ingestion may still require implementation time; CSV path is stable baseline.
2. Heatmap backend contract is ready; frontend rendering integration is still required.
3. Manual form path is optional but included as boost; not required if CSV path is solid.
4. Supabase/Uploadthing/Vertex integration quality depends on available credentials/runtime.

## Immediate Priorities

1. Execute PLAN20 in order without refactor detours.
2. Keep gates green at every phase transition.
3. Use `F01` for deterministic baseline and `F05/F09/F08` for robustness/scalability checks.
