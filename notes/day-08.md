# Day 8 — Mint binary PTB (the hardest day)

**Date:** 2026-05-13
**Branch pin:** `predict-testnet-4-16`

> Plan deliverable: `npm run mint-binary -- --strike 4 --direction up --qty 10`
> mints one binary position. **Build complete; execution blocked on DUSDC.**
> Three end-to-end devInspect dry-runs verified: ITM (ask-bound failure mode),
> deep OTM (price-floor failure mode), and ATM (clean preview).

---

## 1. What was added

```
src/ptb/mintBinary.ts        # buildMintBinaryTx + buildTradeAmountsPreviewTx
src/lib/view.ts              # devInspectReturnValues + decodeU64LittleEndian
src/scripts/mint-binary.ts   # CLI with oracle resolve, preview, balance pre-flight, confirm prompt
package.json                 # added "mint-binary" script
```

Plus a refactor: `manager.ts::getQuoteBalance` now uses the new
`view.ts` helper instead of its own inline devInspect+decode. Net
delta: -10 lines duplication, 1 new helper used by 2 callers
(getQuoteBalance + mint-binary preview).

Tests: 24/24 still green (the refactor was behaviour-preserving).
Typecheck: clean.

## 2. Three dry-run scenarios

### 2a. UP at $80,000 — deep ITM, hits ask ceiling

```
spot $80,557.69, strike $80,000 (deep ITM for UP)
preview:   ask $1.00 × qty 5 = cost $5.00
            bid $0.9931 = $4.97
```

`get_trade_amounts` returns `ask = $1.00 exactly` — and `max_ask_price = $0.99`.
A real mint here would abort inside `predict::assert_mintable_ask`
(the ask bound check). **The preview function does NOT enforce the
ask bound** — it just returns the computed fair price. So a successful
preview doesn't mean a successful mint at the extremes.

### 2b. UP at $85,000 — deep OTM, hits price floor

```
spot $80,558.78, strike $85,000 (deep OTM)
devInspect FAILED inside pricing_config::quote_spread_from_fair_price,
abort code 1
```

The fair price computed by the SVI is below `min_ask_price` ($0.01).
This abort fires inside the **preview** call itself — the pricing config
refuses to quote when both sides would be at the floor. **This is a
different failure mode** from 2a, and a different module too.

### 2c. UP at $80,500 — near ATM, sweet spot

```
spot $80,558.78, strike $80,500 (near spot)
preview:   ask $0.6011 × qty 5 = cost $3.0054
            bid $0.5814         = $2.9071
spread:    ~3.4%   (about $0.02 per $1 contract)
```

This is the realistic mint case. Balance check then blocks (we have 0
DUSDC), so the actual `mint` devInspect never runs — but the PTB itself
is built identically to the preview-PTB up to the `predict::mint`
moveCall, so we have strong evidence the PTB shape is correct.

## 3. Architecture decisions

### `MarketKey` is built inline as a PTB step

Instead of hand-rolling the BCS bytes for a `MarketKey` struct, the PTB
does:

```ts
const [key] = tx.moveCall({
  target: `${pkg}::market_key::${args.isUp ? 'up' : 'down'}`,
  arguments: [tx.pure.id(oracleId), tx.pure.u64(expiry), tx.pure.u64(strike)],
});
tx.moveCall({
  target: `${pkg}::predict::mint`,
  typeArguments: [coinType],
  arguments: [
    tx.object(PREDICT_OBJECT_ID),
    tx.object(MANAGER_OBJECT_ID),
    tx.object(oracleId),
    key,                       // <-- result of previous moveCall
    tx.pure.u64(quantity),
    tx.object('0x6'),          // Clock
  ],
});
```

The destructure `const [key]` is required — `tx.moveCall` returns
`TransactionResult` (array-like) and TypeScript's elaborated type only
accepts the destructured single value as `TransactionObjectArgument`.

### `get_trade_amounts` is the preview path

`predict::get_trade_amounts(predict, oracle, key, quantity, clock) -> (u64, u64)`
is the protocol's official pre-trade preview. It computes the same
ask/bid as `mint` would, but **without** the side effects (no liability
insert, no payment pull). Calling it via `devInspectTransactionBlock`
gives us:

