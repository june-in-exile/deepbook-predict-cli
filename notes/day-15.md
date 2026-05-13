# Day 15 — Inspect polish

**Date:** 2026-05-13
**Branch pin:** `predict-testnet-4-16`

> Plan deliverable: `npm run inspect` produces a clean human-readable
> dashboard. **Met. Plus two deferred refactors (Day 11/12) cleared.**

---

## 1. What was added / changed

```
NEW  src/lib/coins.ts          — fetchAllCoins + splitFromOwned (extracted)
MOD  src/ptb/deposit.ts        — uses splitFromOwned; -50 lines duplicated
MOD  src/ptb/lpSupply.ts       — uses splitFromOwned
MOD  src/ptb/lpWithdraw.ts     — uses splitFromOwned
MOD  src/scripts/_cli.ts       — formatDecimal accepts { groupThousands }
MOD  src/scripts/inspect.ts    — drops local formatDecimal, imports shared;
                                 adds SUI gas to Wallet section
MOD  src/scripts/lp-supply.ts  — share/value ratio at 6 decimals, not 9
MOD  test/cli.test.ts          — +4 formatDecimal tests
```

Tests: **28/28** (was 24, +4 for `formatDecimal`). Typecheck: clean.

## 2. Polish before / after

### Inspect's price display

```
before:    spot (price)      80148.69113283
after:     spot (price)      80,148.69113283
```

Six characters of comma noise that make BTC prices 5–10× faster to
read. The same applies to vault balance (`1,001,703.130879`),
PLP total supply (`1,001,034.5136`), strikes, etc.

### Wallet section

```
before:    address      0x…
           DUSDC (raw)  0          ← always 0, low signal
           DUSDC        0
           PLP (raw)    0
           PLP          0

after:     address    0x…
           SUI (gas)  7.328289934   ← new — confirms wallet is fundable
           DUSDC      0
           PLP        0
```

The raw rows were dead weight (already shown in the row below as
formatted). Replacing the `raw` rows with SUI gas catches an actual
common failure: "I sent gas but forgot — script aborts on the next
sign because gas ran out." Now visible at a glance.

### LP supply preview ratio

```
before:    share/value ratio:  0.999635576 PLP per 1 DUSDC of vault_value
after:     share/value ratio:  0.999635    PLP per 1 DUSDC of vault_value
```

The 7th+8th decimal places were noise from per-LP rounding error
(`mul_div_round_down` truncates). Showing 6 decimals matches the
quote-token precision and avoids implying confidence we don't have.

## 3. The `splitFromOwned` extraction

Three call-sites (`deposit.ts`, `lpSupply.ts`, `lpWithdraw.ts`) all
did the same dance: paginate coins → sort desc by balance → maybe
merge into largest → split exact amount. Total duplication: ~50 lines
across three files. Now:

```
// Old (per file)
const coins = await fetchAllCoins(ctx, owner, type);
const total = coins.reduce(...);
const sorted = [...coins].sort(...);
const primary = sorted[0]!;
const primaryArg = tx.object(primary.coinObjectId);
if (BigInt(primary.balance) < amount) {
  const others = ...;
  tx.mergeCoins(primaryArg, others);
}
const [coin] = tx.splitCoins(primaryArg, [amount]);
if (!coin) throw new Error('splitCoins returned no result');
// use coin

// New (one line)
const coin = await splitFromOwned(ctx, tx, owner, type, amount);
```

Each PTB builder file shrunk to its essence:

| File | Before (lines) | After (lines) |
|------|----------------|---------------|
| deposit.ts | 79 | 27 |
| lpSupply.ts | 75 | 32 |
| lpWithdraw.ts | 75 | 32 |
| **total** | **229** | **91** |

Plus 50 lines in the new `coins.ts`. **Net: ~88 lines removed**, three
files become much easier to read.

### Why now and not Day 6/11/12?

Each individual day passed the rule-of-three threshold differently:
- After Day 6: 1 user
- After Day 11: 2 users  
- After Day 12: 3 users (rule of three)

