# Day 4 — Read PredictManager and OracleSVI

**Date:** 2026-05-13
**Branch pin:** `predict-testnet-4-16`

> Deliverable: `npm run inspect` also dumps the user's PredictManager and at
> least one OracleSVI. **Met.**

---

## 1. What was added

```
src/lib/oracle.ts      # getOracle(ctx,id), parseOracle, computeLifecycle, parseI64
src/lib/manager.ts     # getManager, listBinaryPositions, listRangePositions, getQuoteBalance
src/scripts/inspect.ts # extended: PredictManager + OracleSVI sections, formatDecimal helper
test/oracle.test.ts    # 8 tests (i64 parse + lifecycle precedence)
```

Tests: **14/14 green**. Typecheck: clean.

## 2. Live output (excerpt)

```
=== PredictManager ===
  id                    0xe55ea85bcf29d5cbea28e29cfaf6c3ecc58f461053aa06b4436b950e98608a3d
  owner                 0xdbbd9f28e35f510bd9d86b4787ed53e09cd49695ac98f4210af77284e63d7266
  balance_manager_id    0x5050866bf0e1666e241d46b5765a8b205aedaf3ff1de0aa7c81ccdd85166615a
  quote_balance (raw)   0
  quote_balance (USDC)  0
  binary_positions      0
  range_positions       0

=== OracleSVI ===
  id                0x3d7033b21ac61a9cf5c5f0a442164da0375fae8b9b55b7c105d2be599bcc1b7b
  underlying_asset  BTC
  lifecycle         Active
  active (flag)     true
  expiry_ms         1778673600000
  expiry (UTC)      2026-05-13T12:00:00.000Z
  spot (price)      81004.583255405
  forward (price)   80991.033317284
  settlement_price  (none)
  authorized_caps   10

=== OracleSVI — SVI params (all 1e9-scaled) ===
  a      27847
  b      250997
  rho    297355744
  m      645104
  sigma  2037202
```

The empty position counts are the verification target the plan asked for —
since we haven't minted anything, the dynamic-field iteration returns
nothing for both tables. The code is exercised, not just present.

## 3. Decisions and their reasoning

### Lifecycle from local clock vs on-chain `oracle::status`

`computeLifecycle()` mirrors the **exact** precedence from
[oracle.move:290-300](https://github.com/MystenLabs/deepbookv3/blob/predict-testnet-4-16/packages/predict/sources/oracle.move#L290-L300):

```
Settled  >  PendingSettlement  >  Inactive  >  Active
```

We compute this locally with `BigInt(Date.now())` rather than calling
`devInspectTransactionBlock` on the `oracle::status` view function.
Trade-off:

- **Cheaper**: one less RPC per inspect.
- **Less authoritative**: our `nowMs` is the host clock, the chain uses
  Sui Clock at the next checkpoint. For end-of-life oracles right at the
  expiry edge we could disagree for a few seconds.
- **Mitigation for risky paths (Day 8 mint, Day 10 redeem)**: rely on
  the chain's own assertion (`assert_live_oracle` / `assert_quoteable_oracle`),
  which reverts safely. Our lifecycle is for **display**, not gating.

### Position iteration via dynamic fields, not via `getOwnedObjects`

`PredictManager.positions` is `Table<MarketKey, u64>` — table entries are
**dynamic fields owned by the table**, not by the user. So the right RPC
sequence is:

1. `getDynamicFields({ parentId: positionsTableId })` — paginated list
   of `{ name, objectId, type, … }`.
2. For each entry, `getDynamicFieldObject({ parentId, name })` returns
   the parsed Move entry containing `{ name: MarketKey, value: u64 }`.

`fetchAllDynamicFields()` paginates with `cursor` until `hasNextPage=false`.
Empty tables (size 0) return zero pages — no errors, just an empty array.

### Quote balance via devInspect

`getQuoteBalance` builds a `Transaction` calling
`${PACKAGE_ID}::predict_manager::balance<Quote>(manager)` and uses
`devInspectTransactionBlock`. The return value is `[bytes, type]` where
`bytes` is a little-endian u64 — `decodeU64LittleEndian` folds it into a
bigint. No signing, no gas. Works even when the manager is empty.

### `i64::I64` decoding

The Move `i64::I64` surfaces as
`{ is_negative: bool, magnitude: "u64-string" }` in the Move content of
the OracleSVI's SVI struct. `parseI64()` reads both fields and applies
the sign — returning `bigint`, not `number`, since `magnitude` can be
larger than `Number.MAX_SAFE_INTEGER`.

### Oracle freshness — `.env` swap

The Day-2 oracle (`0x990e6e…d8e5ca`) settled overnight at
`settlement_price = 80400807788399` ≈ **$80,400.81**. Picked a fresh
Active BTC oracle from `GET /oracles`:

```
ORACLE_OBJECT_ID=0x3d7033b21ac61a9cf5c5f0a442164da0375fae8b9b55b7c105d2be599bcc1b7b
expiry          2026-05-13T12:00:00Z   (≈ 3h ahead of inspect run)
```

**Day 8 will need its own freshness check** — the plan should grab the
longest-expiry active oracle automatically, not hardcode one.

## 4. Surprises / things worth noting

- **`rho` is positive on this oracle** (`+297355744 / 1e9 ≈ +0.30`),
  contradicting the source's "typically negative — puts more expensive"
  comment. Testnet pricing isn't necessarily symmetric to mainnet
  conventions; just observe what the live oracle says.
- **18 oracles settled in 24h** — `settled_oracles.size` went 2163 → 2181
  between Day 3 and Day 4. The protocol runs ~15-minute expiry buckets,
  so this fits an active testnet (1 oracle every ~80 min on average).
- **10 authorized caps on the oracle** — there isn't one operator
  pushing prices; 10 distinct keys are allowed. Useful to remember if
  oracle staleness becomes a debugging question.

## 5. Open questions / carry-overs

1. **Auto-discover a long-expiry Active oracle** — Day 5 builds the
   server client; can use it on Day 8 to pick the right oracle without
   hardcoding `ORACLE_OBJECT_ID`.
2. **Strike-matrix walk** — `vault.oracle_matrices` is a `Table<ID, …>`
   keyed by oracle id. If Day 8 ends up needing to discover valid strikes
   on a given oracle for a mint, we'll iterate this table's dynamic
   fields the same way we did positions. Not blocked yet.
3. **`predict::get_trade_amounts` devInspect** for pre-mint cost preview
   on Day 8 — same pattern as `getQuoteBalance`, with two return values
   `(u64, u64)`. Will need to read `results[0].returnValues[0]` and
   `[1]` separately.

## 6. Successful Transactions

None today — Day 4 is read-only.

## 7. Tomorrow's Starting Point — Day 5

`src/lib/server.ts` + `npm run markets`.

1. `src/lib/server.ts` with typed fetch wrappers:
   - `listOracles({ status?, sortBy? })` — backed by `GET /oracles`
     (already verified working).
   - `listManagers({ owner })` — backed by `GET /managers?owner=…`.
   - `getStatus()` — backed by `GET /status` (lag/health probe).
2. Use `zod` to validate the response shape — the indexer is third-party,
   should not trust raw shapes.
3. `src/scripts/markets.ts`: list active oracles in a compact table —
   for each: oracle_id (short), underlying, expiry, hours-to-expiry,
   spot, status.
4. Add `"markets": "tsx src/scripts/markets.ts"` to `package.json`.
5. **Verify** that the active list matches what `inspect`'s oracle
   section shows (intersect by `oracle_id`).
