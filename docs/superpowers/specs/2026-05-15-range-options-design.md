# Range options — design

**Date:** 2026-05-15
**Status:** Approved (brainstorm complete, awaiting plan)
**Implementation window:** Days 17–18 (the MVP plan's reserved buffer)

## Goal

Add `mint_range` / `redeem_range` to the CLI as **first-class lifecycle commands**, on parity with the existing `mint-binary` / `redeem`. This pulls range options from the README's "What this CLI does NOT do" list (v2 scope) into the MVP and closes out the Day-17/18 buffer with the scope expansion fully documented.

## Decisions captured from brainstorm

| # | Decision | Choice |
|---|---|---|
| 1 | Scope | Full parity with binary: PTBs + scripts + preview + e2e + notes + README |
| 2 | CLI argument shape | Two separate flags: `--lower <human>` and `--higher <human>` |
| 3 | Preview integration | Extend `npm run preview` to accept both `--strikes` and `--ranges`; output two `===`-separated blocks |
| 4 | e2e integration | Extend the existing `e2e` orchestrator (no `--include-range` flag, no `e2e:range` sibling) |
| 5 | Notes structure | `notes/day-17.md` (design) + `notes/day-18.md` (verification) |
| — | Implementation strategy | **Mirror** the binary code structure (~95% structural parallel); reject abstraction (`runMintLifecycle` generic) as premature |

## Non-goals

- Refactor `roundStrike` in [src/scripts/e2e.ts](src/scripts/e2e.ts) to read `oracle.tick_size`. Stays hardcoded `$500`.
- Refactor `_cli.ts` to host a shared mint-lifecycle pipeline.
- Add PTB-level or script-integration tests for binary (kept as the existing baseline).
- Add range to the markets / setup / inspect scripts. Those are asset-shape-neutral already.

---

## Section 1 — Architecture & file inventory

### New files (6)

```
src/ptb/mintRange.ts          buildMintRangeTx + buildRangeTradeAmountsPreviewTx
                              Mirror src/ptb/mintBinary.ts:
                                args: lower / higher (no isUp)
                                moveCall target: range_key::new
                                preview target: predict::get_range_trade_amounts

src/ptb/redeemRange.ts        buildRedeemRangeTx + buildRedeemRangePreviewTx
                              Mirror src/ptb/redeem.ts

src/scripts/mint-range.ts     CLI entry mirroring src/scripts/mint-binary.ts:
                                parseArgs → printSummary → preview → balance gate
                                → devInspect → confirm → sign

src/scripts/redeem-range.ts   CLI entry mirroring src/scripts/redeem.ts
                              Includes lifecycle-aware behaviour (Active vs Settled)

notes/day-17.md               Design note (see Section 5)
notes/day-18.md               Verification note (see Section 5)
```

### Modified files (5)

```
src/scripts/preview.ts        Add --ranges flag; output two `===` blocks
src/scripts/e2e.ts            Add steps 4c (mint range), 5 range qty check,
                              6c (redeem range); bump deposit to $25;
                              add rangeWidthE9 to E2E_PARAMS
src/lib/manager.ts            Add getRangePositionQty(ctx, manager, args)
                              CORRECTION to Section 1's "lib/ 不動" — this
                              one helper is needed for step 5 verify
package.json                  Add "mint-range" / "redeem-range" npm scripts
README.md                     Command-reference table, "does NOT do",
                              Definition of Done — see Section 5 for diffs
```

### Unchanged

```
src/config.ts                 .env schema unchanged
src/client.ts                 Ctx unchanged
src/lib/{predict,oracle,server,view,coins}.ts
src/ptb/{deposit,withdraw,lpSupply,lpWithdraw}.ts
src/scripts/{setup,inspect,markets,deposit,withdraw,lp-supply,lp-withdraw}.ts
src/scripts/_cli.ts           No new shared helpers
test/                         New cases added; no edits to existing 28
.env.example                  No new vars
```

### Open questions resolved during day-17 investigation, not blocking design

1. `range_key::new` exact argument order — confirm against `range_key.move` on `predict-testnet-4-16`
2. Range-only Move aborts (minimum width, tick alignment for both legs)
3. `get_range_trade_amounts` argument order vs `get_trade_amounts`
4. `getRangePositionQty` implementation path: dynamic_field_lookup (preferred) vs `listRangePositions` + filter (fallback)

---

## Section 2 — CLI interface

### `mint-range`

```
Usage:
  npm run mint-range -- --lower <human> --higher <human> --qty <human>
                        [--oracle <id>] [--execute] [--yes]

Scaling:
  --lower / --higher   human dollars (e.g. 80000 = $80,000), scaled to 1e9 raw
  --qty                human dollars of max payout, scaled to 1e6 raw

Examples:
  npm run mint-range -- --lower 80000 --higher 81000 --qty 5
  npm run mint-range -- --lower 80000 --higher 81000 --qty 5 --execute

Pre-flight checks:
  - oracle lifecycle must be Active
  - lower < higher (positive width)
  - both strikes on oracle tick grid, both >= min_strike (enforced via devInspect)
  - manager DUSDC balance must cover the previewed mint cost
  - devInspect must succeed before signing
```

Summary output mirrors `mint-binary`, with a `width` row:

```
=== mint range ===
  oracle:             0xe768ff79…
  underlying:         BTC
  expiry (UTC):       2026-05-15T14:00:00Z
  spot:               80,148.69113283
  lower:              80,000  (raw 80_000_000_000_000)
  higher:             81,000  (raw 81_000_000_000_000)
  width:              1,000
  quantity:           5  (raw 5_000_000)
  manager:            0xe55e…
  sender:             0xdbbd…

  cost (ask × qty):   1.234567 DUSDC (raw 1_234_567)
  bid (instant sell): 0.987654 DUSDC (raw 987_654)
  implied ask:        0.246913 per $1 contract
  implied bid:        0.197530 per $1 contract
  manager balance:    50.000000 DUSDC (raw 50_000_000)

  dry-run: OK (gas estimate {...})
  (add --execute to actually sign and submit)
```

### `redeem-range`

Same flag set as `mint-range`. Inherits `redeem.ts` lifecycle-aware behaviour: Active uses live bid via `get_range_trade_amounts`; Settled computes payout from `oracle.settlementPrice` as `(lower ≤ settle ≤ higher) ? quantity : 0`; Failed lifecycle is rejected.

### `preview` extension

```
Usage:
  npm run preview -- [--strikes <list>] [--ranges <list>]
                     [--qty <human>] [--oracle <id>]

  At least one of --strikes / --ranges required.
  Both can be supplied; outputs two blocks in sequence.

Examples:
  npm run preview -- --strikes 80000,80500,81000
  npm run preview -- --ranges 80000-81000,80500-81500
  npm run preview -- --strikes 80000,80500 --ranges 79500-80500,80500-81500
```

Output shape (when both supplied):

```
=== binary preview ===   (sorted by strike asc)
strike    UP ask     UP bid     DOWN ask   DOWN bid
80000     0.612345   0.598765   0.387654   0.379012
80500     0.534567   0.521098   0.465432   0.454321

=== range preview ===    (sorted by lower asc)
lower    higher   width   ask        bid
79500    80500    1000    0.234567   0.219876
80500    81500    1000    0.198765   0.187654
```

Empty blocks (only one flag supplied) are omitted.

### `e2e` surface

No new flag. `npm run e2e` (and `e2e --execute`, `e2e --yes`) keep their existing semantics. Range is silently included in the default run.

---

## Section 3 — PTB shape & pre-flight gates

### `mintRange.ts`

```ts
export type MintRangeArgs = Readonly<{
  oracleId: string;
  expiryMs: bigint;
  lower: bigint;     // 1e9-scaled
  higher: bigint;    // 1e9-scaled
  quantity: bigint;  // 1e6-scaled
  coinType?: string;
}>;

export const buildMintRangeTx = (ctx: Ctx, args: MintRangeArgs): Transaction => {
  if (args.quantity <= 0n) throw new Error(...);
  if (args.lower <= 0n)    throw new Error(...);
  if (args.higher <= args.lower) throw new Error(
    `higher must be > lower; got lower=${args.lower} higher=${args.higher}`
  );

  const pkg = ctx.config.PACKAGE_ID;
  const tx = new Transaction();

  // 1. range_key::new(oracleId, expiryMs, lower, higher) -> RangeKey
  const [key] = tx.moveCall({
    target: `${pkg}::range_key::new`,
    arguments: [
      tx.pure.id(args.oracleId),
      tx.pure.u64(args.expiryMs),
      tx.pure.u64(args.lower),
      tx.pure.u64(args.higher),
    ],
  });

  // 2. predict::mint_range<Quote>(predict, manager, oracle, key, quantity, clock)
  tx.moveCall({
    target: `${pkg}::predict::mint_range`,
    typeArguments: [args.coinType ?? ctx.config.QUOTE_COIN_TYPE],
    arguments: [
      tx.object(ctx.config.PREDICT_OBJECT_ID),
      tx.object(ctx.config.MANAGER_OBJECT_ID),
      tx.object(args.oracleId),
      key,
      tx.pure.u64(args.quantity),
      tx.object('0x6'),
    ],
  });

  return tx;
};

export const buildRangeTradeAmountsPreviewTx = (
  ctx: Ctx,
  args: Omit<MintRangeArgs, 'coinType'>,
): Transaction => {
  // range_key::new -> predict::get_range_trade_amounts
  // Returns (mint_cost, redeem_payout) — same shape as binary's get_trade_amounts.
};
```

### `redeemRange.ts`

```ts
export const buildRedeemRangeTx = (ctx, args): Transaction => {
  // range_key::new -> predict::redeem_range<Quote>(predict, manager, oracle, key, quantity, clock)
};

export const buildRedeemRangePreviewTx = (ctx, args): Transaction => {
  // Shares get_range_trade_amounts with mint preview; binary's mint and redeem do the same.
};
```

### Pre-flight gates (5)

| # | Gate | Range-specific delta |
|---|---|---|
| 1 | Static input validation | `qty > 0`, `lower > 0`, `higher > lower` (new) |
| 2 | Off-chain math check | `predict::get_range_trade_amounts` devInspect → `(cost, payout)` |
| 3 | Wallet / manager state | `manager.balance >= mintCost` (unchanged) |
| 4 | devInspect of full PTB | Surfaces `assert_valid_range`, `assert_valid_strike × 2`, `assert_mintable_ask` |
| 5 | Interactive confirm | Unchanged from binary |

**Principle**: client-side only catches cheap typos (gate 1). Real protocol invariants (tick alignment, min strike, ask-cap, any minimum width) are surfaced via devInspect (gate 4). Same as binary.

### Redeem lifecycle handling

```
oracle.lifecycle === Active   -> preview via get_range_trade_amounts; live bid path
oracle.lifecycle === Settled  -> skip preview; compute settled payout client-side:
                                  (lower <= settlementPrice <= higher) ? qty : 0
                                  (mirror redeem.ts previewSettledPayout for the in-range case)
oracle.lifecycle === Failed   -> reject (mirror redeem.ts existing behaviour)
```

---

## Section 4 — e2e integration

### Step layout (still 7 top-level steps, +3 sub-steps)

```
[1/7] preflight              unchanged
[2/7] oracle pick            extend: also compute (lower, higher) = roundStrike(spot±500)
[3/7] deposit                bump amount $20 → $25 (one extra mint to fund)
[4/7] mint
        4a. mint binary UP
        4b. mint binary DOWN
        4c. mint range                              NEW
[5/7] verify positions       verify all three positions via getPositionQty
                             and getRangePositionQty                       NEW
[6/7] redeem
        6a. redeem UP
        6b. redeem DOWN
        6c. redeem range                            NEW
[7/7] lp-supply + lp-withdraw  unchanged
```

### `E2E_PARAMS` changes

```ts
const E2E_PARAMS = Object.freeze({
  depositRaw: 25_000_000n,            // $25 (was $20)
  mintQtyRaw: 1_000_000n,             // $1 max payout per side, unchanged
  rangeWidthE9: 1_000_000_000_000n,   // $1,000 width                       NEW
  lpSupplyRaw: 5_000_000n,
  lpWithdrawFraction: 0.5,
});
```

`lower` and `higher` are computed at runtime from `oracle.spot`, mirroring how `strike = roundStrike(oracle.spot)` works today:

```
lower  = roundStrike(spot - rangeWidthE9 / 2n)
higher = roundStrike(spot + rangeWidthE9 / 2n)
```

### `lib/manager.ts` addition

```ts
export const getRangePositionQty = async (
  ctx: Ctx,
  manager: ManagerState,
  args: { oracleId: string; expiryMs: bigint; lower: bigint; higher: bigint },
): Promise<bigint>
```

Implementation choice deferred to day-17: dynamic_field_lookup against `manager.rangePositionsTableId` (preferred, mirrors `getPositionQty`) or `listRangePositions(...)` + linear filter (fallback).

### Preserved (intentionally not refactored)

- `runStep` / `fail` / `finish` orchestration helpers
- `roundStrike` continues hardcoded `$500` tick in `e2e.ts`
- Summary table styling

---

## Section 5 — Tests, notes, README/DoD

### Tests (+8 cases, 28 → 36)

| File | New cases | Coverage |
|---|---|---|
| `test/cli.test.ts` | +5 | `mint-range` argv parser: `--lower` / `--higher` required, `higher > lower` validation, human→1e9 scaling, negative qty rejected, `--oracle` falls back to env |
| `test/cli.test.ts` | +2 | `preview --ranges 80000-81000,80500-81500` parses to pairs; malformed `--ranges "80000"` (no dash) yields readable error |
| `test/cli.test.ts` | +1 | `redeem-range` argv parser (same shape as mint-range) |

**Deliberately untested**: PTB builders (binary doesn't test these either; covered by devInspect on real runs), settled-payout calculation (covered by Day-18 verification).

### `notes/day-17.md` — design note outline

```
1. RangeKey signature investigation
   - range_key::new arg order
   - All Move aborts triggered by mint_range
   - Minimum width rule (if any)

2. Mint cost surface
   - preview sweeps across (lower, higher) pairs
   - Which widths trigger assert_mintable_ask
   - Final E2E_PARAMS.rangeWidthE9 choice (target: $1000)

3. Mirror vs abstract — decision retrospective

4. Preview mixed-output UX — does it actually read OK?

5. lib/manager.ts — getRangePositionQty implementation
   - dynamic_field_lookup vs listRangePositions+filter

6. Surprises / open items for Day 18
```

### `notes/day-18.md` — verification note outline

```
1. First successful mint-range dry-run + execute
2. First successful redeem-range
   - Active oracle path
   - Settled oracle path (best-effort; may skip on DUSDC starvation)
3. Full e2e --execute summary
4. README diff
5. Ship-readiness — DoD table walkthrough
6. Reflection: mirror strategy in hindsight, brainstorm-flow value
```

### README diffs

`## Command reference → ### Trading`:

```diff
 | `npm run mint-binary -- --strike 80500 --qty 5 --direction up` | Mint a binary position. |
+| `npm run mint-range -- --lower 80000 --higher 81000 --qty 5` | Mint a range position (inside-range payoff). |
 | `npm run redeem -- --strike 80500 --qty 5 --direction up` | Redeem (full or partial). Works for Active *and* Settled oracles. |
+| `npm run redeem-range -- --lower 80000 --higher 81000 --qty 5` | Redeem a range position. Same lifecycle rules as binary redeem. |
```

`## What this CLI does NOT do`:

```diff
-- No **range positions** (`mint_range`, `redeem_range`). Same protocol
-  pattern as binary; intentionally deferred to v2.
 - No **wallet UI / browser integration**. Local keypair only.
```

`## Definition of Done`:

```diff
 | Item | Status |
 |---|---|
 | Fresh clone + `.env` + `npm install` + `npm run setup` works | ✅ verified |
 | `npm run e2e` runs all six lifecycle commands | ⚠ orchestrator built; execution gated on DUSDC supply |
+| Range options (mint-range, redeem-range, preview, e2e integration) | ✅ verified |
 | README clear enough for a Sui-familiar developer | ← you're reading it |
-| All 18 daily notes captured | 16/18 (current: Day 16); Days 17-18 are the plan's reserved buffer |
+| All 18 daily notes captured | 18/18 (range options shipped over Days 17–18) |
 | 3-minute demo recording | Out of scope for a CLI-only session |
```

`## Three scaling conventions` — unchanged. Range strike uses the same 1e9 scale; qty uses the same 1e6 scale.

---

## Risks and contingencies

| Risk | Contingency |
|---|---|
| `range_key::new` arg order differs from assumption | day-17 investigation surfaces it; PTB builder one-line edit |
| Range mint fails `assert_mintable_ask` at $1000 width | day-17 preview sweep finds a mintable width; update `rangeWidthE9` |
| `getRangePositionQty` dynamic_field_lookup pattern doesn't match `RangeKey` shape | Fallback to `listRangePositions` + filter (already exists in `lib/manager.ts`) |
| DUSDC runs out before full e2e completes | Document partial-run digest in day-18; revisit deposit amount |
| Settled-range redeem path differs from `(lower ≤ settle ≤ higher) ? qty : 0` | day-18 captures actual behaviour; update redeem-range and note |

## Definition of done for this spec

- All four new files (PTBs + scripts) compile and pass `npm run typecheck`
- `npm test` reports 36 passing cases (28 existing + 8 new)
- `npm run preview -- --strikes ... --ranges ...` outputs both blocks
- `npm run e2e --execute` completes all 7 steps including range sub-steps (gated on DUSDC; dry-run OK as fallback)
- `notes/day-17.md` and `notes/day-18.md` exist and cover the outlined sections
- README sections updated as shown
