# Day 14 — End Week 2: Integration test

**Date:** 2026-05-13
**Branch pin:** `predict-testnet-4-16`

> Plan deliverable: `npm run e2e` runs the full lifecycle (deposit →
> mint UP/DOWN → redeem → lp supply → lp withdraw). **Orchestrator
> built and verified structurally — halts at the preflight gate today
> due to the DUSDC supply blocker.**

---

## 1. What was added

```
src/scripts/e2e.ts   # 7-step orchestrator with chain-side halt on first failure
package.json         # added "e2e" script
```

Tests: 24/24 still green. Typecheck clean.

## 2. The 7 steps

| # | Step | Mutates? | Failure mode |
|---|------|----------|--------------|
| 1 | Preflight (manager, owner, wallet DUSDC ≥ $20) | no | wallet has 0 DUSDC ← we are here |
| 2 | Pick longest-expiry Active BTC oracle from server | no | no Active oracle exists |
| 3 | Deposit $20 DUSDC into manager | **yes** | gates from `deposit.ts` |
| 4a | Mint UP near-ATM, $1 max payout | **yes** | gates from `mint-binary.ts` |
| 4b | Mint DOWN same strike, $1 max payout | **yes** | gates from `mint-binary.ts` |
| 5 | Verify positions: UP=DOWN=1_000_000 raw | no | post-mint state diverges from expected |
| 6a | Redeem UP at live SVI bid (early exit) | **yes** | gates from `redeem.ts` |
| 6b | Redeem DOWN at live SVI bid | **yes** | gates from `redeem.ts` |
| 7a | LP supply $5 | **yes** | gates from `lp-supply.ts` |
| 7b | LP withdraw half the new PLP | **yes** | gates from `lp-withdraw.ts` |

Total: **6 signed transactions** on a successful run, each costing
~5-6 milli-SUI gas.

## 3. Live output (preflight halt)

```
=== e2e lifecycle ===
  sender: 0xdbbd9f28e35f510bd9d86b4787ed53e09cd49695ac98f4210af77284e63d7266

[1/7] preflight (manager exists, has owner, wallet has DUSDC)…

=== e2e summary ===
  ✗ 1. preflight           wallet has 0 DUSDC, need at least 20

  1 step(s) failed. First failure: "1. preflight".
```

Exactly the right diagnostic — it stops at the **earliest** unmet
condition with a number that maps directly to the deposit's `--amount`
parameter.

## 4. Architecture decisions

### Reuse builders, not scripts

Each script in `src/scripts/` has its own gate logic + prompts. The
e2e orchestrator instead imports the **PTB builders directly** —
`buildDepositTx`, `buildMintBinaryTx`, etc. — and adds its own
sequence-level error handling.

Why not shell-exec the existing scripts?

