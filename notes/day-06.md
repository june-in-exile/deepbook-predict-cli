# Day 6 — Deposit and Withdraw PTBs

**Date:** 2026-05-13
**Branch pin:** `predict-testnet-4-16`

> Plan deliverable: `npm run deposit -- --amount 100` and
> `npm run withdraw -- --amount 50` work end-to-end.
> **Build complete; execution blocked on DUSDC supply.**
> Dry-run (`devInspect`) verifies PTB shape; sign-and-execute path is
> wired but unreachable today.

---

## 1. What was added

```
src/ptb/deposit.ts        # buildDepositTx — async, paginates user coins, merges + splits
src/ptb/withdraw.ts       # buildWithdrawTx — pure builder, moveCall + transferObjects
src/scripts/deposit.ts    # CLI wrapper: --amount, --sender, --execute
src/scripts/withdraw.ts   # CLI wrapper: --amount, --recipient, --execute
src/scripts/_cli.ts       # shared helpers: parseDecimalAmount, resolveSender, dryRun, sign, printOutcome
test/cli.test.ts          # 5 tests for parseDecimalAmount (decimal scaling)
package.json              # added "deposit" and "withdraw" npm scripts
```

Tests: **24/24 green**. Typecheck: clean.

## 2. Dry-run results

### Deposit — pre-flight catches the "no coin" case cleanly

```
$ npm run deposit -- --amount 100
deposit failed: No 0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC
coins owned by 0xdbbd9f28e35f510bd9d86b4787ed53e09cd49695ac98f4210af77284e63d7266
```

This fails inside `buildDepositTx()`'s `fetchAllCoins()` — **before**
the PTB is constructed. A real chain-level abort would be wasteful
(an RPC plus a wall of MoveAbort text); the pre-flight gives a precise,
actionable message.

### Withdraw — runs devInspect, gets a clean MoveAbort

```
$ npm run withdraw -- --amount 1
withdraw 1 DUSDC (= 1000000 raw)
  sender:    0xdbbd9f28e35f510bd9d86b4787ed53e09cd49695ac98f4210af77284e63d7266
  manager:   0xe55ea85bcf29d5cbea28e29cfaf6c3ecc58f461053aa06b4436b950e98608a3d

=== dry-run (devInspect) ===
  success: false
  error:   MoveAbort(MoveLocation { module: ModuleId { address: 0x74cd…77c8,
           name: Identifier("balance_manager") }, function: 37, instruction: 45,
           function_name: Some("withdraw_with_proof") }, 3) in command 0
  gas used (estimate): {"computationCost":"1000000","storageCost":"5510000",
                       "storageRebate":"4476780","nonRefundableStorageFee":"45220"}
```

This is the **good** failure mode: the PTB is well-formed, the chain
accepted it, types all matched, then the BalanceManager's internal
balance check aborted with code 3 ("insufficient funds"). Three takeaways:

1. **The error path is 2 delegations deep.** Our call is
   `predict_manager::withdraw` → `balance_manager::withdraw_with_cap` →
   `balance_manager::withdraw_with_proof`. The abort surfaces at the
   deepest layer. **When debugging,** read the module name in the
   MoveAbort, not the function we called.
2. **A third deepbook upgrade version surfaced.** The abort cites
   `0x74cd5657…77c8`. Combined with Day 2's `0xfb28c4cb…6982` (struct
   defn) and `0x984757fc…790a` (cap/event package), there are at least
   three upgrade versions live. Implication for Day 8: any time we
   compare coin types or capabilities, **normalize via `with_defining_ids`**;
   never raw-string-compare.
3. **Gas estimate is sane** — 5.51 MIST storage cost matches what
   Day 2's `create_manager` consumed.

## 3. Architecture decisions

### `buildDepositTx` is async; `buildWithdrawTx` is sync

