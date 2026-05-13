# Day 9 — Mint binary edge cases + opposite direction

**Date:** 2026-05-13
**Branch pin:** `predict-testnet-4-16`

> Plan deliverable: mint both `up` and `down`, observe two rows in the
> position table, document premium asymmetry. **Execution blocked on
> DUSDC; this day is the dry-run-only equivalent.**
>
> The plan's stated goal is "the moment you feel 'this is options, not
> betting'" — accomplished today through 9 simultaneous UP+DOWN
> previews on the live BTC oracle (§2).

---

## 1. What was added

```
src/scripts/preview.ts   # tabular UP+DOWN preview across a strike ladder
package.json             # "preview" npm script
```

Pure observational tool — no new PTBs, just composes
`buildTradeAmountsPreviewTx` from Day 8 over multiple (strike,
direction) pairs and prints the result as a table.

Refactor along the way: rotated `ORACLE_OBJECT_ID` in `.env` from
yesterday's `0x3d7033b2…` (settled at 12:00 UTC) to today's
`0xe768ff79…` (expires 14:00 UTC).

Tests: 24/24 still green (no source changes touched logic). Typecheck
clean.

## 2. Live preview surface

Oracle `0xe768ff79…` (BTC, expiring 14:00 UTC, ~1.5h ahead):

```
  spot     : $80,335.45
  forward  : $80,334.61
  qty      : 1 ($1 of max-payout per contract)

strike     UP ask   UP bid    DOWN ask  DOWN bid    ask sum    1 - sum
─────────────────────────────────────────────────────────────────────────
$78,000      —         —          —         —          —          —
$79,000    $1.000   $0.9949    $0.0051   $0.0000    $1.0051    -$0.0051
$80,000    $0.837   $0.8223    $0.1777   $0.1626    $1.0150    -$0.0150
$80,500    $0.327   $0.3088    $0.6912   $0.6726    $1.0186    -$0.0186  ← peak
$81,000    $0.037   $0.0266    $0.9734   $0.9634    $1.0100    -$0.0100
$82,000    $0.005   $0.0000    $1.0000   $0.9950    $1.0050    -$0.0050
$83,000      —         —          —         —          —          —
```

This is the practical end of "is this options or betting" — observably
**options**.

### 2a. Put-call parity (with margin)

The fair (mid) price of UP + DOWN at a single strike must equal $1.00 —
either the price settles above or below, so one side always pays
exactly $1 face value. Empirically:

```
strike $80,500 (closest to spot):
  fair_up   ≈ (ask + bid) / 2 = (0.3274 + 0.3088) / 2 = $0.3181
  fair_down ≈ (0.6912 + 0.6726) / 2                   = $0.6819
  sum                                                  = $1.0000
```

Put-call parity holds to machine precision. The asymmetry between UP
and DOWN ask quotes is **the protocol's spread**, not a violation of
parity.

### 2b. Protocol margin if you bought both directions

```
margin = ask_up + ask_down - $1.00
```

| Strike | Margin |
|--------|--------|
| $79,000 | $0.0051 (0.5%) |
| $80,000 | $0.0150 (1.5%) |
| **$80,500** | **$0.0186 (1.9%)** ← peak |
| $81,000 | $0.0100 (1.0%) |
| $82,000 | $0.0050 (0.5%) |

Buying both directions guarantees a $1 payout but costs $1.005–$1.019
— the protocol pockets the difference. The shape **peaks at ATM** and
narrows toward both wings.

### 2c. Bid-ask spread (within one direction)

| Strike | UP B/A spread | DOWN B/A spread |
|--------|---------------|-----------------|
| $79,000 | $0.0051 | $0.0051 |
| $80,000 | $0.0151 | $0.0151 |
| $80,500 | $0.0186 | $0.0186 |
| $81,000 | $0.0100 | $0.0100 |
| $82,000 | $0.0050 | $0.0050 |

**The bid-ask spread within a direction equals the protocol margin if
you bought both.** That's not a coincidence — the spread quote is
symmetric around the fair price:

```
ask_up - bid_up = fair_up + half_spread - (fair_up - half_spread) = spread
ask_up + ask_down - $1 = (fair_up + half_spread) + (fair_down + half_spread) - $1 = spread
```

So `UP B/A spread = DOWN B/A spread = protocol margin if buying both`.
All three columns are the same number. Confirmed empirically.

### 2d. Implied probability surface

If you take **mid prices** as truth:

| Strike | P(BTC > strike at 14:00 UTC) |
|--------|------------------------------|
| $79,000 | ~99.5% |
| $80,000 | ~83.0% |
| $80,500 | ~31.8% |
| $81,000 | ~3.2% |
| $82,000 | ~0.5% |

That curve is the cumulative distribution of (settlement price). The
sharp drop from $80,000 (83%) to $80,500 (32%) over a $500 strike
window says the **SVI is implying ~3.5% vol** over the 1.5h window for
this oracle (rough back-of-envelope: σ × √t × spot × 1.0 ≈ $500/0.51-z
≈ $980 → annualized vol calc requires more care, but the order of
magnitude is sane).

## 3. Edge cases — strike-grid validation