But Day 12 was a busy day; the extraction was deferred. Today (Day 15
polish) is the natural time. The cost of waiting: zero — all three
files worked, just verbosely.

The cost of extracting earlier: would have invented an abstraction
with one user, which is a smell. **Extracting at the third use, with
all three actual variants in hand, made the helper's signature
obvious** (just `(ctx, tx, owner, type, amount)` — no flags, no
options, no special cases).

## 4. Tests added

`test/cli.test.ts` gains 4 tests for `formatDecimal`:

```ts
- raw → human at the given precision (100_000_000n / 6 = '100')
- strips trailing zeros (100_500_000n / 6 = '100.5')
- groups thousands when asked (1_001_034_513_600n / 6 → '1,001,034.5136')
- handles negative values
```

These would have caught the trailing-zero bug from an earlier draft
where I had `frac.toString().padStart(decimals, '0')` without the
`.replace(/0+$/, '')`. Good tests for a real formatter, fast to run.

## 5. Plan deliverable status

| Plan deliverable | Status |
|---|---|
| Sectioned, human-readable inspect output | ✅ (was already there from Day 4) |
| Tabular output for positions | N/A — positions always 0 today; rows are formatted readably already |
| `--json` flag for machine output | ✅ (Day 3) |
| Dashboard of: manager, owned PLP, vault, oracle, history | ✅ except "history" — server has no per-manager history endpoint |

The plan suggested `cli-table3`. We didn't add it because:

1. The current padEnd-based formatter handles every existing output
   cleanly.
2. Adding a dependency for unused features (the table library shines
   for multi-row, multi-column output we don't currently need) is
   the kind of premature dependency that lingers.
3. If a "positions table with 5+ entries" ever shows up, this is a
   2-minute swap-in. Not blocking.

## 6. Surprises / observations

- **vault.balance ticked down ~\$0.58 between Day 11 and now.**
  $1,001,703.71 → $1,001,703.13. Real flow: someone redeemed slightly
  into the bid spread. Tiny.
- **settled_oracles continues climbing**: 2,181 (Day 4) → 2,198 (Day 15).
  That's ~17 settled oracles between today and 24h ago — slightly
  below the 18/day average. Quieter day.
- **The active oracle is still `0xe768ff79…` from Day 9** — same one
  the e2e orchestrator would pick. Its expiry (14:00 UTC) hasn't passed
  yet, but the script swaps automatically anyway. Future-proofed.

## 7. Open questions / carry-overs

1. **Recent-transactions section** — would require Sui RPC event
   queries filtered by manager id. Out of scope for read-only polish
   today; could be a Day 16 README "advanced" example instead.
2. **Per-position payout indicator on inspect** — when positions
   exist, showing the current redeem payout (live SVI bid × qty)
   would help users decide whether to early-exit. ~15 lines via
   `previewTradeAmounts` per row. Easy add when there ARE positions
   to show.
3. **A `cli-table3` upgrade later** — if positions grow past ~5 rows,
   the padEnd approach gets unwieldy. Not today's problem.

## 8. Successful Transactions

None today — pure refactor + display polish.

## 9. Tomorrow's Starting Point — Day 16

README + demo recording.

1. Write `README.md`:
   - Prerequisites (Node 20+, Sui CLI optional but useful, testnet
     keypair).
   - 5-minute quickstart: clone → npm install → cp .env.example .env →
     fill PRIVATE_KEY → npm run setup → npm run inspect.
   - Reference table of all 11 npm scripts.
   - Troubleshooting section: DUSDC blocker, oracle staleness,
     ask-bound, off-tick strikes (link to relevant note sections).
2. Record an asciinema (or screen recording) of `npm run inspect`,
   `npm run markets`, `npm run preview`. Three reads, no signing
   required, demo-stable.
3. Definition of Done items from the plan §"Definition of Done":
   - ✓ Fresh clone + `.env` + `npm install` + `npm run setup` works
   - ⚠ `npm run e2e` runs (gated on DUSDC)
   - target: README clear enough for a Sui-familiar developer
   - target: all daily notes captured (this is day 15 of 18, on track)
   - target: 3-minute demo recording
