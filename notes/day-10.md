# Day 10 — Redeem PTB

**Date:** 2026-05-13
**Branch pin:** `predict-testnet-4-16`

> Plan deliverable: `npm run redeem -- --market <key>` works for both
> Settled and not-yet-settled positions. **Build complete; one
> lifecycle path (Settled) verified with the lifecycle-summary; the
> other (Active early-exit) needs DUSDC + a real prior mint to fully
> verify. PendingSettlement path is empirically untestable.**

---

## 1. What was added

```
src/ptb/redeem.ts              # buildRedeemTx — symmetric to mint
src/scripts/redeem.ts          # 5-gate CLI with --oracle override
src/lib/manager.ts             # +getPositionQty() helper
package.json                   # added "redeem" npm script
```

Tests: **24/24 still green**. Typecheck: clean.

Same 5-gate pattern as Day 8's mint script, with one substituted
gate:

| Gate | Mint (Day 8) | Redeem (Day 10) |
|------|--------------|-----------------|
| 1 | oracle `Active` | oracle **`Active` or `Settled`** (NOT `Pending`/`Inactive`) |
| 2 | preview returns | preview returns |
| 3 | manager **balance** ≥ cost | manager **position** ≥ qty |
| 4 | devInspect mint OK | devInspect redeem OK |
| 5 | confirm prompt | confirm prompt |

Gate 3 swapped from `getQuoteBalance` to a new `getPositionQty` view
call — same `devInspectReturnValues` plumbing, different Move function.

## 2. Source-level findings (per Day 10 plan reading)

The redeem function is gated by a **different** quotability check than mint:

| Check | Mint (live pricing required) | Redeem (live OR final price) |
|-------|------------------------------|-------------------------------|
| `assert_live_oracle` | ✅ | — |
| `assert_quoteable_oracle` | — | ✅ |
| Accepts `Active + fresh` | ✅ | ✅ |
| Accepts `Settled` | ❌ | ✅ |
| Rejects `PendingSettlement` | ❌ (also rejected) | ❌ |
| Rejects `Inactive` | ❌ (also rejected) | ❌ |
| Staleness check | ✅ (`timestamp + threshold`) | ✅ |

[`oracle_config.move:200-225`](https://github.com/MystenLabs/deepbookv3/blob/predict-testnet-4-16/packages/predict/sources/oracle_config.move#L200-L225)
spells out the exact predicates. Both functions also have a
**staleness** check we haven't been able to trip on testnet (operators
push prices every few minutes).

