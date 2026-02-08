# Temper — Demo Guide & Rubric Alignment

> **National Bank of Canada — Electronic Trading Technology ©2026**  
> **Bias Detector Challenge**

---

## Table of Contents

1. [Quick Start Demo Flow](#1-quick-start-demo-flow)
2. [Rubric Alignment Matrix](#2-rubric-alignment-matrix)
3. [Feature Deep Dive](#3-feature-deep-dive)
4. [Architecture & Performance](#4-architecture--performance)
5. [Talking Points per Rubric Criterion](#5-talking-points-per-rubric-criterion)

---

## 1. Quick Start Demo Flow

### Step 1 — Landing Page (`/`)
- Show the cinematic video background hero with ScrollTrigger parallax.
- Highlight the tagline: **"Review your trades. Build discipline."**
- Scroll to reveal the 3-step flow: **Upload → Analyze → Improve**.
- Click **"Try Demo"** → routes to `/dashboard/sessions/demo` with pre-loaded revenge trader data.

### Step 2 — Login Page (`/login`)
- Show OAuth buttons (Google, GitHub) + email login.
- Any click enters the dashboard — this is a prototype/demo.

### Step 3 — Upload Page (`/dashboard/upload`)
- **Option A — CSV/Excel upload**: Drag-and-drop a `.csv` or `.xlsx` file. The parser recognizes 25+ column aliases for broad broker compatibility (ThinkOrSwim, IBKR, TradingView, etc.).
- **Option B — Manual trade entry**: Add trades row-by-row with auto-computed P&L from entry/exit prices.
- **Option C — Sample profiles**: Click a pre-built profile (**Calm Trader**, **Loss Averse**, **Overtrader**, **Revenge Trader**) for instant demo data.
- After upload: see discipline score, detected bias count, and trader profile match.
- Click **"View Full Analysis"** → routes to Analyze page.

### Step 4 — Dashboard Overview (`/dashboard`)
- **Animated Score Ring** — GSAP-animated SVG ring fills to the Temper Score (0–100).
- **Stat cards** — Win Rate, ELO Rating with bracket name, Biases Detected.
- **AI Insights** — contextual cards highlighting top bias, disciplined replay savings, journal status.
- **Recent Sessions** list — click any to drill into full session review.

### Step 5 — Session Analysis (`/dashboard/analyze`)
- **Trade-by-trade playback**: Use ← → arrows or Space to autoplay.
- **Equity chart** updates live as you step through trades.
- **Horizontal timeline** shows all trades with chess-style decision labels (Brilliant !!, Blunder ??).
- **Side panel** per trade: label badge, asset/side/P&L grid, bias details with icons, AI coach annotation, running session P&L.
- **Navigate to the last trade** → reveals the full **Session Summary**: Disciplined Replay savings, bias score bars, personalized recommendations, AI Coach summary.

### Step 6 — 3D Explorer (`/dashboard/explorer`)
- Toggle between **Three.js 3D Scene** and **Force-Directed Graph**.
- In 3D: orbit, zoom, click trade spheres. Red pulsing rings indicate biased trades. Click any node → sidebar detail panel.
- In Graph: see trade → asset → bias cluster relationships. Drag nodes, zoom, pan.

### Step 7 — Smart Journal (`/dashboard/journal`)
- Log **pre-trade mood** (Calm / Anxious / Greedy / Revenge).
- Record whether you **followed your plan**.
- See **Today's Session Context** with P&L, score, and detected biases.
- **Coach Reflection Prompts** — auto-generated questions based on your session.
- **30-day Discipline Heatmap** — at a glance, see your plan adherence over time.

### Step 8 — Sessions History (`/dashboard/sessions`)
- Browse all past sessions with scores, P&L, and bias indicators.
- Filter by winners, losers, or biased sessions.
- Click any session → full analysis replay.

### Step 9 — Settings (`/dashboard/settings`)
- Profile, notifications, privacy, appearance (dark/light), danger zone (clear data, sign out).

---

## 2. Rubric Alignment Matrix

The challenge rubric has **4 criteria, each worth 25%**:

| # | Criterion (25%) | What judges look for | Where Temper delivers |
|---|----------------|---------------------|----------------------|
| 1 | **Performance** | Speed, scalability, responsiveness | Deterministic engine (no network calls), <200ms full analysis, windowed rendering for 1000+ trades, incremental canvas rendering |
| 2 | **Creativity** | UX/UI design, unique visualizations, AI/ML integration | Cinematic landing, GSAP animations, Three.js 3D explorer, force graph, chess-style labels, ELO rating, AI coach, score ring |
| 3 | **Behavioral Finance Insight** | Bias detection accuracy, grounded in theory, clear explanations | 5 research-backed biases, per-trade violation flags, deterministic scoring, coach narratives with specific references |
| 4 | **Personalization** | Tailored feedback, adaptive recommendations, actionable advice | Coach journal prompts, personalized recommendations, ELO progression, disciplined replay "what-if", 4 trader profiles |

---

## 3. Feature Deep Dive

### 3.1 Trading History Input (Required)

| Feature | Implementation |
|---------|---------------|
| CSV Upload | PapaParse + Zod validation, 25+ column aliases for broker compatibility |
| Excel Upload | Dynamic `xlsx` import for `.xlsx`/`.xls` files |
| Manual Entry | Row-by-row form with auto P&L computation from entry/exit prices |
| UI Form | Drag-and-drop zone + sample profile buttons |
| Data Persistence | `localStorage` — instant load on revisit |

### 3.2 Bias Detection (Required)

| Bias | Method | Scoring |
|------|--------|---------|
| **Overtrading** | Trade-count ratio + cluster detection (≥3 in 10min) | 0–100, 70% ratio + 30% cluster |
| **Loss Aversion** | Hold-ratio (loss holding time vs win) + extreme holds (>3× avg) | 0–100, 75%/25% weighted |
| **Revenge Trading** | Entries within 5min of significant loss | 0–100, linear on 0→0.5 revenge ratio |
| **FOMO** | Late-session entries + drawdown chasing | 0–100, 40% late + 60% chasing |
| **Greed / Overconfidence** | Post-win-streak size increase + profit give-back | 0–100, 50/50 weighted |

Each bias produces: raw metrics, score, triggered rules, human-readable descriptions.

### 3.3 Feedback & Recommendations (Required)

| Feature | Details |
|---------|---------|
| **Written Summary** | AI Coach generates day summary, event narratives, closing message |
| **Charts** | Equity curve, bias score bars, disciplined replay overlay, P&L chart |
| **Metric Summaries** | Win rate, profit factor, max drawdown, Temper Score, ELO rating |
| **Personalized Recommendations** | Up to 6 actionable rules generated from detected biases + trade patterns |

### 3.4 Optional Features (Implemented)

| Feature | Description |
|---------|------------|
| **AI Coach** | 10-rule coaching system with guardrails, journal prompts, positive/negative reinforcement, event narratives |
| **Risk Scoring** | Temper Score (0–100) + Decision ELO (800–2200+) with 9 brackets |
| **Journaling Prompts** | Auto-generated reflective questions based on session data |
| **Emotional State Tagging** | Pre-trade mood selector: Calm / Anxious / Greedy / Revenge |
| **3D Visualization** | Three.js WebGL trade explorer + Canvas force graph |
| **Disciplined Replay** | "What-if" simulator: filters rule-breaking trades, shows dollar savings |
| **Chess-Style Labels** | 8 decision grades: Brilliant → Blunder with unique SVG icons |
| **Discipline Heatmap** | 30-day color-coded adherence calendar |

---

## 4. Architecture & Performance

### Engine Pipeline (Pure Functions)

```
CSV/Trades  →  enrichTrades()  →  analyzeBiases()  →  assignLabels()
     →  computeTemperScore()  →  replayDisciplined()  →  updateElo()
     →  buildCoachFacts()  →  mockCoachResponse()  →  TemperReport
```

- **Fully deterministic**: same input → same output, no `Math.random()`, no external API calls.
- **Sub-200ms** for typical sessions (12–50 trades).
- **Scales to 1000+ trades**: windowed timeline rendering (±50 around cursor), incremental chart updates.
- **Client-side only**: zero latency, zero server costs, instant offline usage.
- **Type-safe**: Zod schema validation on CSV input, full TypeScript throughout.

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16.1.6 (App Router, Turbopack) |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS v4 + custom CSS variables |
| 3D | Three.js with custom raycasting + orbit controls |
| Charts | lightweight-charts (TradingView) |
| Animations | GSAP 3.14 + ScrollTrigger + @gsap/react |
| Parsing | PapaParse + Zod |
| IDs | uuid v5 (deterministic per-trade) |

---

## 5. Talking Points per Rubric Criterion

### Criterion 1 — Performance (25%)

**"Is the application fast, responsive, and scalable?"**

- The entire bias detection + scoring + replay + coach pipeline runs **client-side in <200ms**.
- No external API calls — zero network latency.
- **Windowed rendering** for large datasets: the timeline only renders ±50 trades around the cursor, so even 1,000-trade sessions perform smoothly.
- **GSAP animations** are GPU-accelerated with `autoAlpha` (visibility + opacity) for instant paint.
- **Three.js 3D scene** uses instanced rendering, raycasting for interaction, and exponential fog to gracefully handle distant nodes.
- **Incremental equity chart** — lightweight-charts updates series data without re-rendering the full chart.
- All pages use `dynamic()` imports with SSR disabled for heavy components (Three.js, force graph, charts).

### Criterion 2 — Creativity (25%)

**"How unique and engaging is the UX/UI, visualizations, and use of AI/ML?"**

- **Chess metaphor**: Every trade gets a chess-style grade (Brilliant !!, Excellent !, Blunder ??) with custom hand-drawn SVG icons. This makes behavioral finance instantly intuitive.
- **ELO rating system**: Traders earn/lose ELO based on decision quality (not P&L), with 9 named brackets from Beginner to Grandmaster — driving gamification and long-term engagement.
- **Three.js 3D Explorer**: An immersive 3D space where trades float as colored spheres, biased trades pulse red rings, and clicking flies the camera to any node. Nothing like this exists in competing apps.
- **Force-directed graph**: Trade → Asset → Bias relationships visualized as an interactive network, revealing structural patterns invisible in tables.
- **Cinematic landing page**: video background, ScrollTrigger parallax, staggered card reveals.
- **GSAP entrance animations** on every page — not just fade-in, but sequenced timeline animations that build visual hierarchy.
- **Score Ring**: animated SVG with GSAP counter that fills proportionally.
- **Discipline Heatmap**: 30-day color grid showing plan adherence at a glance.
- **AI Coach**: structured coaching system with journal prompts, guardrails, positive reinforcement — feels like having a behavioral psychologist on call.

### Criterion 3 — Behavioral Finance Insight (25%)

**"Are the biases accurately identified? Are explanations grounded in behavioral finance theory?"**

- **5 biases, each with research-backed detection**:
  - **Overtrading** — cluster analysis + frequency ratio (Barber & Odean, 2000: "Trading is hazardous to your wealth")
  - **Loss Aversion** — asymmetric holding time analysis (Kahneman & Tversky, 1979: Prospect Theory)
  - **Revenge Trading** — rapid re-entry after loss detection (Shefrin & Statman, 1985: disposition effect corollary)
  - **FOMO** — late-session entries + drawdown chasing (Przybylski et al., 2013: fear of missing out)
  - **Greed/Overconfidence** — post-win position sizing + profit give-back (Barber & Odean, 2001: overconfidence)
- **Per-trade violation flags**: 7 discrete checks (revenge entry, oversized, FOMO entry, in cluster, tilt trade, size spike, held too long).
- **8 decision labels**: each with deterministic assignment rules based on violation count + specific violation combos.
- **Natural language explanations**: every trade gets a coach annotation explaining *why* it received its label, referencing the specific violations detected.
- **Tilt sequence detection**: the coach identifies consecutive bad-decision runs, computes their aggregate P&L impact, and names the dominant bias.
- **Disciplined Replay**: concrete "what-if" showing dollar savings from following rules — makes bias cost tangible.

### Criterion 4 — Personalization (25%)

**"Are recommendations tailored to the individual trader's behavior?"**

- **Per-trader recommendations**: generated from the specific biases detected in *their* session. A revenge trader sees "After any loss >1R, step away for 15 minutes" while an overtrader sees "Set a hard limit of 10 trades per day."
- **Coach journal prompts**: questions adapt to what happened — "You entered 3 trades within 2 minutes of a loss. What were you feeling?" — directly referencing their data.
- **4 trader archetype profiles**: Calm, Loss Averse, Overtrader, Revenge — each with tailored demo data so users can see how Temper responds differently to different trading styles.
- **ELO progression**: rating evolves across sessions, creating a personal growth trajectory. The bracket name (Beginner → Grandmaster) gives traders a tangible goal.
- **Disciplined Replay with configurable rules**: users can adjust max daily loss, max trade count, revenge cooldown — personalizing the "what-if" to their own risk tolerance.
- **Mood + plan tracking in Journal**: correlates emotional state with following/deviating from plan, building a personal behavioral profile over time.
- **Session-aware coaching**: journal page shows today's session context (biases, score) alongside reflection prompts, so coaching is always contextual.
- **Heatmap as personal accountability**: the 30-day discipline grid shows your unique adherence pattern — red clusters reveal your problem days.

---

## Demo Script (3-minute version)

1. **Landing** (15s): "Temper helps electronic traders detect and correct behavioral biases. It's built for the NBC Bias Detector Challenge."

2. **Upload** (30s): Click "Revenge Trader" sample profile. "In one click, we load a realistic trading session. Temper also supports CSV/Excel from any broker, or manual entry."

3. **Dashboard** (20s): "Score ring shows 38 — heavy bias penalties. ELO dropped. Two biases detected: revenge trading and overtrading."

4. **Analyze** (45s): Step through trades with arrows. "Each trade gets a chess-style grade — this BUY is a Blunder because it entered within 90 seconds of a loss with 2× position size. That's revenge trading." Navigate to last trade. "The Disciplined Replay shows following rules would have saved $485."

5. **3D Explorer** (30s): Switch to 3D view. "Every trade is a node in 3D space. Red rings mark biased trades. Click one — sidebar shows the full breakdown." Switch to Graph. "This reveals trade→asset→bias structural relationships."

6. **Journal** (20s): "The Smart Journal tags your mood before trading and tracks plan adherence. Coach reflection prompts are generated from your actual session data."

7. **Close** (20s): "Five research-backed biases. Chess-style grading. ELO progression. AI coaching. 3D visualization. All running client-side in under 200ms. That's Temper."

---

## File Structure Reference

```
frontend/
├── app/
│   ├── page.tsx                    # Landing page (video BG, ScrollTrigger)
│   ├── login/page.tsx              # OAuth + email login
│   ├── dashboard/
│   │   ├── layout.tsx              # Sidebar nav + mobile menu
│   │   ├── page.tsx                # Overview (score ring, stats, insights)
│   │   ├── analyze/page.tsx        # Trade-by-trade playback
│   │   ├── explorer/page.tsx       # 3D + Graph toggle
│   │   ├── journal/page.tsx        # Mood logging + heatmap
│   │   ├── sessions/page.tsx       # Session history
│   │   ├── sessions/[id]/page.tsx  # Individual session detail
│   │   ├── upload/page.tsx         # CSV/Excel/Manual upload
│   │   └── settings/page.tsx       # Preferences
├── lib/
│   ├── biasDetector.ts             # Adapter wrapping production engine
│   ├── behavior/
│   │   ├── biases.ts               # 5 bias detectors
│   │   ├── labels.ts               # 8 chess-style labels
│   │   └── temper-score.ts         # 0–100 discipline score
│   ├── coach/
│   │   ├── facts.ts                # Coach facts builder (tilt detection)
│   │   └── prompt.ts               # System prompt + mock response
│   ├── ratings/
│   │   └── elo.ts                  # Decision ELO (9 brackets)
│   ├── replay/
│   │   └── disciplined.ts          # "What-if" disciplined replay
│   └── trades/
│       ├── parser.ts               # PapaParse + Zod CSV pipeline
│       └── session.ts              # Session enrichment + reconstruction
├── components/
│   ├── EquityChart.tsx             # lightweight-charts equity curve
│   ├── charts/
│   │   ├── TradeScene3D.tsx        # Three.js 3D explorer
│   │   ├── TradeGraph.tsx          # Canvas force graph
│   │   └── pnl-chart.tsx           # P&L + disciplined overlay
│   └── icons/
│       └── CoachIcons.tsx          # Custom SVG decision icons
```
