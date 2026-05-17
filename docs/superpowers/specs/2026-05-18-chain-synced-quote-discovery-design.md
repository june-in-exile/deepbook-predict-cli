# Chain-synced quote discovery — design

**Date:** 2026-05-18
**Status:** Approved (brainstorm complete, awaiting plan)

## Goal

Remove the hardcoded `QUOTE_COIN_TYPE` and `QUOTE_DECIMALS = 6n` from the CLI. Instead, read the protocol's `Predict.treasury_config.accepted_quotes` set on demand, resolve the matching `CoinMetadata` for `decimals` + `symbol`, and surface those values uniformly through a single helper. The result: when Mysten adds a second quote asset to `accepted_quotes` (e.g. USDC alongside DUSDC), this CLI either picks it up automatically (when unambiguous) or prompts the user to disambiguate with `--quote <symbol-or-type>` — no code change required.

## Decisions captured from brainstorm

| # | Decision | Choice |
|---|---|---|
| 1 | Multi-quote selection UX | Strict mode: auto-select when set has exactly 1 entry; error and require `--quote` when ≥ 2 |
| 2 | `.env QUOTE_COIN_TYPE` role | Delete entirely. Chain is the sole source of truth |
| 3 | `--quote` flag matching | Value containing `::` → full coin type (case-sensitive exact match). Otherwise → symbol (case-insensitive match against `CoinMetadata.symbol`) |
| 4 | Decimals source | `client.getCoinMetadata({ coinType }).decimals` — replaces every `QUOTE_DECIMALS = 6n` constant |
| 5 | Display symbol source | `CoinMetadata.symbol` — replaces hardcoded `"DUSDC"` strings in `inspect.ts` etc. |
| 6 | Resolution architecture | Approach A: pure helper `resolveQuote(ctx, args.quote?)` called from each script's `main()`, returned `Quote` flows down to PTB builders and display code. `Ctx` shape unchanged |

## Non-goals

- Make `createContext()` async or attach mutable state to `Ctx`. (Rejected approaches B and C; would ripple through every script and complicate testing.)
- Cache `CoinMetadata` across CLI invocations on disk. Each run is short-lived; one extra RPC at startup is acceptable.
- Support quotes with non-`u64` balance representations or non-`Coin<T>` shapes. The protocol's `treasury_config` already constrains `accepted_quotes` to standard `Coin<T>` types.
- Provide a `--list-quotes` discovery command. `npm run inspect` already prints `TreasuryConfig — accepted quotes`; that remains the discovery surface.
- Update `notes/day-XX.md`. This change lands during the Day-17/18 buffer window alongside the range-options work — its notes entry is folded into whichever day it ships in.

---

## Section 1 — Architecture & file inventory

### New files (2)

```
src/lib/quote.ts              Exports Quote type + resolveQuote() helper.
                              Single source for: discovery (reads Predict.accepted_quotes),
                              selection (single auto / multi --quote required), and
                              metadata resolution (CoinMetadata fetch).

test/quote.test.ts            Unit tests for resolveQuote — covers all rows of the
                              behavior matrix in Section 2 via mocked ctx.client.
```

### Modified files (config + 13)

```
.env.example                  Remove `QUOTE_COIN_TYPE=…` line + comment header.
.env                          (user-managed; user removes manually — README notes this)
src/config.ts                 Remove QUOTE_COIN_TYPE from ConfigSchema, pickEnv,
                              and Config type.

src/scripts/_cli.ts           Add readFlag(argv, '--quote') call-sites are per-script;
                              no shared helper needed beyond existing readFlag.

src/scripts/setup.ts          Remove QUOTE_DECIMALS const. Resolve quote in main(),
                              pass to formatDecimal / printed labels.
src/scripts/inspect.ts        Replace ['DUSDC', formatDecimal(..., 6n, …)] with
                              [quote.symbol, formatDecimal(..., quote.decimals, …)].
                              Same for 'quote_balance (USDC)' line.
src/scripts/preview.ts        Replace QUOTE_DECIMALS with quote.decimals; resolve once.
src/scripts/deposit.ts        Resolve quote in main(); pass to splitFromOwned + builder.
                              Use quote.decimals in parseDecimalAmount + summary text.
src/scripts/withdraw.ts       Same shape as deposit.
src/scripts/mint-binary.ts    Same; also pass quote.coinType to redeem PTB builder if
                              cost shows differently from default.
src/scripts/redeem.ts         Same.
src/scripts/lp-supply.ts      Same. Note: PLP is a *separate* coin (plp::PLP), not the
                              quote — PLP still uses 6n decimals (hardcoded in module).
src/scripts/lp-withdraw.ts    Same as lp-supply.
src/scripts/e2e.ts            Resolve quote once at top of orchestrator; reuse for all
                              sub-steps. Single --quote flag covers the full lifecycle.

README.md                     Update Configuration table: remove QUOTE_COIN_TYPE row,
                              add --quote section under Command reference.
                              Add troubleshooting entry: "Multiple accepted quotes".
```

