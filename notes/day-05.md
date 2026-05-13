# Day 5 — Predict Server API client

**Date:** 2026-05-13
**Branch pin:** `predict-testnet-4-16`

> Deliverable: `npm run markets` lists active markets fetched from the
> server (not on-chain). **Met.**

---

## 1. What was added

```
src/lib/server.ts       # zod-validated fetch wrappers: getStatus, listManagers, listOracles, findActiveOracles
src/scripts/markets.ts  # table printer with --asset, --limit, --all, --json flags
test/server.test.ts     # 5 tests for findActiveOracles (pure function)
package.json            # added "markets" script
```

Tests: **19/19 green**. Typecheck: clean.

## 2. Server API surface — what's actually there

A thorough probe of plausible paths confirms the Predict Server exposes
only four routes (HTTP 200):

| Method | Path | Use |
|---|---|---|
| GET | `/health` | liveness — empty 200 |
| GET | `/status` | indexer lag + per-pipeline stats |
| GET | `/managers` | list `PredictManagerCreated` events; supports `?owner=` |
| GET | `/oracles` | full oracle table (no server-side filtering) |

Everything else (`/positions`, `/portfolio`, `/vault`, `/markets`,
`/api/v1/…`) returns 404. The plan's "vault summary / portfolio"
endpoints don't exist on this deployment — the server is an event
indexer with a thin REST head, not an app API. Filtering happens
client-side.

### Query-param behaviour

- `/managers?owner=<addr>` — **respected** (1 result for our addr).
- `/oracles?status=…` / `?underlying=…` / `?limit=…` / `?expiry_min=…` —
  **ignored**; every variant returned the same 2200 rows.

So `listOracles()` fetches the whole table and `findActiveOracles()`
does the filtering in-process.

## 3. Verification — server view matches on-chain view

```
$ npm run --silent markets -- --limit 3
19 active oracles (showing up to 3):

oracle_id          asset  expiry (UTC)          in    status
-----------------  -----  --------------------  ----  ------
0xe9d3a9b1…191387  BTC    2026-05-13T09:00:00Z  0.2h  active
0x44a398d8…d0c87a  BTC    2026-05-13T09:15:00Z  0.5h  active
0x26aff187…eaccfe  BTC    2026-05-13T09:30:00Z  0.7h  active
```

Cross-check: the `.env` `ORACLE_OBJECT_ID` (`0x3d7033b2…cc1b7b`,
expiry `1778673600000`, status `active`) appears as row 10 of the
active list — same expiry timestamp, same status. **Server and chain
agree on this oracle's identity.**

## 4. Subtleties worth remembering

### Two oracle clocks

The server's `status` is the **last on-chain status event** — it does
NOT re-evaluate against wall-clock. An oracle whose `expiry` has
passed but hasn't received its post-expiry price push will still say
`status: active`. So `findActiveOracles` checks three things, not one:

```
status === 'active'
&& settlement_price === null
&& expiry > now
```

A stale server payload could disagree with on-chain for a few seconds
to minutes per oracle. Acceptable for discovery; **not** acceptable for
final mint/redeem gating — those rely on the chain's own
`assert_live_oracle` / `assert_quoteable_oracle` reverts.

### `event_digest` vs `digest`

`/managers` responses include both. `event_digest` is Sui's
`<tx_digest>:<event_index>` BCS-encoded; `digest` is just the tx
digest. Code uses `digest` — `event_digest` is duplicate information.

### zod-validated responses

`fetchJson()` is generic over a zod schema. If the indexer changes its
shape under us (new field, renamed field, type drift), the script fails
with a precise error path like:

```
GET /oracles: response shape unexpected — [3].expiry: Expected number, received string
```

This was already useful while building — early drafts assumed
`status: z.enum(['active', 'settled'])` and zod flagged that the real
status enum also includes `inactive` and `pending_settlement`. Real
testnet data taught us the full domain.

## 5. Open questions / carry-overs

1. **Day 6 picks**: deposit doesn't need the server at all (depositing
   into our own manager). The plan's Day 6 needs no server work.
2. **Day 7 (reflection)**: re-evaluate whether `server.ts` is too
   thin. Right now it has just three functions; if we want
   per-pipeline tail-reading (e.g., a `getRecentMints(predictId)`),
   we'd have to fetch all 2200 entries from `/oracles` plus build
   additional clients per pipeline endpoint — but those endpoints
   don't exist publicly. May simply not be possible.
3. **Day 8 oracle auto-pick**: use `findActiveOracles(oracles)` then
   `[oracles].sort((a,b) => b.expiry - a.expiry)[0]` to grab the
   longest-runway oracle. Don't trust a single oracle hardcoded in
   `.env` for the mint flow — re-discover at script-start.

## 6. Successful Transactions

None today — pure read path.

## 7. Tomorrow's Starting Point — Day 6

`src/ptb/deposit.ts` + `src/scripts/deposit.ts` + `src/ptb/withdraw.ts`
+ `src/scripts/withdraw.ts`. Both still **blocked on DUSDC supply** for
end-to-end testing, but the build itself is unblocked.

1. `src/ptb/deposit.ts`: `buildDepositTx(ctx, { amount, coinType })`
   returns a `Transaction`. Inside:
   - Find the user's DUSDC coins via `getCoins({ owner, coinType })`.
   - If multiple, merge into one with `tx.mergeCoins` (largest first).
   - Split off the target amount with
     `tx.splitCoins(largestCoin, [amount])` and pass the new coin into
     `tx.moveCall({ target: '${PACKAGE_ID}::predict_manager::deposit', typeArguments: [coinType], arguments: [tx.object(managerId), splitCoin] })`.
2. `src/ptb/withdraw.ts`: a single `moveCall` to
   `${PACKAGE_ID}::predict_manager::withdraw<Quote>` that returns a
   `Coin<Quote>`; transfer it to the sender with
   `tx.transferObjects([coin], tx.pure.address(senderAddr))`.
3. `src/scripts/deposit.ts` / `src/scripts/withdraw.ts`:
   - Parse `--amount` from argv (zod-validate as positive integer
     string, then bigint).
   - `requireKeypair(cfg)` — Day 6 is the first signing day, so
     PRIVATE_KEY becomes required here.
   - Dev-inspect first (catch errors without paying gas).
   - On real run, `signAndExecuteTransaction({ transaction: tx, signer })`.
   - Print the digest + balance change.
4. **`--amount` semantics**: accept human DUSDC (e.g. `100` = 100
   DUSDC) and scale by `10^6` internally. Document this on the CLI's
   `--help`.
5. Verification once DUSDC is available: run deposit, then
   `npm run inspect` should show non-zero `quote_balance`. Then
   withdraw the same amount; balance back to 0.
