# Day 13 — Setup script + idempotency

**Date:** 2026-05-13
**Branch pin:** `predict-testnet-4-16`

> Plan deliverable: `npm run setup` runs the user from zero
> (no PredictManager) to ready-to-trade (manager created, quote
> deposited). **Build complete; idempotent verified. Auto-deposit is
> intentionally NOT done.**

---

## 1. What was added

```
src/scripts/setup.ts   # status walker + readiness checklist + opt-in manager creation
package.json           # added "setup" script (placed first in the scripts list)
```

Tests: 24/24 still green. Typecheck clean. **No new dependencies.**

## 2. What setup does — and what it intentionally does NOT do

### Does

1. **Check manager state** — reads `MANAGER_OBJECT_ID` from `.env` and
   verifies it (a) exists on chain, (b) is owned by the active sender.
2. **Check wallet DUSDC** — `getBalance({owner: sender, coinType: DUSDC})`.
3. **Check manager DUSDC** — `getQuoteBalance(ctx, manager, DUSDC)` via
   devInspect (no signing).
4. **Print a readiness checklist** with ✓/✗ marks for the three
   preconditions:
   - PredictManager ready
   - Wallet holds DUSDC
   - Manager funded above $10
5. **Print actionable next steps** based on what's missing:
   - No DUSDC in wallet → DUSDC acquisition options (Discord, deployer,
     trader).
   - DUSDC in wallet, manager empty → `npm run deposit -- --execute`.
   - Manager funded → trading-ready hint: `mint-binary`, `lp-supply`,
     `inspect`.

### Does not

1. **Auto-create a manager.** Requires explicit `--create-manager`
   flag. Why: the plan says capture the new id and put it in `.env`;
   doing it silently would surprise users on the second `setup` run.
2. **Auto-deposit.** Plan considered "Deposit a default amount" — we
   deliberately don't, because:
   - The user might want a different amount than our default.
   - It would be a real-money silent mutation, surprising on rerun.
   - The DUSDC blocker means most users won't have DUSDC at first
     `setup`, so auto-deposit would always fail anyway.