### PTB builders (6 files, single-line fallback removal each)

```
src/ptb/deposit.ts            Remove `?? ctx.config.QUOTE_COIN_TYPE` from args.coinType
src/ptb/withdraw.ts           defaulting. Builder signature unchanged — `args.coinType`
src/ptb/mintBinary.ts         remains the same param; it's now required-in-practice
src/ptb/redeem.ts             because scripts always pass it. TypeScript-optional kept
src/ptb/lpSupply.ts           for builder ergonomics in future call-sites.
src/ptb/lpWithdraw.ts
```

### Files NOT modified

```
src/lib/predict.ts            Already exposes parseAcceptedQuotes; reused as-is.
src/lib/coins.ts              Generic — accepts any coinType. No change.
src/lib/server.ts             Server endpoints are quote-agnostic. No change.
src/lib/oracle.ts             Oracle math is quote-independent. No change.
src/lib/manager.ts            Manager balance read takes coinType as argument. No change.
```

---

## Section 2 — `resolveQuote` semantics

### Type

```typescript
export type Quote = Readonly<{
  coinType: string;   // full 0x…::module::Struct
  symbol: string;     // from CoinMetadata, e.g. "DUSDC"
  decimals: bigint;   // from CoinMetadata, e.g. 6n
}>;

export const resolveQuote = async (
  ctx: Ctx,
  quoteArg: string | undefined,
): Promise<Quote>;
```

### Behavior matrix

| `accepted_quotes` size | `--quote` flag | Behavior |
|---|---|---|
| 0 | any | Throw: `Predict object has no accepted quotes — protocol misconfigured` |
| 1 | absent | Auto-select the sole entry |
| 1 | present, matches | Use it (validation passes) |
| 1 | present, no match | Throw: `--quote <given> not in accepted_quotes [<sole symbol/type>]` |
| ≥ 2 | absent | Throw: `Multiple accepted quotes available: [<sym1>, <sym2>, …]. Pass --quote <symbol-or-type> to choose.` |
| ≥ 2 | present, matches | Use it |
| ≥ 2 | present, no match | Throw, listing options as above |

### `--quote` matching rules