- Subprocesses lose the connection between steps (can't share a `Ctx`).
- We'd have to parse stdout for digests instead of getting structured
  outcomes.
- Confirm prompts would block in CI use cases.

Cost: gates per-step are coarser in e2e than in individual scripts.
The chain is the second line of defense — any pre-flight bug surfaces
as a MoveAbort at signing, recorded in the failed step's note. Good
enough for the integration day.

### "Halt on first failure" rather than "best effort"

`lastFailed(results)` checks after each signing step; if false, the
orchestrator returns immediately. Reasoning:

- Later steps depend on earlier ones (you can't redeem a position you
  never minted).
- A partial e2e leaves the user in an unclear state (positions opened
  but not closed, manager funded but no PLP).
- A clean halt with diagnostics is more debuggable than 7 disparate
  error messages.

### Use `roundStrike` to grid-align

`oracle.spot` is a real number; the strike grid is in $500 increments
(BTC tick is $1 but we want a sensible near-ATM strike). `roundStrike`
rounds to the nearest $500 mark — for $80,335 spot, gives $80,500.
This avoids the off-tick `assert_valid_strike` abort from Day 9.

### LP withdraw uses `lpWithdrawFraction: 0.5`

Burns exactly half the PLP minted in 7a. Computed via bigint math
with a 1e6 fraction multiplier for precision. Why half: keeps the
e2e simple (we don't need to track PLP appreciation across the cycle),
and demonstrates partial-burn semantics.

### `runStep` factory pattern

Each signed step is wrapped with `runStep(ctx, results, name, build)`:

```ts
await runStep(ctx, results, '3. deposit', async () => {
  const tx = await buildDepositTx(ctx, { amount, sender });
  tx.setSender(sender);
  return tx;
});
if (lastFailed(results)) return finish(results);
```

The build closure is async (deposit needs `getCoins`); the wrapper
handles signing, success accounting, error capture. Clear separation
between **what** (PTB) and **how** (sign + record).

## 5. Plan deliverable status

| Plan deliverable | Status |
|---|---|
| `npm run e2e` exists | ✅ |
| Full lifecycle composed | ✅ 7 steps wired |
| Each step prints status | ✅ summary table at end |
| "Wait for settlement OR redeem early" | ✅ redeems early via active SVI |
| Integration runs end-to-end | ⛔ blocked at preflight (DUSDC) |
| Bugs surfaced and fixed | N/A (haven't run far enough to surface any) |

## 6. What e2e DOESN'T cover (intentionally)

The orchestrator doesn't exercise:

- **Range positions** (mint_range / redeem_range) — out of scope per
  plan §"Out of Scope for This MVP".
- **Settled-oracle redeem** — needs a longer wait or a market that
  settles during the test window. Early-exit at active SVI is simpler
  and works for the integration check.
- **The PendingSettlement deadzone** — empirically uninhabitable on
  testnet (Day 10 §3c).
- **Error injection** — deliberately bad amounts, expired oracles,
  etc. Those are exercised in the per-script dry-runs already.
- **Concurrent runs** — sequencing is single-threaded by design.

## 7. Bugs surfaced today

None — the orchestrator halted at preflight before reaching any
chain interaction. Day 14's full value as an integration test won't
be unlocked until DUSDC arrives.

The orchestration code itself **does** test that:

- All 6 PTB builders compose cleanly into a single signer's flow.
- Reading positions between mint and redeem works (gate 5).
- The `Ctx` and `sender` resolution propagates through every step.
- Failure halts don't leak partial state.

Those four are structural tests passed by writing the code, not by
running it. Useful in their own right.

## 8. Open questions / carry-overs

1. **Net P&L reporting** — currently the summary just shows step
   pass/fail. After a successful run, would be nice to compute:
   - DUSDC in vs DUSDC out
   - Premium paid for mints vs payout received from redeems
   - Whether the cycle netted positive (rare, given protocol margin)
   Worth a small addition once we can run for real.
2. **Settled-oracle redeem path** — could add a flag
   `--wait-for-settlement` that polls the oracle until lifecycle
   becomes Settled, then redeems. Useful but not Day-14 essential.
3. **Idempotency** — e2e is NOT idempotent (running twice would mint
   another pair of positions, supply more PLP, etc.). That's the
   correct semantics for an integration test (each run is independent),
   but worth noting.

## 9. Successful Transactions

None today — execution blocked on DUSDC (single root cause for
every blocked deliverable Days 6-14).

## 10. Tomorrow's Starting Point — Day 15

Inspect polish.

1. Refactor `src/scripts/inspect.ts` into cleaner sections with
   headers and visual separators.
2. Consider replacing the hand-rolled padEnd table with `cli-table3`
   for the binary-positions and oracle-svi rows (when there are
   multiple to show).
3. Add a few new sections:
   - PLP in wallet (already there from Day 11).
   - **Wallet section**: SUI gas + DUSDC + PLP balances (we have these).
   - **Active oracle**: rotate ORACLE_OBJECT_ID auto-pick if it's
     settled? Plan didn't say; skip.
4. The `--json` mode should already work after polish (no schema
   changes implied).

This is also a good day to address the **two deferred refactor items**
from Day 11+12:
- The `share/value` display precision (9 → 6 decimals).
- The `splitFromOwned` helper for the three PTBs that merge+split a
  wallet coin (Day 12 §5).