`redeem_internal` ([`predict.move:747`](https://github.com/MystenLabs/deepbookv3/blob/predict-testnet-4-16/packages/predict/sources/predict.move#L747))
branches on `oracle.is_settled() && vault.has_settled_oracle(...)`:

- **Settled + snapshot in vault** → pays settlement-price bid.
- Otherwise (Active) → pays live SVI bid, removing the position's
  contribution from vault liability first ("Quote against the
  post-trade state so the seller is paid from the liability after
  their position has been removed").

The two paths route different math; the bid value differs subtly
between them. We log "Settled (fixed)" vs "Active (may move)" in the
script's preview output.

## 3. Live dry-run results

### 3a. Active oracle, no position owned

```
$ npm run redeem -- --strike 80500 --qty 1 --direction up

=== redeem binary UP ===
  oracle:             0xe768ff79… (Day 9's BTC oracle)
  underlying:         BTC
  lifecycle:          Active
  expiry (UTC):       2026-05-13T14:00:00.000Z
  spot:               80059.428839299
  strike:             80500
  ...
  position owned:     0 (raw)

  ABORT: position too small — owned 0, asking to redeem 1000000.
```

Gate 3 caught it cleanly. **`getPositionQty()` returns `0n` for missing
positions** (matches the Move source's `if contains else 0` branch);
no error from the devInspect itself.

### 3b. Settled oracle (Day 8's expired one)

```
$ npm run redeem -- --oracle 0x3d7033b2… --strike 80000 --qty 1 --direction up

  oracle:             0x3d7033b2…
  underlying:         BTC
  lifecycle:          Settled            ← gate 1 accepts
  expiry (UTC):       2026-05-13T12:00:00.000Z
  settlement price:   80468.480807678   ← BTC settled above $80,000
  strike:             80000
  direction:          UP
  position owned:     0 (raw)

  ABORT: position too small — owned 0, asking to redeem 1000000.
```

**The settlement price is $80,468.48**. Since strike was $80,000 and we
chose UP, this means an UP position at $80,000 settled **in the money**
— a holder would have received the full $1 face per contract. Without
DUSDC to have minted a position before expiry, we can't show the
payout, but the data confirms:

1. Lifecycle resolves correctly to `Settled` via local computation.
2. `settlement_price` field reads correctly (was `null` while Active).
3. Gate 1 accepts Settled (would have failed if we'd used the
   `assert_live_oracle` predicate by mistake).

### 3c. "Pending" oracle — could not test on testnet

I picked an oracle whose expiry had passed ~210s earlier from the
server's snapshot. By the time we made the on-chain `getObject` call,
**the operator had already pushed the settlement price**, flipping it
from `PendingSettlement` to `Settled`.

This is a **good operational signal**: the dead-zone window is short
in practice — under ~3 minutes. The gate logic is still present and
correct; the chain's `assert_quoteable_oracle` would also reject if
we somehow reached this state. We just can't easily trigger it for a
local test.

## 4. Architecture decisions

### `getPositionQty` mirrors `getQuoteBalance`

Both follow the same pattern:

```
build a Transaction calling a public view fn
  with the right args (MarketKey via market_key::up|down, or just manager)
→ devInspectReturnValues → decode LE u64
```

Three callsites for the view-call pattern now: `getQuoteBalance`,
`getPositionQty`, `previewTradeAmounts`. The Day 7 reflection note
predicted this — the abstraction earned its keep at use #2 (mint
preview); use #3 here makes it clearly the right call.

### Why redeem doesn't check `manager.balance`

Unlike mint, redeem **doesn't pull payment from the manager** — it
deposits payout *into* the manager. So gate 3 changed from "have
enough money" to "have the position".

### Symmetric PTB structure

The redeem PTB is literally the mint PTB with `predict::mint` →
`predict::redeem`. Same MarketKey constructor, same shared inputs,
same Clock argument. The only difference internal to the chain is
that redeem **doesn't take a `&mut Coin`** because the cost flow is
reversed (out, not in).

### What about `redeem_permissionless`?

The source exposes a second redeem variant for settled-only positions
that can be called by *anyone* (not just the owner) — useful for
keepers cleaning up after expiry. Routes payout to the manager's
"permissionless" balance. Out of scope for the MVP CLI (we're always
the owner); recorded here for future awareness.

### Partial redeem is supported

Plan asked "partial redeem vs full redeem". Source confirms it's
**parameterized by `quantity: u64`** — same as mint. Our script accepts
`--qty N` and the chain handles the partial-position math. No special
handling needed.

## 5. Plan deliverable status

| Plan deliverable | Status |
|---|---|
| `npm run redeem` builds | ✅ |
| Works for Settled oracle | ✅ structurally + lifecycle gate verified; payout untestable without prior mint |
| Works for Active oracle | ✅ structurally + lifecycle gate verified; same blocker |
| `manager.balance` increases after redeem | ❌ untestable without prior mint |

## 6. Open questions / carry-overs

1. **`predict::redeem_permissionless`** — alternative entry point;
   could be exposed via a `--permissionless` flag if we ever care
   about keeper flows. Not on the MVP path.
2. **Per-oracle staleness threshold** — the constant
   `staleness_threshold_ms` lives in `constants.move` (we didn't read
   it today). Worth a quick check on Day 15 to surface it in
   `inspect`'s output so we know how stale the live oracle is allowed
   to be.
3. **Race condition on Active redeem** — preview returns bid_X at
   time T, but actual execution at T+δ might price slightly
   differently. Plan didn't ask for it, but a `--max-slippage <pct>`
   flag would be a nice safety rail. Day 15 polish candidate.

## 7. Successful Transactions

None today — execution still blocked on DUSDC + needing a prior mint.

## 8. Tomorrow's Starting Point — Day 11

LP Supply PTB.

1. Build `src/ptb/lpSupply.ts`. Inputs: `Predict`, a `Coin<Quote>` (the
   user's DUSDC to supply), `Clock`. The PTB:
   - finds the user's DUSDC coins (same `getCoins` pattern as deposit),
   - splits off `amount`,
   - calls `predict::supply<Quote>(predict, coin, clock, ctx) -> Coin<PLP>`,
   - **transfers the returned PLP coin to the sender** (otherwise the
     PTB fails with an unused value error — recorded from Day 1).
2. Build `src/scripts/lp-supply.ts`. Pre-flight checks:
   - user has enough DUSDC,
   - preview the PLP shares minted via devInspect (the return value of
     `supply` is the share count; first supplier gets 1:1, subsequent
     get `mul_div_round_down(amount, total_supply, vault_value)`).
3. Verify on dry-run: amount 100 DUSDC → expected share count = `100 *
   total_supply / vault_value`. Numerically using Day 3 inspect: total
   supply will be roughly proportional to ~$1M vault, so 100 DUSDC →
   ~100 PLP if 1:1 (the protocol pioneered at 1:1 ratio but later
   suppliers see proportional).
4. After execution (when DUSDC arrives): `npm run inspect` should show
   a new owned PLP coin. We may need to add a PLP-balance line to
   inspect's PredictManager section.
