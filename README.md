# Temper

**Behavioral trading journal and discipline coach for day traders.**

Like chess.com's Game Review + Coach — but for trading decisions. Upload your trades, get a Temper Score, see your blunders (??), and build discipline over time.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env.local
# Edit .env.local with your DATABASE_URL

# 3. Generate Prisma client & push schema
npm run db:generate
npm run db:push

# 4. Start dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## CSV Format

Upload a CSV with these columns (aliases supported):

| Column    | Required | Aliases                          |
| --------- | -------- | -------------------------------- |
| timestamp | ✅       | time, date, datetime             |
| symbol    | ✅       | ticker, instrument               |
| side      | ✅       | direction, type (LONG/SHORT/BUY/SELL) |
| qty       | ✅       | quantity, size, shares            |
| price     | ✅       | avg_price, fill_price            |
| pnl       | ✅       | p/l, profit, realized_pnl       |
| tags      | ❌       | labels, notes                    |

## Decision Labels

| Label      | Symbol | Meaning                                  |
| ---------- | ------ | ---------------------------------------- |
| BRILLIANT  | !!     | Perfect execution under adverse conditions |
| EXCELLENT  | !      | Clean execution, good risk management    |
| GOOD       | !?     | Disciplined, profitable                  |
| BOOK       | 📖     | Textbook execution (even if a loss)      |
| INACCURACY | ?!     | Minor deviation (1 violation)            |
| MISTAKE    | ?      | Clear rule violation (2 violations)      |
| BLUNDER    | ??     | Catastrophic discipline failure (3+)     |
| MISSED_WIN | ⨯      | Opportunity identified but not taken     |

## Tech Stack

- **Framework:** Next.js 15+ (App Router, RSC)
- **Language:** TypeScript
- **Styling:** Tailwind CSS v4
- **State:** TanStack Query + Zustand
- **ORM:** Prisma + Postgres
- **Testing:** Vitest + React Testing Library
- **CI:** GitHub Actions

## Scripts

| Script          | Description              |
| --------------- | ------------------------ |
| `npm run dev`   | Start dev server         |
| `npm run build` | Production build         |
| `npm run test`  | Run unit tests           |
| `npm run lint`  | ESLint                   |
| `npm run typecheck` | TypeScript check     |
| `npm run db:studio` | Open Prisma Studio   |
| `npm run db:push`   | Push schema to DB    |

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full system design.

## Policy Report (Backend)

Generated via:

```bash
backend/venv/bin/python backend/scripts/policy_report.py
```

Latest output snapshot:

```text
Temper Policy Report
================================================================================
git_commit: e919547a8ea6d76f2c38c256fcb5644e91cfdf25
git_state: DIRTY

BiasThresholds:
  revenge_time_window_minutes: 15
  revenge_size_multiplier: 2.5
  revenge_min_prev_loss_abs: 400.0
  revenge_rolling_median_multiplier: 2.0
  revenge_baseline_window_trades: 50
  overtrading_window_hours: 1
  overtrading_trade_threshold: 200
  loss_aversion_duration_multiplier: 8.0
  loss_aversion_loss_to_win_multiplier: 4.0

Risk Recommender Parameters:
  min_daily_max_loss: 1000.0
  safety_buffer: 1.05
  day_total_base_quantile: 0.01
  intraday_base_quantile: 0.01
  balance_base_fraction: 0.02
  balance_cap_fraction: 0.1
  intraday_cap_multiplier: 1.1

Judge Dataset Metrics:

calm_trader.csv
  rows: 10000
  bias_rates: revenge=0.37%, overtrading=0.00%, loss_aversion=4.31%, any=4.65%
  daily_max_loss: recommended=11683.565175, used=11683.565175
  blocked_counts: bias=37, risk=0
  checkmated_days: 0
  pnl: actual=-598.627001, simulated=-500.249522, delta=98.377479, cost_of_bias=98.377479
  outcome: WINNER

loss_averse_trader.csv
  rows: 10000
  bias_rates: revenge=0.26%, overtrading=0.00%, loss_aversion=10.41%, any=10.64%
  daily_max_loss: recommended=38753325.100378, used=38753325.100378
  blocked_counts: bias=26, risk=0
  checkmated_days: 0
  pnl: actual=-102790450.050142, simulated=-102793412.150825, delta=-2962.100683, cost_of_bias=0.000000
  outcome: RESIGN

overtrader.csv
  rows: 10000
  bias_rates: revenge=0.45%, overtrading=98.00%, loss_aversion=4.47%, any=98.13%
  daily_max_loss: recommended=44076.001183, used=44076.001183
  blocked_counts: bias=9800, risk=0
  checkmated_days: 0
  pnl: actual=-51576.013828, simulated=-2373.470408, delta=49202.543420, cost_of_bias=49202.543420
  outcome: WINNER

revenge_trader.csv
  rows: 10000
  bias_rates: revenge=0.47%, overtrading=0.00%, loss_aversion=5.41%, any=5.80%
  daily_max_loss: recommended=27221.248651, used=27221.248651
  blocked_counts: bias=47, risk=0
  checkmated_days: 0
  pnl: actual=-85028.740407, simulated=-82381.033366, delta=2647.707041, cost_of_bias=2647.707041
  outcome: WINNER

Sanity Summary:
  calm_not_checkmated: PASS
  overtrader_highest_overtrading: PASS
  revenge_trader_highest_revenge: PASS
  loss_averse_highest_loss_aversion: PASS

Result: PASS
```

## License

MIT