3. **Mint test quote** (per plan: "if testnet supports faucet" — it
   doesn't). The DUSDC blocker is documented in the next-steps output.

## 3. Live output

```
=== setup ===
  sender:  0xdbbd9f28e35f510bd9d86b4787ed53e09cd49695ac98f4210af77284e63d7266
  network: https://fullnode.testnet.sui.io:443

  configured manager: 0xe55ea85bcf29d5cbea28e29cfaf6c3ecc58f461053aa06b4436b950e98608a3d
  manager exists:     yes
  owner matches:      yes
  wallet DUSDC:       0 (raw 0)
  manager DUSDC:      0 (raw 0)

  --- readiness ---
  ✓ PredictManager ready
  ✗ Wallet holds DUSDC
  ✗ Manager funded above $10

  Need DUSDC: testnet has no faucet for DUSDC.
  Only the Mysten team can mint it. Options:
   - ask in the official DeepBook / Mysten Discord
   - request from the dusdc::dusdc deployer (see notes/day-02.md §3)
   - obtain from an active testnet trader (see /managers indexer)
```

Re-running produces **byte-identical output**. Idempotency confirmed.

## 4. The 3-state machine

`setup` resolves the user's state into one of three regions:

| State | Wallet DUSDC | Manager DUSDC | Next step printed |
|---|---|---|---|
| Cold | 0 | 0 | "Need DUSDC" + acquisition options |
| Funded wallet | > 0 | < $10 | `npm run deposit -- --amount 100 --execute` |
| Ready | > 0 | ≥ $10 | Trading hint: mint-binary / lp-supply / inspect |

Plus two error states:
- Manager not found → `--create-manager` instruction.
- Manager exists but owner mismatch → ABORT (don't try to operate on
  someone else's manager).

## 5. Architecture decisions

### Idempotency via state-first / mutation-explicit

The script reads state first, then **only mutates with explicit flags**.
This pattern is the actual definition of idempotent — the same sequence
of commands produces the same end state regardless of how many times
it runs.

### `try { getManager } catch` for liveness

We use a `try/catch` around `getManager(ctx)` to handle both "id not
configured" and "id configured but doesn't exist on chain" with the
same fallback (managerExists = false). This is a tighter check than
manually parsing the SuiClient error.

### `--create-manager` is opt-in for safety

Without the flag, missing-manager produces an instruction message but
no mutation. With the flag, the script signs `predict::create_manager`
(no args), which costs ~5.5 milli-SUI. **No `--execute` second-level
flag** — the explicit `--create-manager` already serves as
"yes I want to mutate".

This is slightly different from the deposit/mint/etc. pattern where
`--execute` is the mutation gate. Reasoning: setup is meant to be
**rerun freely**; the deposit/mint scripts are meant to be **executed
once per intent**. The verbose flag suits the rare-mutation case.

### Manager-owner case-insensitive comparison

`m.owner.toLowerCase() === sender.toLowerCase()` — Sui addresses are
displayed with mixed case in some clients (rarely), but on-chain they're
canonically lowercase hex. Defensive lowering avoids any chance of
false-mismatch.

## 6. Plan deliverable status

| Plan deliverable | Status |
|---|---|
| `npm run setup` exists | ✅ |
| Creates a manager if none | ✅ via `--create-manager` |
| Saves manager id to `.env` | ⚠️ user-driven (print → user copies to .env). Auto-write was considered, deferred (see §7). |
| Checks quote balance, prompts to fund | ✅ readiness section explains exactly what's missing |
| Mints test quote if testnet supports faucet | N/A (no faucet exists) |
| Deposits a default amount | ⛔ intentionally NOT done — would be a surprising mutation |
| Idempotent on rerun | ✅ verified (byte-identical second-run output) |
| Doesn't duplicate manager or over-deposit | ✅ both gated by explicit flags |

## 7. Open questions / carry-overs

1. **Auto-write to `.env`** — currently we print "put the new id in .env
   as MANAGER_OBJECT_ID" after `--create-manager`. We could parse the
   tx-result and use Node's `fs.writeFile` to update `.env` directly.
   Deferred because:
   - `.env` is often co-edited; silent writes are surprising.
   - The `PredictManagerCreated` event already carries the id and we'd
     need to read it from `outcome.balanceChanges` or the effects —
     pulling it out cleanly is more code.
   - The print is one copy-paste step; not a huge ergonomic loss.
2. **`--auto-deposit <amount>` flag** — could combine create-manager +
   deposit in one shot. Out of scope today; if Day 14 e2e wants it,
   we'll add then.
3. **`--key-from-cli` flag** — could automatically pull the active
   `sui client` keypair via `sui keytool export` instead of requiring
   `PRIVATE_KEY` in `.env`. Would close the keypair-handling friction
   loop. Defer until/unless a user complains.

## 8. Successful Transactions

None today — setup itself didn't mutate anything (correctly).

## 9. Tomorrow's Starting Point — Day 14

E2E integration. The "does the whole thing actually work" day.

1. Build `src/scripts/e2e.ts` that orchestrates, in order:
   - `setup` status (don't mutate yet).
   - **REQUIRE DUSDC** — if wallet is empty, ABORT with the same
     acquisition message setup prints.
   - `deposit` (a small amount, e.g. $20).
   - `mint-binary` UP near-ATM strike.
   - `mint-binary` DOWN same strike.
   - `inspect` — should show 2 binary positions.
   - `lp-supply` $5.
   - `lp-withdraw` half the PLP.
   - `inspect` — final state.
2. Use a single short-expiry oracle for the mint/redeem cycle, OR
   redeem immediately at live SVI bid (early exit) to avoid waiting
   for settlement.
3. **Print a final report** with all tx digests and net P&L.

The e2e script is the **integration test** the plan describes; it's
where any unfound bug from Days 6-12 will surface. Without DUSDC we
can write the orchestrator but can't run it.
