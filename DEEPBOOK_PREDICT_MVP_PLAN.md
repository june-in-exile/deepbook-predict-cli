# DeepBook Predict CLI MVP — Agent Implementation Plan

## Context for Agent

You are implementing a CLI tool that interacts with the DeepBook Predict protocol on Sui testnet. The user is a Sui-experienced engineer who will not build a frontend. Deliverable is a set of npm scripts that exercise the full lifecycle: deposit → mint → redeem → LP supply/withdraw.

**No frontend. No React. No UI. Pure TypeScript CLI scripts.**

## Authoritative References

Always consult these BEFORE writing code. Prefer official docs over memory or training data.

| Resource | URL | Use for |
|---|---|---|
| Predict Design | https://docs.sui.io/onchain-finance/deepbook-predict/design | Object model, lifecycle, data flow |
| Contract Information | https://docs.sui.io/onchain-finance/deepbook-predict/contract-information | Package IDs, shared object IDs, type strings |
| Source code | https://github.com/MystenLabs/deepbookv3/tree/predict-testnet-4-16/packages/predict | Move modules, entry function signatures, struct layouts |
| Sui TS SDK | https://sdk.mystenlabs.com/typescript | Transaction building, PTB syntax, signer setup |
| Sui PTB docs | https://docs.sui.io/concepts/transactions/prog-txn-blocks | Transaction composition patterns |
| Predict Server API | Linked from Contract Information page | Read-only market/portfolio/vault data |

When a doc and the source code disagree, **the source code wins**. The branch is `predict-testnet-4-16` — do not pull from `main` or other branches.

## Hard Rules

1. **Never invent shared object IDs or package IDs.** Always read them from Contract Information or pass them via `.env`.
2. **Never assume PTB argument order.** Read the Move entry function signature first, match argument order exactly.
3. **Never assume decimal scaling.** Read each `u64` field's scaling factor from the source. Quote, strike, and quantity may have different scales.
4. **Always verify on testnet before claiming a step works.** Run the script, check the explorer, confirm object state changed as expected.
5. **One script per action.** Do not build a monolithic CLI. Each npm script is independently runnable and idempotent where possible.
6. **Log every transaction digest.** Print it so the user can verify on Sui explorer.
7. **No ZK login, no Enoki, no wallet UI.** Use a local keypair loaded from `.env` (testnet faucet-funded address).

## Repository Layout

Create this exact structure:

```
predict-cli/
├── .env.example          # Template for required env vars
├── .gitignore            # Must ignore .env, node_modules, dist
├── package.json          # npm scripts as listed in Milestones
├── tsconfig.json         # Strict TS, ESNext target
├── README.md             # User-facing run instructions (write last)
├── src/
│   ├── config.ts         # Loads .env, exports package ID, object IDs, RPC
│   ├── client.ts         # Sui client + keypair singleton
│   ├── lib/
│   │   ├── predict.ts    # Predict shared object reads
│   │   ├── manager.ts    # PredictManager reads (positions, balances)
│   │   ├── oracle.ts     # OracleSVI reads (spot, forward, SVI, lifecycle)
│   │   ├── vault.ts      # Vault reads (PLP supply, max payout, liability)
│   │   └── server.ts     # Predict Server API client (read-only)
│   ├── ptb/
│   │   ├── deposit.ts    # Build deposit PTB
│   │   ├── withdraw.ts   # Build withdraw PTB
│   │   ├── mintBinary.ts # Build mint binary position PTB
│   │   ├── redeem.ts     # Build redeem PTB
│   │   ├── lpSupply.ts   # Build PLP supply PTB
│   │   └── lpWithdraw.ts # Build PLP withdraw PTB
│   └── scripts/          # Entry points called by npm scripts
│       ├── setup.ts      # Create PredictManager if user has none
│       ├── inspect.ts    # Dump current state for debugging
│       ├── deposit.ts
│       ├── mint-binary.ts
│       ├── redeem.ts
│       ├── lp-supply.ts
│       └── lp-withdraw.ts
└── notes/                # Agent writes findings here, one file per day
    ├── day-01.md
    ├── day-02.md
    └── ...
```

## Daily Schedule

Budget: ~1.5 hours/day. Each day has a clear deliverable. If a day's deliverable is not met, do NOT advance — extend the day or split into 1a/1b. Better to take 20 days than ship broken code on day 14.

At the end of EACH day, write `notes/day-NN.md` with:
- What was completed
- What blocked progress (if anything)
- Open questions for next session
- Transaction digests of any successful txns

This is the "tomorrow I start here" handoff. Critical for context recovery.

---

### Day 1 — Read Design + Contract Information