The plan asked for "strike outside the oracle's grid". Two distinct
failures, both from `oracle_config::assert_valid_strike` with abort
code `2`, but at different instruction indexes:

| Test | Result | Module / Function |
|------|--------|-------------------|
| `--strike 80500.5` (off-tick, $0.5 between ticks) | MoveAbort | `oracle_config::assert_valid_strike` instr 35 |
| `--strike 10000` (below min_strike of $50,000) | MoveAbort | `oracle_config::assert_valid_strike` instr 24 |

Same function, two checks — instruction `24` is the `min_strike` lower
bound, instruction `35` is the tick alignment. The same abort code
covers both — so an error message that just says "abort code 2" won't
disambiguate; reading the instruction index does.

Implication: **Day 8's pre-flight does NOT currently validate strike
against the grid.** The dry-run devInspect catches it, but only at
gate 4 (the final mint devInspect), and produces this verbose
MoveAbort. Tomorrow's nice-to-have: add a local pre-flight that does
`(strike - min_strike) % tick_size === 0n && strike >= min_strike` to
fail with a friendlier message.

### Why $78k and $83k previews aborted

Both fall inside the oracle's strike grid ($50,000–???, tick $1).
The likely cause: at these strikes, the fair price computed by SVI
hits the **min ask floor** or **min bid floor** of pricing_config —
the same failure mode as Day 8's $85k UP case. Specifically,
`pricing_config::quote_spread_from_fair_price` aborts (code 1) when
both sides would land at the floor.

We didn't dig further — these edge strikes aren't economically
sensible to mint anyway (deep OTM with vol-implied probability < 0.5%).

## 4. What "the moment" felt like

Concretely:

- Looking at the $80,500 row: ask $0.33 means **the protocol estimates
  31.8% probability BTC closes above $80,500 in 1.5 hours**. Spot is
  $80,335. To hit $80,500 needs +0.21% in 90 minutes. Annualized that
  means a ~1.4σ move per day. Sane.
- The fact that ask + ask > $1.00 by exactly the same amount as the
  bid-ask spread tells you the protocol is a **single-spread quoter**
  on fair prices, not two independent legs. The spread is one number
  applied symmetrically.
- The bell-curve of the spread (peaks at ATM) matches options-market
  intuition: dealers want margin where uncertainty is highest. Deep
  OTM the directional risk is low, deep ITM the gamma is low too —
  both wings get tighter spreads.

## 5. Plan deliverable status

| Plan item | Met? | How |
|---|---|---|
| Mint UP — succeed | **No** (DUSDC blocker) | Preview cost = $3.27 at $80,500/qty 1 |
| Mint DOWN at same strike — succeed | **No** (DUSDC blocker) | Preview cost = $6.91 at $80,500/qty 1 |
| See two rows in `manager.binary_positions` | **No** (no mint) | `manager.positions` table walking already verified empty case on Day 4 |
| Document premium asymmetry | **Yes** | §2 above |
| `P(up) + P(down) ≈ 1` arithmetic feels tangible | **Yes** | §2a — exactly $1.0 to machine precision |

3 of 5 deliverables met. Same DUSDC blocker as Days 6–8.

## 6. Successful Transactions

None today.

## 7. Open questions / carry-overs

1. **Local strike-grid pre-flight** — see §3. Cheap addition for
   Day 15 polish: read the oracle's `oracle_config.oracle_grids` entry
   (a dynamic field keyed by oracle id) to get `min_strike`, `max_strike`,
   `tick_size`, then check locally before devInspect. Better error
   messages, fewer wasted RPCs.
2. **`get_trade_amounts` doesn't enforce the ask cap** — confirmed
   on Day 8 ($80k UP gave $1.00 ask, would abort on mint). Could add
   another pre-flight gate that compares preview-ask against
   `pricing_config.max_ask_price` (= $0.99) and refuses if at/above.
3. **Implied probability surface** — the table in §2d would be a useful
   `npm run prob -- --strikes K1,K2,K3` script: take a strike list,
   show probabilities. Not in the plan, but useful for understanding
   the market.

## 8. Tomorrow's Starting Point — Day 10

Redeem PTB.

1. Build `src/ptb/redeem.ts`: `buildRedeemTx(ctx, { oracleId, key, qty })`
   that constructs the MarketKey the same way as mint and calls
   `predict::redeem<Quote>(...)`. The function signature is identical
   to mint apart from the name.
2. Build `src/scripts/redeem.ts`. Reuse the 5-gate pattern:
   - **Pre-flight**: oracle is `Active` OR `Settled` (NOT
     `PendingSettlement` — that's the dead zone, per Day 1 §4.4 source
     reading).
   - **Preview**: call `predict::get_trade_amounts` to show expected
     payout.
   - **Position check**: verify `manager.binary_positions[key] >= qty`
     before signing.
   - **Confirm prompt** (default true; --yes to skip).
3. Test against the existing empty manager — expect a clean error like
   "no position for (oracle, strike, isUp)".
4. The plan also asks for redeeming a **Settled** oracle. When DUSDC
   comes, we'll need an oracle that's actually settled with a position
   we still hold — that's a multi-step manual test. Build first,
   schedule the test later.
