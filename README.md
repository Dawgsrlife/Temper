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

## License

MIT