**Deliverable**: `notes/day-01.md` containing:
- Object relationship diagram (ASCII or mermaid)
- Table of every shared object ID, package ID, and module name from Contract Information
- List of all entry functions you'll need to call, grouped by user flow

**Actions**:
1. Read https://docs.sui.io/onchain-finance/deepbook-predict/design end-to-end
2. Read https://docs.sui.io/onchain-finance/deepbook-predict/contract-information end-to-end
3. Open https://github.com/MystenLabs/deepbookv3/tree/predict-testnet-4-16/packages/predict
4. List the `.move` files. Identify which module owns: `Predict`, `PredictManager`, `OracleSVI`, `Vault`, `PLP`.
5. For each user flow (deposit, mint, redeem, LP supply, LP withdraw), find the entry function and record its full signature.

**Do not write any TypeScript yet.** This day is pure reading.

---

### Day 2 — Sui CLI manual dry-run

**Deliverable**: One successful `deposit` transaction executed via `sui client call`, digest recorded.

**Actions**:
1. Install Sui CLI if not present. Switch to testnet env: `sui client switch --env testnet`.
2. Fund the active address from the testnet faucet.
3. Find a live `Predict` shared object ID from Contract Information.
4. Find or create a `PredictManager`. If creation is required, do it via `sui client call`.
5. Mint a test quote coin (usually testnet USDC) — check Contract Information for which quote assets the testnet deployment accepts and how to obtain test quote.
6. Call deposit via `sui client call`. Record the digest in `notes/day-02.md`.

**Why this matters**: The manual flow surfaces every input you'll need to encode in TypeScript. If you can't do it from the CLI, you definitely can't do it from a script.

---

### Day 3 — TypeScript project bootstrap

**Deliverable**: `npm run inspect` works. It connects to testnet, reads the `Predict` shared object, prints its fields.

**Actions**:
1. `npm init`, install `@mysten/sui` (the modern SDK, not the deprecated `@mysten/sui.js`).
2. Set up `tsconfig.json` with `"strict": true`, ESNext modules, `tsx` for execution.
3. Build `src/config.ts` and `src/client.ts`. Load PRIVATE_KEY, PACKAGE_ID, PREDICT_OBJECT_ID, MANAGER_OBJECT_ID, RPC_URL from `.env`.
4. Build `src/lib/predict.ts` with `getPredict()` that returns the parsed shared object content.
5. Build `src/scripts/inspect.ts` that calls `getPredict()` and pretty-prints the result.
6. Add `"inspect": "tsx src/scripts/inspect.ts"` to package.json.

**Verify**: `npm run inspect` prints valid `Predict` state to stdout.

---

### Day 4 — Read PredictManager and OracleSVI

**Deliverable**: `npm run inspect` also dumps the user's PredictManager and at least one OracleSVI.

**Actions**:
1. Build `src/lib/manager.ts`. Functions: `getManager(id)`, `listBinaryPositions(manager)`, `listRanges(manager)`, `getQuoteBalance(manager, coinType)`.
2. Build `src/lib/oracle.ts`. Functions: `getOracle(id)`, parse SVI params, parse lifecycle state into an enum (`Inactive | Active | Pending | Settled`).
3. Extend `inspect.ts` to print: manager balances, position table, and a single OracleSVI's state.
4. Identify a live (Active) OracleSVI from the Predict Server or by scanning. Hardcode its ID in `.env` as `ORACLE_OBJECT_ID` for now.

