# Temper — Architecture

## System Overview

Temper is structured as a layered pipeline where each layer has a single responsibility and clear input/output contracts. **All scoring and labeling is deterministic** — the AI/LLM layer is only permitted to consume structured facts for explanation.

```
CSV Upload
    │
    ▼
┌─────────────────┐
│ Ingestion Layer │  lib/trades/parser.ts
│ (Parse + Validate)│
└────────┬────────┘
         │ RawTrade[]
         ▼
┌─────────────────┐
│ Session Recon    │  lib/trades/session.ts
│ (Enrich + Group) │
└────────┬────────┘
         │ Session (with Trade[])
         ▼
┌─────────────────┐
│ Behavior Engine  │  lib/behavior/
│ (Biases + Labels)│
└────────┬────────┘
         │ BiasScores + DecisionEvent[] + TemperScore
         ▼
┌─────────────────┐
│ ELO System       │  lib/ratings/elo.ts
│ (Rating Update)  │
└────────┬────────┘
         │ DecisionEloState
         ▼
┌─────────────────┐
│ Disciplined      │  lib/replay/disciplined.ts
│ Replay Engine    │
└────────┬────────┘
         │ DisciplinedSessionResult
         ▼
┌─────────────────┐
│ Coach Facts      │  lib/coach/facts.ts
│ Builder          │
└────────┬────────┘
         │ CoachFactsPayload
         ├──────────────────────┐
         ▼                      ▼
┌─────────────────┐  ┌─────────────────┐
│ UI / Frontend    │  │ LLM Coach Layer │
│ (Next.js App)    │  │ (Explanation)    │
└─────────────────┘  └─────────────────┘
```

## Layer Details

### 1. Ingestion Layer (`lib/trades/parser.ts`)

**Input:** CSV text  
**Output:** `RawTrade[]`

- Parses CSV with PapaParse
- Validates each row against a Zod schema
- Normalizes column aliases (e.g., `ticker` → `symbol`, `BUY` → `LONG`)
- Sorts by timestamp
- Does NOT compute any derived fields

### 2. Session Reconstruction (`lib/trades/session.ts`)

**Input:** `RawTrade[]` + `UserBaseline`  
**Output:** `Session` (containing enriched `Trade[]`)

Enriches each trade with:
- `runningPnl` — cumulative P/L at this point
- `drawdownFromPeak` — how far below peak (≤ 0)
- `timeSinceLastTradeMs` — gap to previous trade
- `sizeRelativeToBaseline` — quantity / baseline avg
- `isWin` — whether P/L > 0

Groups trades by day (YYYY-MM-DD) into Session objects with aggregate stats (win rate, profit factor, max drawdown, etc.).

### 3. Behavior Engine (`lib/behavior/`)

**Input:** `Session` + `UserBaseline`  
**Output:** `BiasScores` + `BiasDetail[]` + `DecisionEvent[]` + `TemperScore`

#### Bias Detection (`biases.ts`)

Five biases, each scored 0–100:

| Bias | Primary Metric | Threshold Range | Formula |
|------|---------------|-----------------|---------|
| **Overtrading** | `tradeCount / baseline` | 1.0 → 3.0 | 70% ratio + 30% cluster count |
| **Loss Aversion** | `avgLossHolding / avgWinHolding` | 1.2 → 4.0 | 75% holding ratio + 25% extreme holds |
| **Revenge Trading** | `revengeEntries / postLossTrades` | 0.0 → 0.5 | Linear on revenge ratio |
| **FOMO** | Late entries + chasing | 0.15 → 0.5 | 40% late + 60% chasing |
| **Greed** | Size increase after streak + profit giveback | 1.0 → 3.0 / 0.1 → 0.6 | 50% size + 50% giveback |

Aggregate = mean of all five scores.

#### Trade Labeling (`labels.ts`)

Each trade is evaluated for violations:

