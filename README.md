# DeepBook Predict — Toy Example + Slides

A learning bundle for [DeepBook Predict](https://docs.sui.io/onchain-finance/deepbook-predict/design),
the binary-options primitive on Sui testnet. **Not a production tool.** This
repo holds two artifacts side by side, both aimed at someone who wants to
go from "never heard of it" to "I see how the pieces fit" in under an hour:

1. **A 13-slide technical brief** (`presentation/`) — what Predict is, why
   it matters, and how the on-chain pieces talk to each other. Includes a
   speaker script (`script.md`) you can read instead of watching the talk.
2. **A TypeScript CLI** (`src/`, this `package.json`) — no frontend, no
   wallet UI, just npm scripts that walk the full lifecycle (deposit, mint,
   redeem, LP supply, LP withdraw) with a 5-gate pre-flight dry-run before
   anything signs.

If you're here to **understand the protocol**, start with the slides. If
you're here to **integrate**, start with [Quickstart](#quickstart) and
treat the slides as background reading.

Pinned to the `predict-testnet-4-16` branch of `deepbookv3`.

## Repo layout

```text
/
├── presentation/             ← slides + speaker script (Vercel-deployable)
│   ├── present.html          ← self-contained 6.4 MB bundle, open in any browser
│   ├── script.md             ← speaker notes for the deck
│   └── images/
├── src/                      ← CLI source (TypeScript, ESM, NodeNext)
│   ├── cli.ts                ← subcommand dispatcher for the published binary
│   ├── scripts/              ← one entry point per command
│   ├── ptb/                  ← PTB builders (return Transaction; do not execute)
│   ├── lib/                  ← read helpers, oracle math, server wrappers
│   ├── client.ts             ← SuiClient + optional keypair
│   └── config.ts             ← zod-validated .env loader
├── test/                     ← vitest unit tests
├── DEEPBOOK_PREDICT_MVP_PLAN.md ← the implementation plan this CLI follows
├── vercel.json               ← rewrites / → /presentation/present.html
└── package.json
```

## Presentation

The deck is a single self-contained HTML file — JS, CSS, fonts and images
all base64-bundled inline. No build step, no external requests.

```bash
# View locally
open presentation/present.html

# Read the speaker script
${PAGER:-less} presentation/script.md
```

**Deploying to Vercel.** The repo root contains a `vercel.json` that
rewrites `/` → `/presentation/present.html`, so importing the repo into
Vercel as a static project Just Works — no framework preset needed, no
build command, no output directory. The whole site is one file plus a
rewrite rule.

If you want to deploy the slides on their own (without the CLI source),
either set Vercel's "Root Directory" to `presentation/` and rename
`present.html` → `index.html`, or fork and `git rm` the non-slides
content.

## Quickstart

```bash
git clone …
cd deepbook-predict-cli
npm install
cp .env.example .env       # fill PRIVATE_KEY (and adjust if needed)
npm run setup              # check readiness + manager status
npm run inspect            # pretty-print live protocol state
```

If `setup` says "Wallet holds DUSDC ✗" — that's the only thing
blocking real trades. See [Troubleshooting → DUSDC](#dusdc-not-in-wallet)
below.

## Prerequisites

| Required | What | Why |
|---|---|---|
| Node ≥ 20 | Runtime | uses native fetch + bigint |
| npm | Package manager | bundled with Node |
| A testnet Sui keypair | Private key in `suiprivkey1…` form | required from Day 6 onward (deposit and beyond) |
| Some testnet SUI (≥ 1 SUI) | Gas | mint/redeem each costs ~0.006 SUI |
| Testnet DUSDC | Quote asset | required for deposit/mint/lp-supply |

Sui CLI is recommended but not required. To export your keypair from
`sui keytool`:

```bash
sui keytool export --key-identity <your_active_address>
```

The output's `suiprivkey1…` string is what `PRIVATE_KEY` in `.env`
expects.

## Configuration

All on-chain identifiers live in `.env`. `.env.example` is committed;
copy it and edit. Validations run on every script start (zod schema in
`src/config.ts`), so a typo surfaces immediately. The quote asset is no
longer stored — it's discovered from the protocol's `accepted_quotes`
set at runtime.

| Variable | Description |
|---|---|
| `RPC_URL` | Sui fullnode RPC URL |
| `SERVER_URL` | Predict Server base URL (indexer; only 4 endpoints exist) |
| `PACKAGE_ID` | Predict package on testnet (version-pinned; e.g. `predict-testnet-4-16`) |
| `PRIVATE_KEY` | Your `suiprivkey1…` (empty until you need to sign) |

The Predict shared-object id, oracle id, and manager id are resolved at
runtime, so none of them live in `.env`:

- **Predict object** — derived once at startup from the indexer's `/oracles`
  feed. Fails fast if the indexer is unreachable or reports multiple
  distinct predict objects (mid-deployment state).
- **Oracle** — `inspect`, `preview`, and `mint-binary` auto-pick the next
  Active oracle from the indexer; `redeem` derives it from your manager's
  matching position. Pass `--oracle <id>` to override.
- **Manager** — auto-resolved from the sender's owned `PredictManager`
  objects; pass `--manager <id>` to override (required when the sender
  owns multiple).

The current `.env.example` is pre-filled with the live testnet
identifiers as of `predict-testnet-4-16`. Verify each one against
the official [Contract Information](https://docs.sui.io/onchain-finance/deepbook-predict/contract-information)
page before going further.

## Command reference

Thirteen user-facing scripts grouped below; two dev scripts at the end.
Lifecycle commands accept `--help` for usage details.

### Read-only (no signing required, no PRIVATE_KEY needed)

| Command | What it does |
|---|---|
| `npm run inspect` | Dumps Predict / Manager / Oracle / Wallet state. Add `--json` for machine output. |
| `npm run markets` | Lists active oracles via the indexer. Supports `--asset BTC`, `--limit N`, `--all`. |
| `npm run preview -- --strikes 80000,80500,81000` | Side-by-side UP+DOWN ask/bid table across a strike ladder. Add `--ranges 79500-80500,80500-81500` for a range block. |

### Setup

| Command | What it does |
|---|---|
| `npm run setup` | Idempotent: checks manager existence + ownership + DUSDC balance and prints next steps. |
| `npm run setup -- --create-manager` | Creates a PredictManager (one-time; signs `predict::create_manager`). |

### Trading (signs transactions; require `PRIVATE_KEY` + DUSDC)

Every signing script is **dry-run by default**. Add `--execute` to
actually submit. Add `--yes` to skip the interactive confirmation.

| Command | What it does |
|---|---|
| `npm run deposit -- --amount 100` | Deposit DUSDC into the manager. |
| `npm run withdraw -- --amount 50` | Withdraw DUSDC from the manager to your wallet. |
| `npm run mint-binary -- --strike 80500 --qty 5 --direction up` | Mint a binary position. |
| `npm run mint-range -- --lower 80000 --higher 81000 --qty 5` | Mint a range position (inside-range payoff). |
| `npm run redeem -- --strike 80500 --qty 5 --direction up` | Redeem (full or partial). Works for Active *and* Settled oracles. |
| `npm run redeem-range -- --lower 80000 --higher 81000 --qty 5` | Redeem a range position. Same lifecycle rules as binary redeem. |
| `npm run lp-supply -- --amount 100` | Supply DUSDC to the vault for PLP shares. |
| `npm run lp-withdraw -- --shares 50` | Burn PLP for DUSDC. |
| `npm run e2e` | Full lifecycle orchestrator: deposit → mint UP+DOWN+RANGE → redeem all three → lp-supply → lp-withdraw. |

### Quote selection

All commands resolve the quote asset from the protocol's
`Predict.treasury_config.accepted_quotes` set on startup. Currently this
set contains only DUSDC; the CLI auto-selects it, so no flag is needed.

When the protocol adds a second quote asset (e.g. USDC), the CLI will
refuse to run without an explicit `--quote`:

```bash
npm run mint-binary -- --quote DUSDC --strike 80500 --qty 5 --direction up
npm run deposit     -- --quote 0xe95040…::dusdc::DUSDC --amount 100   # full type also works
```

The flag accepts either a symbol (case-insensitive match against
`CoinMetadata.symbol`) or a full coin type (the value containing `::` is
treated as a full type).

### Development

| Command | What it does |
|---|---|
| `npm run typecheck` | TypeScript strict mode check. |
| `npm test` | Run unit tests (28 cases). |

## How a typical run looks

```
$ npm run --silent setup
=== setup ===
  sender:  0xdbbd9f28…
  manager exists:     yes
  owner matches:      yes
  wallet DUSDC:       100
  manager DUSDC:      50

  --- readiness ---
  ✓ PredictManager ready
  ✓ Wallet holds DUSDC
  ✓ Manager funded above $10

  Ready to trade. Examples:
       npm run preview     -- --strike 80500 --qty 5
       …

$ npm run --silent mint-binary -- --strike 80500 --qty 5 --direction up --execute
=== mint binary UP ===
  oracle:     0xe768ff79…
  spot:       80,148.69113283
  strike:     80,500
  direction:  UP   (settle > strike pays $1)
  cost:       3.005414 DUSDC

  dry-run: OK
  Sign and submit this mint for 3.005414 DUSDC? [y/N]: y

=== execution ===
  success:  true
  digest:   …
  explorer: https://suiscan.xyz/testnet/tx/…
```

## Architecture

Source layout:

```text
src/
  config.ts           — zod-validated .env loader
  client.ts           — SuiClient + optional Ed25519Keypair
  cli.ts              — subcommand dispatcher (entry for the published binary)
  lib/
    predict.ts        — read Predict shared object (incl. vault metrics + PLP supply)
    manager.ts        — read PredictManager, list positions, view balance/position via devInspect
    oracle.ts         — read OracleSVI, compute lifecycle (mirrors oracle.move::status)
    server.ts         — typed wrappers around the 4 Predict Server endpoints
    coins.ts          — fetchAllCoins + splitFromOwned (shared between 3 PTB builders)
    view.ts           — devInspect-as-view-call helpers
  ptb/                — PTB builders (return Transaction; do not execute)
    deposit.ts        — split DUSDC + predict_manager::deposit
    withdraw.ts       — predict_manager::withdraw + transferObjects
    mintBinary.ts     — market_key::up|down + predict::mint
    redeem.ts         — market_key::up|down + predict::redeem
    lpSupply.ts       — split DUSDC + predict::supply + transferObjects
    lpWithdraw.ts     — split PLP + predict::withdraw + transferObjects
  scripts/            — one entry point per command (run via npm or dispatcher)
    _cli.ts           — shared helpers: parseDecimalAmount, formatDecimal,
                        resolveSender, dryRun, sign, printOutcome
    inspect.ts        — read-only dashboard
    markets.ts        — server-backed oracle list
    preview.ts        — UP+DOWN preview table
    setup.ts          — readiness checker, opt-in manager creator
    deposit.ts / withdraw.ts / mint-binary.ts / redeem.ts /
      lp-supply.ts / lp-withdraw.ts / e2e.ts
test/                 — vitest unit tests (28 cases)
DEEPBOOK_PREDICT_MVP_PLAN.md — the implementation plan this CLI follows
```

### Three scaling conventions

The protocol uses two fixed-point scales (1e6 and 1e9); quantity reuses
the 1e6 scale with a special meaning. Confusing these is the most common
bug source.

| Quantity | Scale | Example |
|---|---|---|
| Quote balances (vault, manager, coins) | 1e6 (DUSDC decimals) | $100 = 100_000_000 raw |
| Prices, strikes, %, spreads | 1e9 (protocol fixed-point) | $80,500 strike = 80_500_000_000_000 raw |
| Quantity (mint/redeem) | 1e6 (same as quote, doubles as max payout) | qty=5 means $5 max payout, raw 5_000_000 |

CLI inputs (`--amount`, `--strike`, `--qty`) all accept **human dollar
amounts** and scale internally.

### Pre-flight gating

Every signing script runs **5 pre-flight gates** before requesting
signature:

1. Static input validation (positive amounts, valid directions, etc.)
2. Off-chain math check (e.g., mint preview, LP availability)
3. Wallet / manager state check (have enough DUSDC, own enough PLP)
4. devInspect — chain-side dry-run of the actual PTB
5. Interactive confirm prompt (unless `--yes` is set)

Each gate catches a different class of error and translates it into
an actionable CLI message. By the time `--execute` runs, the chain has
essentially nothing left to reject except race conditions.

## Troubleshooting

### DUSDC not in wallet

This is the single hardest blocker for new users: the testnet's
**DUSDC token has no public faucet**. The `dusdc::dusdc` module
exposes only its `init` function, which runs once at deploy time and
transfers the `TreasuryCap` to the deployer. Only the deployer (the
Mysten team) can mint DUSDC.

Acquisition paths:

- **Ask in the official DeepBook / Mysten Discord** — fastest in
  practice.
- **Trace the deployer** of `0xe95040…::dusdc::DUSDC` from the
  package's `previousTransaction` field. They can mint on request.
- **Borrow from an active trader** — `GET /managers` returns recently
  active PredictManagers; their owners often hold DUSDC and may be
  willing to transfer a small amount.

Once DUSDC is in your wallet, `npm run setup` flips to "Ready to
trade" automatically.

### "Oracle is Settled" when minting

Oracles on testnet are short-lived (typically 15-minute expiries).
There is no `ORACLE_OBJECT_ID` in `.env` to keep up to date — `inspect`,
`preview`, and `mint-binary` always consult the indexer for the current
active oracle. `redeem` derives the oracle from your matching manager
position, so it works against Settled oracles automatically.

If the indexer is unreachable or reports no active oracle, the call
fails with:

```text
No active oracle in indexer. Pass --oracle <id> explicitly, or run `npm run markets` to inspect current oracle state.
```

Run `npm run markets` to inspect oracle state, then pass `--oracle <id>`
to override per-call when needed.

For `redeem`: if you have multiple positions at the same strike/direction
across different expiries, the auto-derive emits a disambiguation hint
listing each `(expiry, oracle id, qty)` — pass `--oracle <id>` to pick.

### "MoveAbort … assert_mintable_ask"

Your strike is too close to spot for `--direction up` (or far below
for `--direction down`). The protocol caps the ask at `$0.99`, so
"near-certainty" trades are rejected. Pick a strike where the implied
probability is between roughly 5% and 95%. Use `npm run preview` to
find the sweet spot.

### "MoveAbort … assert_valid_strike"

Two distinct cases share this abort code:

- Strike below `min_strike` for the oracle (BTC: $50,000 minimum).
- Strike not on the oracle's tick grid (BTC tick: $1 — so $80,500
  works, $80,500.5 doesn't).

Use a whole-dollar strike at or above the oracle's `min_strike`.

### "MoveAbort … pricing_config::quote_spread_from_fair_price"

Strike too deep OTM — fair price is below `min_ask_price` ($0.01) and
both legs would be at the floor. Pick a strike closer to spot.

### "EWithdrawExceedsAvailable" (LP withdraw)

The vault must keep enough DUSDC to cover outstanding `max_payout`
(face value of all open positions). Your withdraw would dip into the
reserve. Either burn fewer shares, or wait for positions to redeem.
The script's pre-flight catches this before signing.

### npm 11 + jq breaks

`npm run inspect | jq` doesn't work because npm 11 prints the script
banner to stdout. Use `--silent`:

```bash
npm run --silent inspect -- --json | jq
```

### "--quote required to disambiguate"

`Predict.treasury_config.accepted_quotes` contains more than one quote
asset. Re-run with `--quote <symbol>` (e.g. `--quote DUSDC`) or pass the
full coin type. `npm run inspect` lists every accepted quote under
`TreasuryConfig — accepted quotes`.

## What this CLI does NOT do

Per the plan's scope:

- No **wallet UI / browser integration**. Local keypair only.
- No **multi-quote support**. Single quote asset (DUSDC) hardcoded.
- No **historical position tracking**. The Predict Server's indexer
  doesn't expose per-manager history; would require Sui event RPC.
- No **gas estimation UI**. Transactions either succeed or fail; gas
  estimates come back in the dry-run output.
- No **retry logic**. Manual re-run on failure is the workflow.

## Publishing the CLI

The CLI is published as an npm package: **`deepbook-predict-cli`**.

```bash
# As an end user — install globally, run anywhere:
npm install -g deepbook-predict-cli
deepbook-predict setup
deepbook-predict mint-binary --strike 80500 --qty 5 --direction up

# Or without installing:
npx deepbook-predict-cli setup
```

The clone-and-`npm run` workflow (above [Quickstart](#quickstart)) stays
the recommended path if you want to read or modify the code while
running it. The published binary is for consumers who just want to
exercise the lifecycle on testnet without cloning anything.

### Release flow

The maintainer release flow, in case you're cutting a new version:

```bash
# 1. Bump version (semver — patch/minor/major)
npm version patch

# 2. Sanity check the tarball contents
npm pack --dry-run

# 3. Publish
npm publish
```

`prepublishOnly` runs `build` + `test` before the tarball goes out, so a
broken build can't ship by accident. The `files` whitelist in
`package.json` ensures only `dist/`, `README.md`, `LICENSE`, and
`.env.example` get packed — source, tests, presentation, and notes stay
local.

### What's NOT in the npm tarball

- **The presentation** (`presentation/`) — slides are deployed
  separately to Vercel.
- **TypeScript source** (`src/`) — only the compiled `dist/` ships. If
  consumers want to read the source, they read the GitHub repo.
- **Tests** (`test/`) — dev-only.
- **The plan doc** (`DEEPBOOK_PREDICT_MVP_PLAN.md`) — dev-only.

## Definition of Done

From the plan:

| Item | Status |
|---|---|
| Fresh clone + `.env` + `npm install` + `npm run setup` works | ✅ verified |
| `npm run e2e` runs all lifecycle commands (binary + range) | ⚠ orchestrator built; execution gated on DUSDC supply |
| Range options (mint-range, redeem-range, preview, e2e integration) | ✅ shipped |
| README clear enough for a Sui-familiar developer | ← you're reading it |
| 3-minute demo recording | Out of scope for a CLI-only session |

## License

None yet. **Must be set before the npm publish in
[Future](#future-publishing-the-cli) goes out** — npm tarballs without a
`LICENSE` are ambiguous about reuse rights, and the slides will hit
Vercel before the CLI does, so anyone scraping the public deploy needs
clear terms. MIT is the obvious default for a toy/teaching example;
revisit if anything in here turns out to be load-bearing for production
use.
