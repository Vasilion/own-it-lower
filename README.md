# Own It Lower

Find cash-secured puts worth selling on quality companies that have pulled back.

Screens large-caps with healthy balance sheets that are trading into technical
support with elevated implied volatility, then ranks individual put contracts
against the settings you choose and shows the arithmetic behind the ranking.

**Status:** Phase 0 — data pipeline. No UI yet.

---

## What makes it different

Barchart, OptionSamurai and Market Chameleon are filters: you type numeric ranges,
you get rows back. This is a ranking engine — the same option chain comes back in a
**different order** for two different users, because assignment appetite flips the
scoring weights.

|                    | "Happy to own it"              | "Premium only"          |
| ------------------ | ------------------------------ | ----------------------- |
| Delta band         | 0.30–0.40                      | 0.10–0.20               |
| Heaviest weight    | Effective cost basis vs 200DMA | Probability OTM         |
| Strike vs support  | Reward at/below support        | Reward well below       |
| Earnings in window | Tolerable (cheaper entry)      | Heavy penalty           |
| Optimises for      | Discount on the shares         | Premium per unit risk   |

## Setup

```bash
pnpm install
cp .env.example .env.local   # then fill in the values
pnpm check:provider          # confirm the data source is actually healthy
pnpm db:push                 # create tables in Neon
pnpm snapshot:iv --dry AAPL  # fetch + parse only, no database needed
pnpm snapshot:iv             # full universe, writes to Neon
```

## Commands

| Command                | What it does                                                  |
| ---------------------- | ------------------------------------------------------------- |
| `pnpm check:provider`  | Asserts the options vendor returns genuinely usable data       |
| `pnpm snapshot:iv`     | Daily ATM IV capture for the universe (`--dry` to skip writes) |
| `pnpm db:push`         | Push the Drizzle schema to Neon                                |
| `pnpm db:studio`       | Browse the database                                            |
| `pnpm typecheck`       | `tsc --noEmit`                                                 |

## Two things worth knowing before you touch the data layer

**1. Greeks are derived, not licensed.** Given IV, spot, strike, time and the
risk-free rate, Black-Scholes produces every greek in closed form
(`lib/engine/blackscholes.ts`). We never pay for a greeks feed — we only need chain
quotes, which is far cheaper and more widely available.

**2. A data source can be hollowed out without ever returning an error.** Yahoo's
free options endpoint was the original prototype source. As of 2026-08-25 it still
answers HTTP 200 with well-formed chains — and across a full AAPL chain of 168
contracts, every bid is zero, every open interest is zero, and IV comes back in an
impossible 0–6.3% band. Nothing throws. That is why `pnpm check:provider` exists and
why it runs in CI ahead of every snapshot: it asserts on the *shape of the values*,
not on the response status.

Providers are pluggable behind `OptionsProvider` (`lib/data/types.ts`), so swapping
vendors is a config change.

## Why the IV snapshot runs before anything else exists

IV Rank needs a rolling 52-week history of each ticker's own implied volatility. No
vendor sells that cheaply — ORATS is $99/mo and most providers don't offer it at all.
So we accumulate it ourselves, starting now. Every day the job runs adds a day of
history that cannot be reconstructed later, which means the table appreciates on its
own and becomes a genuine moat at this price point. A day the job doesn't run is a
day gone for good.

Until roughly a year of history exists, `lib/engine/ivrank.ts` reports a shortened
window honestly (`IV Rank (60d)`) rather than passing a 60-day rank off as annual.

## Data licensing

Options quotes originate from OPRA, and displaying them to end users is
*redistribution* — a legal layer separate from holding an API key.

- **OPRA charges nothing for data delayed 15+ minutes.** This product is delayed-only
  by design. For choosing a 30-DTE strike that is entirely adequate, and it keeps
  margins near-flat as usage grows: a 15-minute cache is lossless when the data can't
  be fresher than 15 minutes, so API cost scales with universe size, not user count.
- **Vendor terms are a separate gate from OPRA rules.** A vendor can forbid what OPRA
  permits. Tradier's sandbox is licensed for development only. Confirm delayed
  redistribution in writing before any of this reaches a paying user.

## Compliance

The product ranks contracts against settings the user chooses and shows the maths. It
does not give advice.

- No collection of financial circumstances — no net worth, income, tax status, goals.
- Settings are a **strategy preset**, never a "risk tolerance profile."
- Output is "ranked by fit to the settings you chose," never "we recommend."
- Every figure shown is checkable arithmetic, never a verdict.
- No performance claims and no track records.

## Stack

Next.js 16 · React 19 · Tailwind 4 · Drizzle · Neon Postgres · Vercel.
Engine logic lives in `lib/engine` as pure TypeScript with no framework imports, so
it can back a mobile client later without a rewrite. Heavy scans run in GitHub
Actions and write to Neon — never in a request path.
