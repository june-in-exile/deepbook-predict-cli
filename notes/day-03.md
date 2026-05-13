# Day 3 — TypeScript project bootstrap

**Date:** 2026-05-13
**Branch pin:** `predict-testnet-4-16`

> Deliverable: `npm run inspect` connects to testnet, reads the Predict
> shared object, prints its fields. **Met.**

---

## 1. Files added

```
.env.example          # template
.env                  # copied from .env.example (gitignored)
.gitignore            # ignores .env, node_modules, dist, coverage
package.json          # scripts: inspect, test, test:watch, typecheck
tsconfig.json         # strict, NodeNext, noUncheckedIndexedAccess
src/
  config.ts           # zod-validated env loader, frozen Config
  client.ts           # SuiClient + requireKeypair() helper
  lib/
    predict.ts        # getPredict(): reads Predict shared object
  scripts/
    inspect.ts        # sectioned printer + --json mode
test/
  config.test.ts      # 6 tests — happy path, missing var, bad id, bad type, optional + bad PRIVATE_KEY
```

## 2. SDK versions installed

| Pkg | Version |
|---|---|
| `@mysten/sui` | `1.45.2` |
| `zod` | `3.25.76` |
| `dotenv` | `16.6.1` |
| `tsx` | `4.21.0` |
| `typescript` | `5.9.3` |
| `vitest` | `2.1.9` |

## 3. Verification

```
$ npm run typecheck         → clean
$ npx vitest run            → 6/6 passed
$ npm run inspect           → sectioned output (see §4)
$ npm run --silent inspect -- --json | jq .vault.balance
"1001682827546"
```

## 4. What the live Predict object actually contains today

`inspect` produced these facts on first run (compare with [Day 1 §3](day-01.md)'s
prediction of the layout):

| Field path | Value | Interpreted |
|---|---|---|
| `Predict.trading_paused` | `false` | Trading is live |
| `treasury_config.accepted_quotes` | `[0xe95040…::dusdc::DUSDC]` | Single quote on allowlist (matches Day 1) |
| `pricing_config.base_spread` | `20_000_000` | **2%** at 1e9 scaling |
| `pricing_config.min_spread` | `5_000_000` | 0.5% |
| `pricing_config.min_ask_price` | `10_000_000` | **$0.01** floor |
| `pricing_config.max_ask_price` | `990_000_000` | **$0.99** cap |
| `pricing_config.utilization_multiplier` | `2_000_000_000` | 2× |
| `risk_config.max_total_exposure_pct` | `800_000_000` | **80%** of vault balance |
| `oracle_config.oracle_grids.size` | `2181` | ~2.2k registered strike grids |
| `oracle_config.oracle_ask_bounds.size` | `0` | No per-oracle ask overrides yet |
| `vault.balance` | `1_001_682_827_546` | **$1,001,682.83 DUSDC** (1e6 scaling) |
| `vault.balances.size` | `1` | Single quote (DUSDC) |
| `vault.oracle_matrices.size` | `18` | 18 oracles with active exposure |
| `vault.settled_oracles.size` | `2163` | Lots of expired oracles compacted |
| `vault.total_max_payout` | `272_000_000` | $272 of max obligation |
| `vault.total_mtm` | `266_522_086` | $266.52 MTM liability |
| `withdrawal_limiter.enabled` | `false` | Rate limit currently off |

**Two scales coexist in `Predict` — important for Days 6/8:**

| Quantity | Scale |
|---|---|
| Quote balances (vault, manager) | `1e6` (DUSDC decimals) |
| Prices, spreads, % limits | `1e9` (protocol fixed-point) |
| Strikes (BTC oracle Day 2) | `1e9` |

[Day 1 §5 question 6](day-01.md) is now answered: strike + price scaling
is `1e9`. Quote-amount scaling stays at the coin's native decimals
(DUSDC = 6).

## 5. Architecture decisions worth remembering

### Config is loaded once and frozen

`loadConfig()` returns a `Readonly<Config>`. Other modules consume the
parsed config rather than calling `process.env` again — a single source
of truth, easy to test by swapping `process.env` in `beforeEach`.

### `Ctx` instead of a bag of globals

`client.ts` exports `createContext()` which returns `{ config, client }`.
Every lib/script function takes `Ctx` rather than reading from a
module-level singleton — this keeps tests pure and makes future scripts
(e.g., parallel checks across multiple managers) trivial to compose.

### Keypair is optional in Day 3

`requireKeypair(cfg)` throws if `PRIVATE_KEY` is missing. Day 3's
read-only flow never calls it — `.env`'s `PRIVATE_KEY=` (empty) is the
intended state until Day 6.

### Reading shared-object fields without the BCS pain

Instead of decoding BCS from `sui client object --json`, we use
`SuiClient.getObject(..., { showContent: true })` which returns parsed
Move fields. Nested struct fields show up as `{ type, fields: { … } }`,
which `nestedFields()` flattens. Vec sets (like `accepted_quotes`) come
through as `{ contents: [{ fields: { name } }, …] }` — Move's `TypeName`
strips the leading `0x`, so `parseAcceptedQuotes` adds it back.

### npm-banner-on-stdout gotcha

npm 11 prints `> pkg@x.y.z script` to **stdout** (used to be stderr).
`npm run --silent inspect -- --json | jq` works; the non-silent form
breaks any downstream JSON parser. Worth a README note for Day 16.

## 6. Open questions / carry-overs

1. **Map of oracle ID → SVI / strike grid** — `oracle_grids` (size 2181)
   is a `Table<ID, …>` keyed by oracle id. Reading the entry for a
   specific oracle requires `getDynamicField`. Day 4 work.
2. **Vault per-quote balance** — `vault.balances` is `Table<TypeName, u64>`
   size 1. To extract the per-coin-type number we'd query the dynamic
   field, or just use `available_withdrawal()` view on Day 6.
3. **`raw` field in `PredictState`** — currently included for
   debugging. Trim before Day 15 polish if it bloats `--json` output.

## 7. Successful Transactions

None today — pure read flow.

## 8. Tomorrow's Starting Point — Day 4

`getManager()` + `getOracle()`, extend `inspect` to dump them.

1. `src/lib/manager.ts`: `getManager(ctx)`, `listBinaryPositions(manager)`,
   `listRanges(manager)`, `getQuoteBalance(manager, coinType)`.
   - For position table iteration: use
     `client.getDynamicFields({ parentId: positions.id.id })` and
     fetch each field by name.
   - For quote balance: cleanest path is calling `predict_manager::balance<Quote>`
     via `devInspectTransactionBlock` rather than walking the wrapped
     BalanceManager's dynamic fields.
2. `src/lib/oracle.ts`: `getOracle(ctx, id)`, enum-ify lifecycle.
   The status byte from `oracle::status(oracle, clock)`:
   `0=Inactive, 1=Active, 2=PendingSettlement, 3=Settled`
   (per source `predict-testnet-4-16/oracle.move:302-314`).
3. Extend `inspect` to print Manager and one Oracle. Hardcode oracle id
   via `ORACLE_OBJECT_ID` (already in `.env`).
4. **Verify** the oracle in `.env` is still Active — if it expired
   overnight, swap in a fresh active oracle from
   `GET /oracles` (server) filtered by `status=active`.