Deposit needs `getCoins()` to find the user's source DUSDC, so it has
to be async. Withdraw needs no chain query — the manager id is known,
the amount is a parameter, the recipient is provided — so it stays
pure-sync. Smaller surface, easier to test if we ever need to.

### Merge → split order matters

`buildDepositTx` only emits a `mergeCoins` command **if** the largest
single coin is smaller than the desired `amount`. Most cases (one big
coin in the wallet) avoid the merge entirely. When merging is needed,
we always merge **into** the largest coin (`sorted[0]`) — keeps the
gas cost down by minimizing the number of objects whose storage
version bumps.

### `tx.pure.u64(amount)` not `tx.pure(amount)`

The SDK's `tx.pure` is being deprecated in favour of typed wrappers
(`tx.pure.u64`, `tx.pure.address`, …). Used the typed forms throughout.
Catches off-by-one type errors at PTB-build time instead of at chain
execution.

### Destructure the moveCall result for withdraw

`predict_manager::withdraw<Quote>` returns a `Coin<Quote>`. The SDK's
`tx.moveCall` returns a `TransactionResult` which is an array-like;
TypeScript needs the destructure `const [coin] = tx.moveCall(...)` to
pick out the single return value as a `TransactionObjectArgument`.
Without destructuring, the type was `TransactionArgument` which
`transferObjects` won't accept.

### `_cli.ts` shared helpers

`parseDecimalAmount("0.123456", 6)` → `123_456n`. Handles padding short
fractions, truncating excess digits, and rejecting non-numeric input.
Tested with 5 cases covering each branch.

`resolveSender` falls back through `--sender` → keypair-derived →
manager.owner from chain. The chain-read fallback means dry-runs work
even with empty `.env` (no `PRIVATE_KEY`, no `--sender`).

`dryRun` vs `sign`:
- `dryRun` uses `devInspectTransactionBlock` — no signing, no gas.
  Reports success/failure and the gas estimate.
- `sign` uses `signAndExecuteTransaction` with `showEffects` and
  `showBalanceChanges`. Returns the digest and an explorer link.

### What the `--execute` gate does

Both scripts default to dry-run only. `--execute` is required to
actually submit. This is the only safety rail; once `PRIVATE_KEY` is in
`.env` and DUSDC is in the wallet, **`--execute` will move real
testnet funds**. (Mainnet would be the same code; the only difference
is `RPC_URL` and the network's lack of forgiveness.)

## 4. Live verification when DUSDC arrives

```bash
# 1. dry-run first
npm run deposit -- --amount 100

# 2. real
npm run deposit -- --amount 100 --execute

# 3. verify quote_balance changed
npm run inspect | grep 'quote_balance'

# 4. withdraw half back
npm run withdraw -- --amount 50 --execute
npm run inspect | grep 'quote_balance'
```

Expected post-deposit:
```
quote_balance (raw)   100000000
quote_balance (USDC)  100
```

Expected post-withdraw:
```
quote_balance (raw)   50000000
quote_balance (USDC)  50
```

## 5. Successful Transactions

None today (deposit/withdraw execution blocked on DUSDC).

## 6. Tomorrow's Starting Point — Day 7

Plan-mandated reflection day. No new code.

1. Re-read `notes/day-{01..06}.md`. Look for inconsistencies
   between what we predicted on Day 1 and what we found.
2. Write `notes/week-01-summary.md` covering:
   - What works end-to-end (read paths, PTB builders, dry-run loop)
   - What's actually blocked (DUSDC supply only)
   - Architectural facts learned that weren't in the design doc:
     - PredictManager wraps DeepBook BalanceManager
     - At least 3 deepbook upgrade versions coexist on testnet
     - Server has only 4 endpoints; filtering is client-side
     - Two scales coexist: 1e6 (quote) vs 1e9 (price/strike)
     - Source-side error paths surface 2 delegations deep
   - Time-remaining estimate
   - Any refactor-worthy items before Day 8 (the hardest day)
3. Commit clean state. No code changes unless something is broken.
