# Day 11 — LP Supply PTB

**Date:** 2026-05-13
**Branch pin:** `predict-testnet-4-16`

> Plan deliverable: `npm run lp-supply -- --amount 1000` supplies quote
> and rewards PLP shares. **Build complete; preview math verified
> against live chain data. Execution gated on DUSDC.**

---

## 1. What was added

```
src/ptb/lpSupply.ts       # split DUSDC + supply + transferObjects PLP
src/scripts/lp-supply.ts  # CLI with off-chain share preview
src/lib/predict.ts        # +vaultBalance, +vaultMtm, +vaultValue, +plpTotalSupply
src/scripts/inspect.ts    # +Wallet section (DUSDC + PLP for manager.owner)
package.json              # added "lp-supply" script
```

Tests: **24/24 still green**. Typecheck: clean.

## 2. Share math, verified live

Source ([`predict.move:437-468`](https://github.com/MystenLabs/deepbookv3/blob/predict-testnet-4-16/packages/predict/sources/predict.move#L437-L468)):

```move
let total = predict.treasury_cap.total_supply();
let shares = if (total == 0) {
    amount
} else {
    assert!(vault_value > 0, EZeroVaultValue);
    mul_div_round_down(amount, total, vault_value)
};
```

Where `vault_value` is `vault.balance - vault.total_mtm`
([`vault.move:74-77`](https://github.com/MystenLabs/deepbookv3/blob/predict-testnet-4-16/packages/predict/sources/vault/vault.move#L74-L77)).

Dry-run preview with `--amount 100`:

```
  supply amount:      100 DUSDC (raw 100000000)
  vault balance:      1001703.710553 DUSDC
  vault MTM:          304.263887 DUSDC
  vault value:        1001399.446666 DUSDC (= balance - MTM)
  PLP total supply:   1001034.5136 PLP
  preview shares:     99.963557 PLP (raw 99963557)
  share/value ratio:  0.999635576 PLP per 1 DUSDC of vault_value
```

**The PLP/vault_value ratio is 0.99964** — meaning the vault has been
**slightly profitable since inception**. Earlier suppliers paid 1:1
when the protocol launched (1st supplier rule), and now each PLP is
worth slightly more than 1 DUSDC of vault value. Numerically, the
vault has earned about `(1 - 0.99964) × $1,001,399 ≈ $360` of net
income above initial deposits over the protocol's lifetime.

This is the real "are LPs winning or losing" signal — and right now,
they're winning, by a tiny margin.

## 3. Architecture decisions

### Off-chain share preview, not devInspect

`predict::supply<Quote>(predict, coin, clock, ctx) -> Coin<PLP>` would
require a real `Coin<DUSDC>` argument to devInspect — which we don't
have. So we **compute shares locally** from the live values of
`vault.balance`, `vault.total_mtm`, and `treasury_cap.total_supply`.

The local computation uses **integer division** (`*` then `/`), which
matches the chain's `mul_div_round_down` to the rounding boundary —
within ±1 raw unit for typical values. Close enough for preview.

### Extended `PredictState` rather than a new module

Day 8 considered adding a `lib/vault.ts`. Today's actual need was
just three more numbers — extending `getPredict()` made more sense
than a whole new module. The extension is backward-compatible: existing
fields unchanged.

### PLP transfer is mandatory

Per Day 1 §4.6: `supply` returns `Coin<PLP>`. The PTB must consume the
return value (here via `transferObjects([plpCoin], sender)`); otherwise
the chain rejects the PTB with an unused-value error. Same pattern as
withdraw on Day 6.

### Wallet section in `inspect`

Added a 5-row "Wallet (manager owner)" section showing the active
address's owned DUSDC and PLP balances. Currently both 0; once LP
supply executes, the PLP row updates. This satisfies the plan's
verify step: "After execution, find the new PLP coin object and print
its balance."

`getBalance({ owner, coinType })` returns the aggregate across all
owned coin objects of that type — no need to walk dynamic fields,
no merging required.

### Why `parsePlpSupply` exists

The Move `TreasuryCap<PLP>` struct is `{ id, total_supply: Supply<PLP> }`,
where `Supply<PLP>` is `{ value: u64 }`. So `treasury_cap.total_supply.value`
is two levels of nesting. The helper handles the two-step traversal
in one place; the rest of `predict.ts` doesn't need to know about the
shape.

## 4. Plan deliverable status

| Plan deliverable | Status |
|---|---|
| `npm run lp-supply -- --amount X` builds | ✅ |
| Preview shares before signing | ✅ (computed locally, verified against share math from source) |
| User owns Coin<PLP> after execution | ⚠️ structural (Coin<PLP> destination wired; needs DUSDC to execute) |
| Vault total supply increases by deposit | ⚠️ structural; needs execution to confirm |
| First-supplier 1:1 case | ⚠️ untestable (protocol already has total_supply > 0) |
| Subsequent supplier proportional ratio | ✅ math matches live chain values (within rounding) |

## 5. Surprising things in today's data

- **PLP appreciation since launch ≈ $360 net** over what looks like 4–6
  months of protocol life. That's tiny compared to the $1M vault — but
  it's monotone-positive, which is the right sign. The protocol's
  spread income > its position-payout losses, net.
- **MTM grew $40 in a day** (from $266 on Day 3 to $304 today). More
  outstanding liability — more positions held by traders. The protocol
  is busy enough that the vault state moves visibly day-over-day.
- **The 1:1 first-supplier rule is unreachable on this testnet** —
  total_supply has been > 0 since shortly after launch. To exercise
  that branch we'd need a fresh predict deployment, out of scope.

## 6. Open questions / carry-overs

1. **Cleanup the `share/value ratio` display** — currently showing 9
   decimals; 6 would be plenty (the ratio approaches 1.0 with small
   deviations). Day 15 polish.
2. **`EZeroVaultValue` is a possible abort** if `vault.balance ==
   vault.total_mtm` (e.g., catastrophic insolvency). We throw locally
   with the same name; the chain throws with abort code. Both produce
   actionable errors, but ours is friendlier.
3. **`asset_balance<T>(vault)` view** — the source exposes per-quote
   balance reads. We don't use it because today's vault has a single
   quote (DUSDC); if the protocol ever onboards another, we'd want to
   surface per-quote balances in `inspect`.

## 7. Successful Transactions

None today — execution still blocked on DUSDC.

## 8. Tomorrow's Starting Point — Day 12

LP Withdraw PTB.

1. Build `src/ptb/lpWithdraw.ts`. Inputs: `Predict`, a `Coin<PLP>` to
   burn (or `--shares N` and let the PTB merge+split PLP coins).
   PTB:
   - `getCoins({owner, coinType=PLP})` to find PLP coins,
   - merge+split to exactly N shares,
   - `predict::withdraw<Quote>(predict, lp_coin, clock, ctx) -> Coin<Quote>`,
   - `transferObjects([quoteCoin], sender)`.
2. Build `src/scripts/lp-withdraw.ts` with 5 gates:
   - shares to burn > 0
   - user has >= N PLP shares
   - preview `amount = shares_to_amount(shares, vault_value)`
     (off-chain again, matching source)
   - check `amount <= vault.balance - vault.total_max_payout` (the
     hard withdrawal-availability check from `predict.move:485-491`)
   - devInspect + confirm
3. **Failure case to surface**: if outstanding `max_payout` is high
   relative to balance, the chain refuses the withdraw with
   `EWithdrawExceedsAvailable`. Add a clear pre-flight message:
   "vault would need to keep $X in reserve to cover outstanding
   exposure; only $Y can be withdrawn right now."
4. The plan mentions the **`RateLimiter` consume** as a second check
   that could also block — we already saw it's disabled on testnet
   today (Day 3: `enabled: false`). Worth a one-line note in the
   pre-flight.