| Violation | Rule |
|-----------|------|
| Revenge entry | Within 5 min of a significant loss (≤ median) |
| Oversized | > 1.5× baseline position size |
| FOMO entry | In last 20% of session OR after 2+ consecutive losses in drawdown |
| Cluster | Part of ≥ 3 trades within 10 min window |
| Tilt | Trading past running P/L worse than 5× avg loss |
| Size spike | > 2× baseline after 3+ win streak |
| Held too long | Previous loser held > 3× average time |

Label assignment:

| Label | Rule |
|-------|------|
| **BLUNDER** (??) | 3+ violations OR (tilt AND revenge) |
| **MISTAKE** (?) | 2 violations OR (revenge AND oversized) OR size spike |
| **INACCURACY** (?!) | 1 violation |
| **BOOK** (📖) | No violations, trade was a loss (disciplined loss) |
| **GOOD** (!?) | No violations, profitable |
| **EXCELLENT** (!) | No violations, profitable, clean risk management |
| **BRILLIANT** (!!) | No violations, profitable, under pressure (in drawdown), tight sizing |

#### Temper Score (`temper-score.ts`)

```
Per-trade weight (0–10 scale):
  BRILLIANT: 10, EXCELLENT: 9, GOOD: 7.5, BOOK: 8
  INACCURACY: 5, MISTAKE: 3, BLUNDER: 0, MISSED_WIN: 4

rawScore    = mean(weights) × 10          → 0–100
biasPenalty = (sum(biasScores) / 500) × 20 → 0–20
value       = clamp(rawScore − biasPenalty, 0, 100)
```

### 4. Decision ELO (`lib/ratings/elo.ts`)

ELO-like rating for decision quality (not P/L):

```
Starting rating:  1200
K-factor:         max(16, 40 − sessions × 0.8)    → 40→16 decay
Expected perf:    E = 1 / (1 + 10^((1500 − R)/400))
Actual perf:      S = mean(eloValue per trade)
Update:           R' = R + K × (S − E)
```

ELO values per label: BRILLIANT=1.0, EXCELLENT=0.9, GOOD=0.75, BOOK=0.8, INACCURACY=0.5, MISTAKE=0.3, BLUNDER=0.0, MISSED_WIN=0.4

Rating brackets: Beginner (<800) → Novice → Developing → Intermediate → Proficient → Advanced → Expert → Master → Grandmaster (2200+)

### 5. Disciplined Replay (`lib/replay/disciplined.ts`)

Replays the same trade sequence under strict rules:

| Rule | Default |
|------|---------|
| Max daily loss | -$500 |
| Max trades/day | 10 |
| Revenge window | 15 min cooldown after loss |
| Max position size | 1.5× baseline |
| Late cutoff | Configurable |

Each trade is tested against rules in order. Failed trades are pruned. Output: `DisciplinedSessionResult` with original vs disciplined P/L and savings.

### 6. Coach Facts (`lib/coach/facts.ts`)

Transforms the full report into `CoachFactsPayload`:

- **overview** — date, score, ELO, trade count, win rate, P/L, drawdown
- **biases** — type, score, isTriggered, topMetric
- **labelSummary** — label, symbol, count, percentage
- **keyEvents** — top 8 by severity, with index, timestamp, label, reasons, P/L
- **tiltSequences** — consecutive bad decisions with duration and dominant bias
- **disciplinedReplay** — original vs disciplined P/L and savings
- **streaks** — best and worst consecutive sequences

### 7. LLM Coach (`lib/coach/prompt.ts`)

- Consumes ONLY `CoachFactsPayload`
- Produces natural-language narratives, reinforcement, guardrails, journal prompts
- System prompt enforces strict rules: no inventing numbers, no trading signals
- Mock implementation available for development

## Folder Structure