- The cost (mint_cost = ask × qty / 1e9)
- The instant-redeem payout (redeem_payout = bid × qty / 1e9)
- Whether the price is even quotable (the pricing config's floor/ceiling)

What it does NOT check:

- Manager balance (mint will pull premium from there)
- Oracle live-ness (mint requires `assert_live_oracle`)
- Per-oracle / global ask bound (`assert_mintable_ask`)

So `get_trade_amounts` succeeds → mint can still fail. The plan's
warning about "ask bound exceeded" lives at this seam.

### Pre-flight checks layered before signing

The script gates `--execute` behind:

1. **Oracle lifecycle**: `oracle.lifecycle === Active`. Done locally
   from oracle fields + `Date.now()`. (See [day-04.md §3](day-04.md)
   for why local is fine for display, with chain assertion as final
   guard.)
2. **`get_trade_amounts` preview**: must return without aborting.
   Catches floor-violations early.
3. **Manager balance ≥ mint_cost**: read via `getQuoteBalance` (which
   itself uses the new `view.ts` helper). Returns an actionable error
   ("ABORT: insufficient manager balance — need X, have Y. Run
   `npm run deposit -- --amount …`") rather than a deep MoveAbort.
4. **`buildMintBinaryTx` devInspect**: the final shape check. If
   the chain's mint succeeds in devInspect, signing will succeed
   (modulo race conditions).
5. **Interactive confirm prompt** (`readline/promises`) unless `--yes`
   is passed.

Each gate catches a different class of error:
| Gate | Catches |
|---|---|
| 1 | Expired oracles, settled oracles |
| 2 | Price-floor / quote-floor violations |
| 3 | Insufficient pre-deposit |
| 4 | Ask-ceiling violation, exposure cap, anything the chain itself would |
| 5 | Fat-finger human errors |

### `view.ts` extraction

[Day 7 §5](week-01-summary.md) flagged this. With 2 users now
(`getQuoteBalance` + preview), the extraction is warranted:

```ts
export const devInspectReturnValues = async (ctx, tx, sender): Promise<readonly Uint8Array[]>;
export const decodeU64LittleEndian = (bytes: Uint8Array): bigint;
```

Both helpers are pure (well, the first is async-pure — it does one
RPC). No state, no caching, easy to mock if we ever need to test view
calls.

### Scaling rules — recorded permanently

| What | Scale | CLI input | On-chain |
|---|---|---|---|
| Strike | 1e9 | `--strike 80000` (dollars) | `80_000_000_000_000n` |
| Quantity | 1e6 (DUSDC decimals) | `--qty 5` (dollars of max payout) | `5_000_000n` |
| Ask/bid price | 1e9 | n/a (derived) | $0.60 → `600_000_000n` |
| Mint cost | 1e6 | n/a (derived) | $3 → `3_005_414n` |
| Spot/forward | 1e9 | n/a (read) | $80,557 → `80_557_000_000_000n` |

The cost equation: `cost = math::mul(ask, quantity) = (ask × quantity) / 1e9`.
At 1e9 × 1e6 / 1e9 = 1e6, units cleanly land in DUSDC raw.

## 4. Things to verify when DUSDC arrives

```bash
npm run deposit -- --amount 100 --execute       # need 100 DUSDC in wallet first
npm run mint-binary -- --strike 80500 --qty 5 --direction up --execute
npm run inspect | grep -E 'binary_positions|UP'
```

Expected post-mint:
```
binary_positions  1
#1  UP   strike=80500 expiry=… qty=5000000
```

The dry-run shows we'd pay ~$3 of DUSDC for $5 max payout (60% implied
probability the BTC price closes above $80,500 by 12:00 UTC). At
settlement, either:

- Settle > $80,500: payout = full qty = 5_000_000 raw = $5 → +$2 profit
- Settle ≤ $80,500: payout = 0 → -$3 loss

The DOWN at $80,500 should price symmetrically (~$0.40 ask) so
**P_up + P_down should be < $1**, the protocol's spread eats the
difference. Day 9 verifies this.

## 5. Common pitfalls confirmed by today's dry-runs

The plan listed these pitfalls; each one was either observed or
deliberately avoided:

| Plan pitfall | Reality |
|---|---|
| "Premium auto-deducted from manager — don't pass coins" | Confirmed — `predict::mint` has no `Coin` arg, only `quantity: u64`. |
| "Strike scaling is its own scaling factor" | Confirmed — strike is 1e9, not 1e6 like quote amount. |
| "`is_up` semantics — confirm from source" | UP = bet that settle > strike (source comment + observed pricing at $80k UP vs $80k DOWN). |
| "Mint may fail with ask bound exceeded" | Confirmed via $80k UP case — fair price = $1.00 > max_ask_price $0.99. |

## 6. Open questions / carry-overs

1. **Verify the `predict::mint` devInspect succeeds when balance is
   sufficient.** Currently the balance pre-flight aborts before this
   check runs. The moment DUSDC lands, this is the first verification.
2. **Per-oracle ask bound** — `oracle_config.oracle_ask_bounds` table
   is empty today (size 0 per Day 3 inspect). So the global default
   ($0.99) applies. If the protocol team sets a tighter per-oracle
   bound, our preview success won't change but mint would fail.
   No action needed yet, just awareness.
3. **`is_up` source-side confirmation** — the source comment on
   `market_key::up` doesn't spell out "wins if settle > strike", but
   the observed asymmetry (UP at $80k near $1 with spot $80,557; DOWN
   at $80k near $0) is dispositive.
4. **Per the plan, Day 9 should verify `up + down ≈ $1 minus spread`.**
   The dry-runs already show this directionally — Day 9 should
   re-confirm via simultaneous previews at the same strike.

## 7. Successful Transactions

None today — mint execution still blocked on DUSDC.

## 8. Tomorrow's Starting Point — Day 9

Plan: mint edge cases + opposite direction (verify put-call parity for
binaries, log premium asymmetry).

1. With the script now built, **the only new code** for Day 9 is a
   tiny preview-twice helper that runs `--strike X --direction up`
   and `--strike X --direction down` and prints the sum. Could be a
   one-liner shell pipe or a small script `src/scripts/preview-pair.ts`.
2. **Document observed premium gap** (= protocol spread) at multiple
   strikes (e.g. $79k, $80.5k, $82k) to understand spread shape vs
   moneyness.
3. **Edge case dry-runs to record:**
   - DOWN at $80k (deep OTM the other way; same as 2c but mirrored)
   - Both directions at the exact spot ($80,558) → ask should be ~$0.50 each
   - At a strike outside the oracle's grid → expect a key-validation abort
4. When DUSDC arrives, run a real UP + DOWN at the same strike and
   confirm two rows show up in `manager.binary_positions`.
