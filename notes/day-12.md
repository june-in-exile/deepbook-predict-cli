# Day 12 — LP Withdraw PTB

**Date:** 2026-05-13
**Branch pin:** `predict-testnet-4-16`

> Plan deliverable: `npm run lp-withdraw -- --shares 500` burns PLP and
> returns DUSDC. **Build complete; both pre-flight failure modes
> exercised. Execution gated on DUSDC + a prior lp-supply.**

---

## 1. What was added

```
src/ptb/lpWithdraw.ts        # PLP merge + split + withdraw + transfer
src/scripts/lp-withdraw.ts   # CLI with availability pre-flight
src/lib/predict.ts           # +vaultTotalMaxPayout field
package.json                 # added "lp-withdraw" npm script
```

Tests: 24/24 still green. Typecheck clean.

## 2. Two failure modes — both pre-flightable

### 2a. Availability gate

The chain enforces ([`predict.move:485-491`](https://github.com/MystenLabs/deepbookv3/blob/predict-testnet-4-16/packages/predict/sources/predict.move#L485-L491)):

```move
let amount = predict.shares_to_amount(shares_burned, vault_value);
let balance = predict.vault.balance();
let max_payout = predict.vault.total_max_payout();
let available = if (balance > max_payout) { balance - max_payout } else { 0 };
assert!(amount <= available, EWithdrawExceedsAvailable);
```

We mirror this exactly in the script's gate 3. Verified live:

```
$ npm run lp-withdraw -- --shares 5000000

  shares to burn:        5000000 PLP
  vault balance:         1001703.710553 DUSDC
  total_max_payout:      347.92 DUSDC
  available to withdraw: 1001355.790553 DUSDC
  preview amount out:    5001822.779639 DUSDC

  ABORT (pre-flight): would withdraw 5001822.779639 DUSDC, but only
  1001355.790553 is available. The vault must keep 347.92 in reserve…
```

Cleanly aborts **before** building the PTB or making the second RPC.
The chain would otherwise have produced a `MoveAbort EWithdrawExceedsAvailable`
several seconds later.

### 2b. Rate limiter (currently disabled)

The chain *also* calls `withdrawal_limiter.consume(amount, clock)` —
this is the per-rolling-window limiter. Today on testnet `enabled: false`,
so it never blocks. The script's `printSummary` surfaces the limiter
state so the user knows what could change.

If the limiter is ever enabled, the consume call could revert even
after passing gate 3. We **don't currently pre-flight that** — it'd
require reading the rate-limiter state (`capacity`, `available`,
`refill_rate_per_ms`, `last_updated_ms`) and reimplementing the
windowed-bucket math. Out of scope today; Day 15 polish if it ever
matters.

## 3. `shares_to_amount` — three branches

Source ([`predict.move:799-806`](https://github.com/MystenLabs/deepbookv3/blob/predict-testnet-4-16/packages/predict/sources/predict.move#L799-L806)):

```move
fun shares_to_amount(predict, shares, vault_value): u64 {
    let total = predict.treasury_cap.total_supply();
    if (shares == 0 || total == 0) return 0;
    if (total == shares) return vault_value;       // last LP exits — no rounding loss
    mul_div_round_down(shares, vault_value, total)
}
```

Three branches:

| Case | Returns | Why |
|---|---|---|
| `shares == 0 || total == 0` | 0 | Degenerate |
| `shares == total` | vault_value (exact) | Avoid rounding loss when the last LP exits |
| Otherwise | `(shares * vault_value) / total` | Standard pro-rata |

We mirror this in `sharesToAmount()` in the script. The `shares == total`
fast path matters only if a single LP holds ALL outstanding PLP, which
is exotic — but the special case ensures full exit returns full vault
value with zero error.

## 4. Live numbers vs Day 11

| Field | Day 11 | Day 12 | Δ |
|---|---|---|---|
| vault.balance | $1,001,703.71 | $1,001,703.71 | 0 |
| vault.total_mtm | $304.26 | $304.26 | 0 |
| vault.total_max_payout | (not exposed) | $347.92 | new field |
| vault_value | $1,001,399.45 | $1,001,399.45 | 0 |
| PLP total supply | 1,001,034.51 | 1,001,034.51 | 0 |
| available_to_withdraw | (not computed) | $1,001,355.79 | new |

Nothing else moved in the ~5 minutes between dry-runs. Vault is quiet.

The **gap between `vaultMtm` ($304) and `total_max_payout` ($347)** is
the difference between mark-to-market liability and worst-case face
value. MTM uses current SVI fair prices; max_payout assumes every
position pays out $1 face. The gap ($43) represents the "if everything
goes against the vault simultaneously" tail.

## 5. Architecture decisions

### `vaultTotalMaxPayout` belongs on `PredictState`

After Day 11 added vaultBalance/Mtm/Value, this is the natural fourth
field. All four come from the same `vault` nested struct, all four
are useful for LP economics. The `PredictState` is becoming a real
"vault state snapshot" — about 7 numbers + 5 typed sub-objects.

### Pre-flight order matters

The script's gates run in this order:

1. `shares > 0`
2. **Preview amount + availability check** (no chain call beyond initial getPredict)
3. `fetchAllCoins<PLP>` — the wallet check
4. devInspect — chain-level
5. Confirm prompt

Gates 1 and 2 are CPU-only. Gate 3 needs one RPC. Gate 4 needs another.
If a user gives malformed input (shares=0 or shares too large), we
catch it before any RPC. If the inputs are sane but the user has no
PLP, that's caught in gate 3. If the chain rejects, gate 4. **Each
gate adds latency only when its check is necessary.**

### `mergeCoins<PLP>` + `splitCoins<PLP>` mirror the deposit pattern

We're now doing this for the third time (`deposit.ts`, `lpSupply.ts`,
`lpWithdraw.ts`). Each variant differs in the coin type and the
target moveCall. The merge-into-largest-then-split idiom is generic
enough that I could extract a `splitFromOwned(tx, owner, coinType, amount)`
helper. **Not extracting yet** — three uses with minor variations is
still in the "rule of three" zone, but the variants differ enough
that the abstraction would have to take 5 parameters. Will revisit
on Day 15.

## 6. Plan deliverable status

| Plan deliverable | Status |
|---|---|
| `npm run lp-withdraw -- --shares N` builds | ✅ |
| Returns DUSDC to user | ⚠️ structural (transferObjects wired); needs execution |
| Catches "withdraw exceeds available" gracefully | ✅ pre-flight gate 3 fires before chain |
| Surfaces rate-limiter status | ✅ shown in summary; disabled today |
| Decimal mismatch (PLP vs DUSDC) handled | ✅ both 1e6-scaled, no mismatch in practice |

## 7. Surprises / observations

- **PLP appears to be 1e6-scaled**, same as DUSDC. The plan flagged
  "PLP shares (likely 9 decimals?)" but the live `treasury_cap.total_supply`
  formats cleanly with 6 decimals (we displayed `1001034.5136` from
  raw `1_001_034_513_600`). The math also checks out at 1e6 scale:
  50 PLP × $1.000365 ≈ $50.018 — matches the preview output exactly.
  Worth confirming via `getCoinMetadata` for the PLP type, but the
  numerical evidence is strong.
- **The MTM↔max_payout gap ($43) is small** relative to either —
  about 12% of MTM. Either positions are mostly well-out-of-the-money
  (so worst-case ≈ realized) OR the vault has lots of offsetting
  positions across UP/DOWN at similar strikes. Without a position
  breakdown, hard to tell. Day 15 could add a per-oracle exposure
  view if interesting.
- **The protocol has consistent 1e6 scaling for all quote-denominated
  quantities** (balance, MTM, max_payout, PLP). Only prices and %s
  are 1e9-scaled. This is cleaner than I'd initially assumed.

## 8. Open questions / carry-overs

1. **PLP CoinMetadata** — confirm decimals via `suix_getCoinMetadata`
   on `${PACKAGE_ID}::plp::PLP`. Adds one line to inspect's setup.
2. **Rate-limiter pre-flight** — only matters if the limiter is ever
   enabled. Day 15 polish if it becomes relevant.
3. **`splitFromOwned` helper extraction** — three users now
   (deposit, lp-supply, lp-withdraw), but each varies in arg shape.
   Day 15 candidate.

## 9. Successful Transactions

None today — execution blocked on DUSDC + needing a prior LP supply.

## 10. Tomorrow's Starting Point — Day 13

Setup script + idempotency. The first "compose existing scripts" day.

1. Build `src/scripts/setup.ts`:
   - Check if `MANAGER_OBJECT_ID` env points to a valid shared
     PredictManager owned by the active sender. If not, call
     `predict::create_manager` and print the new id.
   - Check wallet DUSDC balance. Document the **DUSDC supply blocker**
     in the script's output (no faucet, only deployer can mint).
   - Check manager DUSDC balance. If below a threshold (e.g. $10),
     prompt to deposit (don't auto-deposit — that's surprising).
2. Idempotency: re-running `setup` must:
   - NOT create a second manager (read MANAGER_OBJECT_ID first).
   - NOT auto-deposit if balance is already sufficient.
3. Print a checklist at the end:
   ```
   ✓ wallet:    X DUSDC
   ✓ manager:   exists at 0xe55ea85b…
   ✓ deposited: Y DUSDC
   ✓ ready to:  mint-binary, redeem, lp-supply, lp-withdraw
   ```

This is the **operator-friendly day** — not a new PTB, but the
on-boarding workflow.