**Verify**: Output shows correct lifecycle state, sensible SVI parameter values, and accurate position counts (should be empty if you haven't minted anything yet).

---

### Day 5 — Predict Server API client

**Deliverable**: `npm run markets` lists active markets with current prices, fetched from the Predict Server (not on-chain).

**Actions**:
1. Find the Predict Server base URL in Contract Information.
2. Build `src/lib/server.ts` with typed fetch wrappers for: list markets, get market quote, get vault summary, get user portfolio.
3. Build `src/scripts/markets.ts` that lists active markets.

**Why server, not chain?** Listing all markets on-chain is expensive and slow. The server pre-indexes. Per Design doc: "Render markets, portfolios, vault summaries, and history from the public Predict server."

**Verify**: Markets list matches what's visible on the Predict testnet UI (if there is one) or what the explorer shows for active OracleSVI objects.

---

### Day 6 — Deposit and Withdraw PTBs

**Deliverable**: `npm run deposit -- --amount 100` and `npm run withdraw -- --amount 50` both work end-to-end.

**Actions**:
1. Build `src/ptb/deposit.ts` exporting `buildDepositTx({ amount, coinType })` that returns a `Transaction` object (NOT executed).
2. Build `src/ptb/withdraw.ts` similarly.
3. Build `src/scripts/deposit.ts` and `src/scripts/withdraw.ts` that:
   - Parse CLI args (use `commander` or just `process.argv`).
   - Build the tx.
   - Sign and execute with `client.signAndExecuteTransaction()`.
   - Print the digest and the resulting effect summary.
4. Verify the PredictManager's quote balance changed by the expected amount.

**Common pitfalls**:
- Quote coin object must be split to exact amount before passing to deposit — use `tx.splitCoins(tx.gas, [amount])` is WRONG for non-SUI coins. Find the user's quote coin object, then split from it.
- Decimal scaling: if quote is USDC with 6 decimals, `--amount 100` means `100_000_000` on-chain units.
- The deposit entry function may require both `Predict` and `PredictManager` as shared object inputs.

---

### Day 7 — End Week 1: Reflection

**Deliverable**: `notes/week-01-summary.md` covering:
- What works end-to-end
- What you've learned about Predict's architecture that wasn't in the docs
- Estimated remaining time
- Any architectural decisions to revisit

**No new code.** Read your own notes, refactor where needed, commit clean state.

---

### Day 8 — Mint binary PTB (the hardest day)

**Deliverable**: `npm run mint-binary -- --oracle <id> --strike 4 --direction up --qty 10` mints one binary position.

**Actions**:
1. Read the `mint_binary` (or equivalent) Move entry function signature carefully. Note every argument.
2. Build `src/ptb/mintBinary.ts`. The PTB must include:
   - `Predict` shared object
   - `PredictManager` shared object
   - `OracleSVI` shared object (the specific one you're trading on)
   - The market key: `(oracle_id, expiry, strike, is_up)` — note `is_up` is a bool
   - The quantity in correct scaled units
3. Build `src/scripts/mint-binary.ts`.
4. Before signing, call `client.devInspectTransactionBlock()` to dry-run. Surface the expected cost (premium paid). Print it to stdout.
5. If dry-run succeeds, prompt user with "Confirm? y/n" before actually signing. (Manual confirmation is a safety rail — you're business hours testing on testnet but the discipline is good.)

**Common pitfalls**:
- The premium is auto-deducted from PredictManager's quote balance — you do NOT pass coins separately.
- Strike scaling is its own scaling factor, different from quote.
- The `is_up` boolean: confirm direction semantics from source code, not just naming.
- Mint may fail with "ask bound exceeded" — check Pricing & Risk section of Design doc, this is the global/per-oracle price cap.

**Verify**: After mint, `npm run inspect` shows the new position in `manager.binary_positions` table with correct quantity.

---

### Day 9 — Mint binary edge cases + opposite direction

**Deliverable**: Mint both `up` and `down` directions successfully. Confirm they create separate positions with the same `(oracle, expiry, strike)` but different `is_up`.

**Actions**:
1. Run `mint-binary` with `--direction up`, then again with `--direction down`. Both should succeed.
2. Inspect manager — should see two rows in the position table.
3. Document the premium difference between up and down at the same strike. The sum should be roughly $1 minus protocol spread (this is the put-call parity for binary digitals).
4. Update `notes/day-09.md` with the observed premiums and what they imply about implied probability.

**Why this matters**: This is the moment you'll feel "this is options, not betting." The arithmetic of `P(up) + P(down) ≈ 1` makes the SVI pricing tangible.

---

### Day 10 — Redeem PTB

**Deliverable**: `npm run redeem -- --market <key>` works for both Settled and not-yet-settled positions.

**Actions**:
1. Build `src/ptb/redeem.ts`. The redeem entry function will need: `Predict`, `PredictManager`, `OracleSVI`, market key.
2. Test on a position whose oracle is Settled (you may need to wait for an oracle's expiry or use a short-expiry test market).
3. Test on a position whose oracle is still Active — this is a "sell back" / early exit, priced at the current SVI fair value.
4. Verify the quote balance in PredictManager increased by the payout amount.

**Common pitfalls**:
- Redeeming a position whose oracle is in `Pending` lifecycle may revert. Confirm the lifecycle state before calling.
- Partial redeem vs full redeem: check if the entry function takes a quantity arg or always redeems the full balance.

---

### Day 11 — LP Supply PTB

**Deliverable**: `npm run lp-supply -- --amount 1000` supplies quote to the vault and rewards PLP shares.

**Actions**:
1. Build `src/ptb/lpSupply.ts`. Inputs: `Predict`, quote coin to supply.
2. The output PLP shares are minted to the signer's address (verify in Move source whether they're returned as a new owned object or added to a registry).
3. Build `src/scripts/lp-supply.ts`. After execution, find the new PLP coin object and print its balance.
4. Read Design doc's PLP section: first supplier gets 1:1 shares, subsequent suppliers get proportional shares. Verify this math against actual results.

**Verify**: User now owns a PLP coin/object. Vault's total supply increased by the deposit.

---

### Day 12 — LP Withdraw PTB

**Deliverable**: `npm run lp-withdraw -- --shares 500` burns PLP shares and returns quote.

**Actions**:
1. Build `src/ptb/lpWithdraw.ts`. Inputs: `Predict`, PLP coin to burn (or share amount).
2. Handle the withdrawal limiter: per Design doc, withdrawals "return quote assets only when the withdrawal amount is available after covering current max payout." This means a withdraw may revert if too much exposure exists. Catch this gracefully.
3. Verify quote balance returned matches `(PLP_burned / total_PLP) * vault_value` minus any fees.

**Common pitfalls**:
- Withdraw might require a specific quote coin type as output — vault may have multiple accepted quotes, but you only get back one type per call.
- Decimal mismatch between PLP shares (likely 9 decimals?) and quote returned.

---

### Day 13 — Setup script + idempotency

**Deliverable**: `npm run setup` runs the user from zero (no PredictManager) to ready-to-trade (manager created, quote deposited).

**Actions**:
1. Build `src/scripts/setup.ts`:
   - Check if user has a PredictManager. If not, create one and save its ID to `.env` (use `dotenv-flow` or just print and prompt).
   - Check quote balance. If below threshold, mint test quote (if testnet supports faucet) or prompt user to fund.
   - Deposit a default amount.
2. Make `setup` idempotent — re-running it should not duplicate manager or over-deposit.

---

### Day 14 — End Week 2: Integration test

**Deliverable**: A single script `npm run e2e` that runs the full lifecycle: setup → mint up → mint down → wait → redeem → lp supply → lp withdraw. Each step prints status.

**Actions**:
1. Build `src/scripts/e2e.ts`.
2. For the "wait for settlement" step: either use a market with very short expiry, or simulate by redeeming early (which works on Active oracle per Design).
3. Run end-to-end. Fix every bug surfaced. This is the integration day.

---

### Day 15 — Inspect tool polish

**Deliverable**: `npm run inspect` produces a clean, human-readable dashboard of: user's manager state, all owned PLP, vault summary, active oracles, recent transaction history.

**Actions**:
1. Refactor `src/scripts/inspect.ts` into sections with headers.
2. Use a table library (`cli-table3`) for tabular output.
3. Add `--json` flag for machine-readable output.

---

### Day 16 — README + demo recording

**Deliverable**: `README.md` that a new user can follow to clone, configure, and run the full flow. Plus a recorded terminal session (`asciinema` or screen recording) showing the e2e flow.

**Actions**:
1. Write README with: prerequisites, setup steps, environment variables, command reference, troubleshooting section.
2. Record `npm run e2e` execution and save the recording.

---

### Days 17-18 — Buffer

Reserved for overruns. Most likely uses:
- Day 8 (mint binary) takes 2-3 days instead of 1
- A Sui SDK API surprise breaks something already working
- Testnet RPC instability requires retry logic
- Decimal bugs surface during e2e

**If you finish early**: do NOT add features. Add tests. Add error handling. Write more notes.

## Out of Scope for This MVP

Do not implement, even if tempted:
- Vertical range positions (`mintRange.ts`) — same pattern as binary, skip until v2
- Position transfer / approval flows
- Frontend / wallet integration
- Order history pagination beyond what server provides natively
- Multi-quote-asset support — pick one quote asset for the MVP
- Gas estimation UI — just let txns succeed/fail
- Retry logic for failed txns — manual re-run is fine for now

## Definition of Done

The MVP is complete when:
1. A fresh clone + `.env` setup + `npm install` + `npm run setup` works on a new testnet address
2. `npm run e2e` runs all six lifecycle commands without manual intervention
3. README is clear enough that a Sui-familiar developer can use it without asking questions
4. All 18 daily notes exist and capture findings
5. A 3-minute demo recording exists

## Operating Principles for the Agent

- **Read first, code second.** Every day's first action is documentation reading, not typing.
- **One thing at a time.** Do not jump ahead. Day 8 depends on Day 7 being clean.
- **Verify on-chain after every txn.** Print the digest, encourage the user to check the explorer.
- **When uncertain, ask the user.** Better to clarify than to invent. The user has Sui experience and can answer fast.
- **Never fabricate IDs, types, or function names.** If you don't find it in source or docs, say so.
- **Commit notes daily.** The notes/ directory is the durable artifact — code can be rewritten, but the learning compounds.