```
├── app/
│   ├── (marketing)/page.tsx         ← Landing page
│   ├── (dashboard)/
│   │   ├── layout.tsx               ← Sidebar navigation
│   │   ├── upload/page.tsx          ← CSV upload
│   │   ├── overview/page.tsx        ← Dashboard
│   │   └── sessions/[id]/page.tsx   ← Temper Review
│   ├── api/
│   │   ├── upload/route.ts          ← POST CSV
│   │   ├── analyze/route.ts         ← POST trigger analysis
│   │   ├── reports/[id]/route.ts    ← GET report
│   │   └── history/route.ts         ← GET score + ELO history
│   ├── layout.tsx                   ← Root layout
│   └── globals.css                  ← Tailwind v4 theme
│
├── lib/
│   ├── types.ts                     ← All domain types + constants
│   ├── utils.ts                     ← cn(), formatCurrency(), etc.
│   ├── trades/
│   │   ├── parser.ts                ← CSV → RawTrade[]
│   │   └── session.ts               ← RawTrade[] → Session
│   ├── behavior/
│   │   ├── biases.ts                ← 5 bias scorers
│   │   ├── labels.ts                ← Trade → DecisionLabel
│   │   ├── temper-score.ts          ← Labels → TemperScore
│   │   └── engine.ts                ← Orchestrator
│   ├── ratings/
│   │   └── elo.ts                   ← Decision ELO system
│   ├── replay/
│   │   └── disciplined.ts           ← Disciplined replay
│   ├── coach/
│   │   ├── facts.ts                 ← Report → CoachFactsPayload
│   │   └── prompt.ts                ← LLM prompt + mock coach
│   └── db/
│       └── prisma.ts                ← Prisma client singleton
│
├── components/
│   ├── upload/csv-dropzone.tsx       ← Client: drag-drop upload
│   ├── review/
│   │   ├── trade-timeline.tsx        ← Client: interactive timeline
│   │   ├── trade-card.tsx            ← Trade detail card
│   │   └── decision-badge.tsx        ← Decision label badge
│   └── dashboard/
│       ├── temper-score-card.tsx      ← Score display
│       ├── elo-chart.tsx             ← Client: ELO line chart
│       └── bias-breakdown.tsx        ← Bias bar chart
│
├── prisma/schema.prisma             ← Database schema
├── tests/                           ← Unit + integration tests
└── .github/workflows/ci.yml         ← CI pipeline
```

## Server vs Client Components

| Component | Type | Reason |
|-----------|------|--------|
| Dashboard layout | Server | Static shell, sidebar nav |
| Overview page | Server | Fetches data, renders cards |
| Session review page | Server | Fetches report data |
| TradeTimeline | **Client** | Keyboard nav, stepping through trades |
| CsvDropzone | **Client** | File input, upload state machine |
| EloChart | **Client** | Recharts interactive chart |
| BiasBreakdown | Server | Pure HTML/CSS bars |
| TemperScoreCard | Server | Static display |
| DecisionBadge | Server | Pure presentational |

## Hackathon Plan (36 hours)

### Backend Dev (18h)

| Hours | Task |
|-------|------|
| 0–2 | `npm install`, Prisma setup, DB connection, seed data |
| 2–6 | Implement `parser.ts` + `session.ts` + tests |
| 6–10 | Implement `biases.ts` + `labels.ts` + tests |
| 10–13 | Implement `temper-score.ts` + `elo.ts` + `disciplined.ts` |
| 13–15 | Wire `engine.ts` orchestrator + integration tests |
| 15–17 | API routes: `/upload`, `/analyze`, `/reports/[id]`, `/history` |
| 17–18 | Coach facts builder + mock coach |

### Frontend Dev (18h)

| Hours | Task |
|-------|------|
| 0–2 | Tailwind theme, layout, landing page |
| 2–5 | Upload page + CsvDropzone (with API wiring) |
| 5–9 | **Temper Review screen** — TradeTimeline + TradeCard + DecisionBadge |
| 9–12 | Overview dashboard — TemperScoreCard + EloChart + BiasBreakdown |
| 12–15 | Disciplined replay comparison UI |
| 15–17 | Coach screen (display mock coach output) |
| 17–18 | Polish, responsive fixes, demo prep |

### What to stub

- **Auth**: Use fixed `demo-user` ID, add Clerk/NextAuth later
- **LLM coach**: Use `mockCoachResponse()`, wire real LLM post-hackathon
- **MISSED_WIN**: Requires plan data we don't have yet — skip for MVP
- **R-multiples**: Requires stop-loss data — leave as `null`