- If the argument value **contains `::`** → treat as full coin type. Match case-sensitively against the canonical form in `accepted_quotes` (both stored and incoming are normalized with the existing `0x`-prefix logic from [src/lib/predict.ts:101](../../src/lib/predict.ts#L101)).
- Otherwise → treat as symbol. Compare case-insensitively against each candidate's `CoinMetadata.symbol`.

### RPC cost

Per script invocation that calls `resolveQuote`:
- 1 × `getObject(Predict)` — already done by `setup`/`inspect`/`preview`/`mint`/`redeem`/`lp-*`/`e2e`, so net new for `deposit` + `withdraw` only.
- 1 × `getCoinMetadata(coinType)` — net new in all cases. Sui RPC nodes serve this from indexer cache; latency typically < 50ms.

`e2e.ts` resolves once and shares the `Quote` across all 6 sub-steps.

### Type bridge: bigint ↔ number

`Quote.decimals` is `bigint` (matches the `formatDecimal(raw, decimals: bigint, …)` signature in [src/scripts/_cli.ts:30](../../src/scripts/_cli.ts#L30)). `parseDecimalAmount(human, decimals: number)` takes `number`. Call-sites that previously did `parseDecimalAmount(human, 6)` become `parseDecimalAmount(human, Number(quote.decimals))`. The conversion is safe — `CoinMetadata.decimals` is `u8` on-chain, so the value is always 0–255.

---

## Section 3 — Error message contract

Three new error classes (plain `Error` instances; we don't introduce a class hierarchy):

```
[NoAcceptedQuotes]
  Predict object has no accepted quotes — protocol misconfigured.
  Check the Predict object at <PREDICT_OBJECT_ID> on https://suiscan.xyz/testnet/object/<id>

[QuoteNotInSet]
  --quote "<input>" did not match any accepted quote.
  Available: [DUSDC (0xe95040…::dusdc::DUSDC)]
  Pass --quote DUSDC, or remove the flag to auto-select the single available quote.

[AmbiguousQuote]
  accepted_quotes contains 2 entries; --quote required to disambiguate.
  Available: [DUSDC (0xe95040…::dusdc::DUSDC), USDC (0x…::usdc::USDC)]
  Example: npm run mint-binary -- --quote DUSDC --strike 80500 --qty 5 --direction up
```

Each message names the available options so the user can copy-paste a valid value. The script-level error printer in `_cli.ts`-equivalent positions already prints `Error.message` verbatim; no new printing path is needed.

---

## Section 4 — Removal inventory (cleanup checklist)

What gets deleted, by file, ensures nothing is left stale:

```
.env.example                 # --- Quote ---  header + QUOTE_COIN_TYPE line   (2 lines)
src/config.ts                QUOTE_COIN_TYPE: zod field + pickEnv entry        (3 lines)

src/scripts/setup.ts         const QUOTE_DECIMALS = 6n;                         (1 line)
src/scripts/preview.ts       const QUOTE_DECIMALS = 6n;                         (1 line)
src/scripts/mint-binary.ts   const QUOTE_DECIMALS = 6n;                         (1 line)
src/scripts/lp-supply.ts     const QUOTE_DECIMALS = 6n;                         (1 line)
src/scripts/lp-withdraw.ts   const QUOTE_DECIMALS = 6n;                         (1 line)
src/scripts/e2e.ts           const QUOTE_DECIMALS = 6n;                         (1 line)

src/scripts/inspect.ts       Literal 'DUSDC' label (2 sites)                    (2 strings)
                             Literal 'USDC' in "quote_balance (USDC)"          (1 string)

src/ptb/deposit.ts           ?? ctx.config.QUOTE_COIN_TYPE fallback             (1 line)
src/ptb/withdraw.ts          same                                               (1 line)
src/ptb/mintBinary.ts        same                                               (1 line)
src/ptb/redeem.ts            same                                               (1 line)
src/ptb/lpSupply.ts          same                                               (1 line)
src/ptb/lpWithdraw.ts        same                                               (1 line)
```

After this change, **grep should return zero hits for `QUOTE_COIN_TYPE` and `QUOTE_DECIMALS` across the repo**. Verification step in plan.

---

## Section 5 — Tests

### New unit tests (test/quote.test.ts — ~10 cases)

Mock `ctx.client` with `getObject` returning a stubbed Predict shape and `getCoinMetadata` returning a stubbed metadata object. Cover:

1. Single quote, no flag → returns that quote
2. Single quote, matching symbol flag → returns it
3. Single quote, matching full-type flag → returns it
4. Single quote, mismatched flag → throws `QuoteNotInSet` with available list
5. Multi quote, no flag → throws `AmbiguousQuote` with available list
6. Multi quote, matching symbol flag → returns chosen
7. Multi quote, matching full-type flag → returns chosen
8. Multi quote, case-mismatched symbol flag → still matches (case-insensitive)
9. Empty `accepted_quotes` → throws `NoAcceptedQuotes`
10. `getCoinMetadata` returns `null` → throws `CoinMetadata not found for <type>`

### Existing tests

No existing test asserts `QUOTE_COIN_TYPE` directly (verified via `grep QUOTE_COIN_TYPE test/`). The 28 existing cases pass unchanged.

### Manual verification (after implementation)

```bash
npm run typecheck                                    # zero new errors
npm test                                             # 28 existing + ~10 new = ~38 cases
npm run inspect                                      # symbol displayed dynamically
npm run setup                                        # readiness still detects DUSDC balance
npm run preview -- --strikes 80500                   # decimals correct in printed prices
npm run deposit -- --amount 1                        # dry-run still passes
grep -rn 'QUOTE_COIN_TYPE\|QUOTE_DECIMALS' src/ .env.example   # zero hits
```

---

## Section 6 — Rollout & migration

### For the developer (user) running this CLI today

1. Pull the change.
2. `npm install` (no new deps).
3. Edit `.env` — remove the `QUOTE_COIN_TYPE=…` line. Leaving it in is harmless (zod's `safeParse` on a `z.object(...)` silently strips unknown keys), but the README notes it's no longer read so future readers don't think it's wired up.
4. Use as before. Behavior identical while `accepted_quotes` has only DUSDC.

### When Mysten adds a second quote (future)

- Running any signing command with no `--quote` will fail with `AmbiguousQuote` and print the two options.
- Add `--quote DUSDC` (or whichever) to the command. Done.

### Rollback

Single-commit revert is safe — no DB migrations, no on-chain side effects. The change is purely a code-side reorganization of how the existing `accepted_quotes` field is consumed.

---

## Open questions

None at brainstorm close. All design decisions captured in the table at the top.
