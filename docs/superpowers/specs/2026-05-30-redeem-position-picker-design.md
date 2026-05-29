# Redeem Position Picker — Design

**Date:** 2026-05-30
**Status:** Approved (pending spec review)

## Problem

The current TUI redeem flow is backwards. `RedeemTab` and `RedeemRangeTab`
([src/tui/screens/TradeScreen.tsx](../../../src/tui/screens/TradeScreen.tsx))
make the user **type** `strike` / `qty` / `direction` (or `lower` / `higher` /
`qty`) by hand, then reverse-match those values against the manager's positions
via `pickPositionOracle` / `pickRangePositionOracle`.

Consequences:

- The user must already know their own strike, direction, and exact quantity,
  then re-enter them verbatim.
- Positions with `quantity == 0` can still be typed in, only to fail at tx-build
  time (`buildRedeemTx` throws on `quantity <= 0`).
- Range redeem needs two numbers (`lower` / `higher`) recalled from memory.

The data is already available — the Account overview lists positions via
`listBinaryPositions` / `listRangePositions`. The redeem flow should let the user
**pick a position directly** rather than retype it.

## Goals

- Replace typed redeem inputs with a single selectable list of redeemable
  positions (binary + range merged).
- Default the redeem quantity to the full position size, but allow editing for
  partial redeem.
- Only redeemable positions (`quantity > 0`) appear in the list.

## Non-Goals

- No changes to the on-chain PTB builders (`buildRedeemTx`,
  `buildRedeemRangeTx`) or the protocol.
- No changes to the script-side (`src/scripts/*`) redeem paths. The pure
  matchers `pickPositionOracle` / `pickRangePositionOracle`
  ([src/lib/oracle-pick.ts](../../../src/lib/oracle-pick.ts)) remain for scripts;
  only their TUI usage is removed.
- No partial-redeem of a position split across multiple oracles (each position
  already carries a single `oracleId`).

## Approach

**Two-phase flow reusing existing components.** Use the existing `Select`
component ([src/tui/components/Select.tsx](../../../src/tui/components/Select.tsx))
for picking and the existing `WriteForm`
([src/tui/components/WriteForm.tsx](../../../src/tui/components/WriteForm.tsx))
for the quantity + dry-run/confirm/sign cycle. Neither component is modified;
focus and Esc behavior come from the existing `useFieldNav` / `Select` input
handling.

Rejected alternative: a bespoke composite component combining the list and the
qty editor in one view. Higher flexibility but introduces focus conflicts
between `Select` and `TextInput`, and diverges from the established Mint/Deposit
screen structure.

## Architecture

### Tab structure

`TradeScreen`'s tabs go from 4 to 3:
`['Mint UP/DOWN', 'Mint Range', 'Redeem']`. The separate `RedeemTab` and
`RedeemRangeTab` are replaced by a single `RedeemTab` that handles both binary
and range positions. Redeem stays inside the Trade screen (it is not promoted to
a top-level sidebar section).

### Data loading

A `useAsync` (keyed on `refreshNonce`, `selectedManagerId`) loads:

1. `getManager(ctx, selectedManagerId)`
2. `listBinaryPositions(ctx, m)` + `listRangePositions(ctx, m)` in parallel

Results are filtered to `quantity > 0`, merged into one list, and sorted by
`expiryMs` ascending. Each entry is a tagged union:

```ts
type RedeemItem =
  | { kind: 'binary'; pos: Position }
  | { kind: 'range'; pos: RangePosition };
```

### Two-phase tab state

Internal `phase: 'pick' | 'form'` (plus the selected `RedeemItem`).

1. **pick** — `Select` lists the positions. Label format:
   - binary: `DOWN 73576   qty 0.066970   exp 06-19`
   - range:  `range 73500..74500   qty 2.000000   exp 06-19`

   (strike via `formatDecimal(_, PRICE_DECIMALS)`, qty via
   `formatDecimal(_, quote.decimals)`, expiry via `formatUtc`.)

   ↑/↓ move, Enter selects, Esc calls the screen's `onExit` (back to sidebar).
   Empty list renders a dim "no redeemable positions" message and Esc still exits.

2. On Enter, the chosen `RedeemItem` is stored and the phase moves to `form`. A
   second `useAsync` (keyed on the selected item's `oracleId`) fetches **only that
   one oracle** (fetch-on-select — the list does not display lifecycle, avoiding
   N RPC calls). While loading: "resolving oracle…".

3. **form** — renders `OracleLine` (showing lifecycle) above a `WriteForm` with a
   single `qty` field **pre-filled with the full position quantity**
   (`formatDecimal(pos.quantity, quote.decimals)`), plus the existing payout
   preview. `WriteForm`'s `onExit` is wired to return to the `pick` phase (not the
   sidebar), so Esc in the form goes back to the list.

### Transaction building & validation

`buildTx` branches on `item.kind`:

- `binary` → `buildRedeemTx(ctx, { managerId, oracleId, expiryMs, strike, isUp, quantity, coinType })`
- `range`  → `buildRedeemRangeTx(ctx, { managerId, oracleId, expiryMs, lower, higher, quantity, coinType })`

All position-derived args (`oracleId`, `strike`/`isUp` or `lower`/`higher`,
`expiryMs`) come from the selected item — never retyped. `quantity` comes from
the qty field.

Validation:

- qty parses to a positive bigint and `0 < qty <= pos.quantity`; otherwise the
  action row is blocked.
- Action also blocked (existing reasons) when read-only, or when the fetched
  oracle lifecycle is not `Active`/`Settled`.

### Payout preview

Reuse the current logic: `previewBinary` / `previewRange` when oracle is
`Active`; for `Settled`, show the fixed settlement payout (binary: strike-side
hit; range: settlement price inside `(lower, higher]`).

### Oracle selection

`selectedOracleId` no longer affects redeem — the selected position always
carries its own `oracleId`.

### Removed / simplified

- TUI no longer uses `pickPositionOracle` / `pickRangePositionOracle` (the
  "type values, reverse-match" path). Those functions stay in
  `src/lib/oracle-pick.ts` for scripts.
- `RedeemRangeTab` is removed; its behavior folds into the merged `RedeemTab`.

## Testing (TDD)

Pure / unit:

- `RedeemItem` → `Select` label formatting (binary and range).
- qty validation: rejects `0`, rejects `> pos.quantity`, accepts the full amount
  and a partial amount.
- binary/range branch builds the correct PTB args from a selected item.

Component (ink, following `test/tui-config-screen.test.tsx`):

- new `test/tui-redeem-screen.test.tsx`:
  - empty list → "no redeemable positions" message.
  - selecting a position advances to the form with qty pre-filled to the full
    amount.
  - editing qty above the position quantity blocks the action.

Target: keep with the project's 80%+ coverage rule.

## Files

- **Modify** [src/tui/screens/TradeScreen.tsx](../../../src/tui/screens/TradeScreen.tsx)
  — drop to 3 tabs; replace `RedeemTab` + `RedeemRangeTab` with the merged
  picker-based `RedeemTab`.
- **Add** `test/tui-redeem-screen.test.tsx`.
- Possibly extract redeem-list helpers (label formatting, qty validation, item
  union) into a small module if `TradeScreen.tsx` approaches the file-size limit.
