# Chain-synced quote discovery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the hardcoded `QUOTE_COIN_TYPE` env var and `QUOTE_DECIMALS = 6n` constants throughout the CLI. Replace with on-demand discovery via `Predict.treasury_config.accepted_quotes` + `CoinMetadata`, surfaced through a single `resolveQuote(ctx, --quote-arg)` helper.

**Architecture:** New pure helper `src/lib/quote.ts` returns a `Quote = { coinType, symbol, decimals }`. Each script calls `await resolveQuote(ctx, readFlag(argv, '--quote'))` once in its `main()` and threads the `Quote` through PTB builders and display code. `Ctx` shape unchanged. Behavior matrix: single quote auto-selects; multi-quote requires `--quote <symbol-or-type>` or errors with actionable message listing options.

**Tech Stack:** TypeScript (strict), `@mysten/sui` (SuiClient + Transaction), vitest, zod (existing config schema). No new dependencies.

**Spec reference:** [docs/superpowers/specs/2026-05-18-chain-synced-quote-discovery-design.md](../specs/2026-05-18-chain-synced-quote-discovery-design.md)

---

## Task 1: Skeleton — Quote type + stubbed resolveQuote

**Files:**
- Create: `src/lib/quote.ts`

- [ ] **Step 1.1: Create the file with the type and a throwing stub**

```typescript
import type { Ctx } from '../client.js';

export type Quote = Readonly<{
  /** Full coin type, e.g. `0xe95040…::dusdc::DUSDC`. */
  coinType: string;
  /** Symbol from CoinMetadata, e.g. `DUSDC`. Display-only. */
  symbol: string;
  /** Decimals from CoinMetadata, e.g. `6n`. Used in formatDecimal/parseDecimalAmount. */
  decimals: bigint;
}>;

/**
 * Resolves which quote asset the user wants from the protocol's
 * `accepted_quotes` set. Auto-selects when exactly one is available;
 * requires `--quote <symbol-or-type>` to disambiguate when ≥ 2.
 *
 * See docs/superpowers/specs/2026-05-18-chain-synced-quote-discovery-design.md
 * for the full behavior matrix and matching rules.
 */
export const resolveQuote = async (
  _ctx: Ctx,
  _quoteArg: string | undefined,
): Promise<Quote> => {
  throw new Error('resolveQuote not implemented yet');
};
```

- [ ] **Step 1.2: Verify it typechecks**

Run: `npm run typecheck`
Expected: Zero errors (the file compiles even though body throws).

---

## Task 2: Write all resolveQuote tests (RED)

**Files:**
- Create: `test/quote.test.ts`

- [ ] **Step 2.1: Write the full test file**

```typescript
import { describe, expect, it } from 'vitest';
import type { Ctx } from '../src/client.js';
import { resolveQuote } from '../src/lib/quote.js';

const DUSDC_TYPE = '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC';
const USDC_TYPE = '0x1111111111111111111111111111111111111111111111111111111111111111::usdc::USDC';

type StubFetches = Readonly<{
  acceptedQuotes: readonly string[];
  coinMetadata: Record<string, { symbol: string; decimals: number } | null>;
}>;

const makeCtx = (stubs: StubFetches): Ctx =>
  ({
    config: {
      PREDICT_OBJECT_ID: '0xpredict',
    },
    client: {
      getObject: async () => ({
        data: {
          content: {
            dataType: 'moveObject',
            fields: {
              treasury_config: {
                fields: {
                  accepted_quotes: {
                    fields: {
                      contents: stubs.acceptedQuotes.map((t) => ({
                        fields: { name: t.replace(/^0x/, '') },
                      })),
                    },
                  },
                },
              },
            },
          },
        },
      }),
      getCoinMetadata: async ({ coinType }: { coinType: string }) =>
        stubs.coinMetadata[coinType] ?? null,
    },
  }) as unknown as Ctx;

describe('resolveQuote', () => {
  it('single quote, no flag → auto-selects', async () => {
    const ctx = makeCtx({
      acceptedQuotes: [DUSDC_TYPE],
      coinMetadata: { [DUSDC_TYPE]: { symbol: 'DUSDC', decimals: 6 } },
    });
    const q = await resolveQuote(ctx, undefined);
    expect(q).toEqual({ coinType: DUSDC_TYPE, symbol: 'DUSDC', decimals: 6n });
  });

  it('single quote, matching symbol flag → returns it', async () => {
    const ctx = makeCtx({
      acceptedQuotes: [DUSDC_TYPE],
      coinMetadata: { [DUSDC_TYPE]: { symbol: 'DUSDC', decimals: 6 } },
    });
    const q = await resolveQuote(ctx, 'DUSDC');
    expect(q.coinType).toBe(DUSDC_TYPE);
  });

  it('single quote, matching full-type flag → returns it', async () => {
    const ctx = makeCtx({
      acceptedQuotes: [DUSDC_TYPE],
      coinMetadata: { [DUSDC_TYPE]: { symbol: 'DUSDC', decimals: 6 } },
    });
    const q = await resolveQuote(ctx, DUSDC_TYPE);
    expect(q.coinType).toBe(DUSDC_TYPE);
  });

  it('single quote, mismatched flag → throws with available list', async () => {
    const ctx = makeCtx({
      acceptedQuotes: [DUSDC_TYPE],
      coinMetadata: { [DUSDC_TYPE]: { symbol: 'DUSDC', decimals: 6 } },
    });
    await expect(resolveQuote(ctx, 'USDC')).rejects.toThrow(/did not match.*DUSDC/);
  });

  it('multi quote, no flag → throws AmbiguousQuote with options', async () => {
    const ctx = makeCtx({
      acceptedQuotes: [DUSDC_TYPE, USDC_TYPE],
      coinMetadata: {
        [DUSDC_TYPE]: { symbol: 'DUSDC', decimals: 6 },
        [USDC_TYPE]: { symbol: 'USDC', decimals: 6 },
      },
    });
    await expect(resolveQuote(ctx, undefined)).rejects.toThrow(/--quote required.*DUSDC.*USDC/);
  });

  it('multi quote, matching symbol flag → returns chosen', async () => {
    const ctx = makeCtx({
      acceptedQuotes: [DUSDC_TYPE, USDC_TYPE],
      coinMetadata: {
        [DUSDC_TYPE]: { symbol: 'DUSDC', decimals: 6 },
        [USDC_TYPE]: { symbol: 'USDC', decimals: 6 },
      },
    });
    const q = await resolveQuote(ctx, 'USDC');
    expect(q.coinType).toBe(USDC_TYPE);
  });

  it('multi quote, matching full-type flag → returns chosen', async () => {
    const ctx = makeCtx({
      acceptedQuotes: [DUSDC_TYPE, USDC_TYPE],
      coinMetadata: {
        [DUSDC_TYPE]: { symbol: 'DUSDC', decimals: 6 },
        [USDC_TYPE]: { symbol: 'USDC', decimals: 6 },
      },
    });
    const q = await resolveQuote(ctx, USDC_TYPE);
    expect(q.coinType).toBe(USDC_TYPE);
  });

  it('multi quote, case-mismatched symbol flag → still matches (case-insensitive)', async () => {
    const ctx = makeCtx({
      acceptedQuotes: [DUSDC_TYPE, USDC_TYPE],
      coinMetadata: {
        [DUSDC_TYPE]: { symbol: 'DUSDC', decimals: 6 },
        [USDC_TYPE]: { symbol: 'USDC', decimals: 6 },
      },
    });
    const q = await resolveQuote(ctx, 'usdc');
    expect(q.coinType).toBe(USDC_TYPE);
  });

  it('empty accepted_quotes → throws NoAcceptedQuotes', async () => {
    const ctx = makeCtx({ acceptedQuotes: [], coinMetadata: {} });
    await expect(resolveQuote(ctx, undefined)).rejects.toThrow(/no accepted quotes/i);
  });

  it('getCoinMetadata returns null → throws clear error', async () => {
    const ctx = makeCtx({
      acceptedQuotes: [DUSDC_TYPE],
      coinMetadata: { [DUSDC_TYPE]: null },
    });
    await expect(resolveQuote(ctx, undefined)).rejects.toThrow(/CoinMetadata not found/);
  });
});
```

- [ ] **Step 2.2: Run tests to confirm they all fail (RED)**

Run: `npx vitest run test/quote.test.ts`
Expected: 10 failing tests (all hit the `not implemented yet` throw).

---

## Task 3: Implement resolveQuote (GREEN) + commit

**Files:**
- Modify: `src/lib/quote.ts`

- [ ] **Step 3.1: Replace the stub with the real implementation**

```typescript
import type { Ctx } from '../client.js';

export type Quote = Readonly<{
  coinType: string;
  symbol: string;
  decimals: bigint;
}>;

export const resolveQuote = async (
  ctx: Ctx,
  quoteArg: string | undefined,
): Promise<Quote> => {
  const accepted = await fetchAcceptedQuotes(ctx);
  if (accepted.length === 0) {
    throw new Error(
      `Predict object ${ctx.config.PREDICT_OBJECT_ID} has no accepted quotes — protocol misconfigured.`,
    );
  }

  const metadata = await Promise.all(
    accepted.map(async (coinType) => {
      const md = await ctx.client.getCoinMetadata({ coinType });
      if (!md) throw new Error(`CoinMetadata not found for ${coinType}`);
      return { coinType, symbol: md.symbol, decimals: BigInt(md.decimals) };
    }),
  );

  if (!quoteArg) {
    if (metadata.length === 1) return Object.freeze(metadata[0]!);
    throw new Error(
      `--quote required to disambiguate. Multiple accepted quotes available: ` +
        formatChoices(metadata),
    );
  }

  const chosen = matchQuote(metadata, quoteArg);
  if (!chosen) {
    throw new Error(
      `--quote "${quoteArg}" did not match any accepted quote. Available: ` +
        formatChoices(metadata),
    );
  }
  return Object.freeze(chosen);
};

const fetchAcceptedQuotes = async (ctx: Ctx): Promise<readonly string[]> => {
  const res = await ctx.client.getObject({
    id: ctx.config.PREDICT_OBJECT_ID,
    options: { showContent: true },
  });
  const content = (res as { data?: { content?: { dataType?: string; fields?: unknown } } })?.data
    ?.content;
  if (!content || content.dataType !== 'moveObject') {
    throw new Error(`Predict object ${ctx.config.PREDICT_OBJECT_ID} has no Move content`);
  }
  const fields = content.fields as Record<string, unknown>;
  const treasury = nested(fields.treasury_config);
  const set = nested(treasury.accepted_quotes);
  const contents = (set.contents ?? []) as Array<{ fields?: { name?: string } } | string>;
  return contents
    .map((c) => (typeof c === 'string' ? c : c.fields?.name))
    .filter((n): n is string => Boolean(n))
    .map((n) => (n.startsWith('0x') ? n : `0x${n}`));
};

const matchQuote = (
  candidates: readonly Quote[],
  arg: string,
): Quote | undefined => {
  if (arg.includes('::')) {
    return candidates.find((c) => c.coinType === arg);
  }
  const lower = arg.trim().toLowerCase();
  return candidates.find((c) => c.symbol.toLowerCase() === lower);
};

const formatChoices = (quotes: readonly Quote[]): string =>
  '[' + quotes.map((q) => `${q.symbol} (${q.coinType})`).join(', ') + ']';

const nested = (raw: unknown): Record<string, unknown> => {
  if (raw && typeof raw === 'object' && 'fields' in raw) {
    const inner = (raw as { fields?: unknown }).fields;
    if (inner && typeof inner === 'object') return inner as Record<string, unknown>;
  }
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
};
```

- [ ] **Step 3.2: Run tests to confirm they all pass (GREEN)**

Run: `npx vitest run test/quote.test.ts`
Expected: 10 passing tests.

- [ ] **Step 3.3: Run typecheck and full test suite to confirm no regressions**

Run: `npm run typecheck && npm test`
Expected: typecheck green; 28 existing + 10 new = 38 tests passing.

- [ ] **Step 3.4: Commit**

```bash
git add src/lib/quote.ts test/quote.test.ts
git commit -m "feat: add resolveQuote helper for chain-synced quote discovery"
```

---

## Task 4: Remove QUOTE_COIN_TYPE from config

**Files:**
- Modify: `src/config.ts`

- [ ] **Step 4.1: Delete the zod field and pickEnv entry**

In `src/config.ts`, remove these three sets of lines:

```typescript
// Remove from ConfigSchema (lines 18-20):
QUOTE_COIN_TYPE: z
  .string()
  .regex(COIN_TYPE, 'QUOTE_COIN_TYPE must look like 0x<pkg>::<module>::<Struct>'),

// Remove from pickEnv (line 44):
QUOTE_COIN_TYPE: process.env.QUOTE_COIN_TYPE,
```

The `COIN_TYPE` regex on line 5 is now unused — also remove it:

```typescript
// Remove line 5:
const COIN_TYPE = /^0x[0-9a-f]{1,64}::[A-Za-z_][A-Za-z0-9_]*::[A-Za-z_][A-Za-z0-9_]*$/;
```

- [ ] **Step 4.2: Verify typecheck FAILS in expected places**

Run: `npm run typecheck`
Expected: ~13 errors, all of shape `Property 'QUOTE_COIN_TYPE' does not exist on type 'Config'`. These are the call-sites we'll fix in Tasks 5–15. Do not commit yet.

---

## Task 5: Fix PTB builders (6 files, single-line each)

**Files:**
- Modify: `src/ptb/deposit.ts`
- Modify: `src/ptb/withdraw.ts`
- Modify: `src/ptb/mintBinary.ts`
- Modify: `src/ptb/redeem.ts`
- Modify: `src/ptb/lpSupply.ts`
- Modify: `src/ptb/lpWithdraw.ts`

- [ ] **Step 5.1: Make `coinType` required in each builder's args + remove the fallback**

Pattern (apply to each of the 6 files): change the `?? ctx.config.QUOTE_COIN_TYPE` fallback to require the argument.

For `src/ptb/deposit.ts` ([deposit.ts:11-13](../../src/ptb/deposit.ts#L11-L13) and [deposit.ts:20](../../src/ptb/deposit.ts#L20)):

```typescript
// Before:
  /** Coin type to deposit. Defaults to `ctx.config.QUOTE_COIN_TYPE`. */
  coinType?: string;
// ...
  const coinType = args.coinType ?? ctx.config.QUOTE_COIN_TYPE;

// After:
  /** Coin type to deposit. Resolved from accepted_quotes via resolveQuote(). */
  coinType: string;
// ...
  const coinType = args.coinType;
```

Apply the same shape (`coinType?` → `coinType`, remove `?? ctx.config.QUOTE_COIN_TYPE`) to:
- `src/ptb/withdraw.ts`
- `src/ptb/mintBinary.ts`
- `src/ptb/redeem.ts`
- `src/ptb/lpSupply.ts`
- `src/ptb/lpWithdraw.ts`

- [ ] **Step 5.2: Verify typecheck FAILS only in scripts (not in PTB builders)**

Run: `npm run typecheck`
Expected: ~9 errors remaining, all in `src/scripts/*.ts` — the PTB builder layer is clean. Do not commit yet.

---

## Task 6: Update src/scripts/inspect.ts

**Files:**
- Modify: `src/scripts/inspect.ts`

- [ ] **Step 6.1: Add quote resolution at top of main() and thread through**

Read current state: [src/scripts/inspect.ts:25,29,67-68,96](../../src/scripts/inspect.ts).

```typescript
// Add import at top:
import { resolveQuote, type Quote } from '../lib/quote.js';
import { readFlag } from './_cli.js';

// In main(), after createContext():
const quote = await resolveQuote(ctx, readFlag(process.argv.slice(2), '--quote'));

// Replace ctx.config.QUOTE_COIN_TYPE call-sites with quote.coinType (line 25, 29):
getQuoteBalance(ctx, manager, quote.coinType),
// ...
walletCoinBalance(ctx, manager.owner, quote.coinType),

// In renderWallet (line 67-68), replace 'DUSDC' label and 6n with dynamic:
[quote.symbol, formatDecimal(dusdc, quote.decimals, { groupThousands: true })],
[ 'PLP', formatDecimal(plp, 6n, { groupThousands: true })],   // PLP stays 6n

// In renderManager (around line 96), replace 'quote_balance (USDC)' and 6n:
[`quote_balance (${quote.symbol})`, formatDecimal(balance, quote.decimals, { groupThousands: true })],
```

Pass `quote` as a parameter to `renderWallet` and `renderManager` if they need it (signature change is fine).

- [ ] **Step 6.2: Verify the file typechecks**

Run: `npm run typecheck`
Expected: count of errors decreased by ~2-3.

- [ ] **Step 6.3: Smoke test the script (read-only, safe to run)**

Run: `npm run --silent inspect | head -50`
Expected: TreasuryConfig section shows DUSDC; Wallet section labels show DUSDC dynamically; numbers look correct.

---

## Task 7: Update src/scripts/setup.ts

**Files:**
- Modify: `src/scripts/setup.ts`

- [ ] **Step 7.1: Resolve quote, replace constants and config references**

```typescript
// Add import:
import { resolveQuote } from '../lib/quote.js';

// At top of main(), after createContext():
const quote = await resolveQuote(ctx, readFlag(argv, '--quote'));

// Delete:
const QUOTE_DECIMALS = 6n;

// Replace all `ctx.config.QUOTE_COIN_TYPE` → `quote.coinType`
// Replace all `QUOTE_DECIMALS` → `quote.decimals`
// Replace hardcoded 'DUSDC' label strings → `quote.symbol`
```

- [ ] **Step 7.2: Verify typecheck**

Run: `npm run typecheck`
Expected: errors decreased further.

- [ ] **Step 7.3: Smoke test**

Run: `npm run setup`
Expected: "wallet DUSDC: …" line still appears (now generated dynamically); no behavior change.

---

## Task 8: Update src/scripts/preview.ts

**Files:**
- Modify: `src/scripts/preview.ts`

- [ ] **Step 8.1: Same pattern as Task 7**

- Add `resolveQuote` import + call at top of `main()`.
- Delete `const QUOTE_DECIMALS = 6n;`.
- Replace `QUOTE_DECIMALS` with `quote.decimals` throughout.
- Replace any hardcoded `'DUSDC'` labels with `quote.symbol`.

- [ ] **Step 8.2: Smoke test**

Run: `npm run preview -- --strikes 80000,80500,81000`
Expected: the preview table renders; ask/bid values use correct decimal scaling.

---

## Task 9: Update src/scripts/deposit.ts

**Files:**
- Modify: `src/scripts/deposit.ts`

- [ ] **Step 9.1: Resolve quote, pass to PTB builder**

```typescript
// Add import:
import { resolveQuote } from '../lib/quote.js';

// In main(), after createContext():
const quote = await resolveQuote(ctx, readFlag(argv, '--quote'));

// In the buildDepositTx call, add coinType:
const tx = await buildDepositTx(ctx, {
  amount: raw,
  sender,
  coinType: quote.coinType,
});

// Replace any hardcoded decimals/symbol in the summary print + parseDecimalAmount:
const raw = parseDecimalAmount(amountRaw, Number(quote.decimals));
// ...
process.stdout.write(`  amount: ${formatDecimal(raw, quote.decimals)} ${quote.symbol}\n`);
```

Replace the template-string `${QUOTE_COIN_TYPE}` references in printHelp (line 52 in current source: `coin type: \${QUOTE_COIN_TYPE} from .env`) with `quote.coinType` (resolved at runtime) or update help text to say `auto-resolved from chain; override with --quote`.

- [ ] **Step 9.2: Smoke test (dry-run only — safe)**

Run: `npm run deposit -- --amount 1`
Expected: dry-run summary prints; no PRIVATE_KEY needed for devInspect; output shows correct DUSDC label and decimals.

---

## Task 10: Update src/scripts/withdraw.ts

**Files:**
- Modify: `src/scripts/withdraw.ts`

- [ ] **Step 10.1: Mirror Task 9 for withdraw**

Same pattern. Replace `ctx.config.QUOTE_COIN_TYPE` with `quote.coinType`, replace hardcoded decimals/symbol, update help text.

- [ ] **Step 10.2: Smoke test**

Run: `npm run withdraw -- --amount 1`
Expected: dry-run summary prints correctly.

---

## Task 11: Update src/scripts/mint-binary.ts

**Files:**
- Modify: `src/scripts/mint-binary.ts`

- [ ] **Step 11.1: Resolve quote, replace constants**

```typescript
// Add import:
import { resolveQuote } from '../lib/quote.js';

// In main(), after createContext():
const quote = await resolveQuote(ctx, readFlag(argv, '--quote'));

// Delete:
const QUOTE_DECIMALS = 6n;

// Replace at line 56:
const balance = await getQuoteBalance(ctx, manager, quote.coinType);

// In printSummary, printPreview: use quote.decimals + quote.symbol instead of QUOTE_DECIMALS + 'DUSDC'.

// In parseArgs (line 168), update parseDecimalAmount for --qty:
quantity: parseDecimalAmount(qtyRaw, Number(quote.decimals)),
// (the `--strike` parse uses PRICE_DECIMALS=9n which is oracle scale, NOT quote — leave alone)

// In buildMintBinaryTx call: pass coinType: quote.coinType.
```

- [ ] **Step 11.2: Smoke test**

Run: `npm run mint-binary -- --strike 80500 --qty 1 --direction up`
Expected: dry-run summary; "cost (ask × qty): X DUSDC" labels render correctly.

---

## Task 12: Update src/scripts/redeem.ts

**Files:**
- Modify: `src/scripts/redeem.ts`

- [ ] **Step 12.1: Resolve quote, replace constants**

```typescript
// Add import:
import { resolveQuote } from '../lib/quote.js';

// In main(), after createContext():
const quote = await resolveQuote(ctx, readFlag(argv, '--quote'));

// Delete:
const QUOTE_DECIMALS = 6n;

// Substitutions throughout the file:
//   ctx.config.QUOTE_COIN_TYPE   →  quote.coinType
//   QUOTE_DECIMALS               →  quote.decimals
//   'DUSDC' (label strings)      →  quote.symbol
//   parseDecimalAmount(x, 6)     →  parseDecimalAmount(x, Number(quote.decimals))

// In the buildRedeemTx call: add `coinType: quote.coinType`.
```

- [ ] **Step 12.2: Smoke test**

Run: `npm run redeem -- --strike 80500 --qty 1 --direction up`
Expected: dry-run summary prints (likely fails the balance gate, which is fine — we just want the pre-balance logic to render correctly).

---

## Task 13: Update src/scripts/lp-supply.ts

**Files:**
- Modify: `src/scripts/lp-supply.ts`

- [ ] **Step 13.1: Resolve quote, replace constants (PLP-aware)**

```typescript
// Add import:
import { resolveQuote } from '../lib/quote.js';

// In main(), after createContext():
const quote = await resolveQuote(ctx, readFlag(argv, '--quote'));

// Delete:
const QUOTE_DECIMALS = 6n;

// Substitutions throughout the file:
//   ctx.config.QUOTE_COIN_TYPE   →  quote.coinType
//   QUOTE_DECIMALS               →  quote.decimals
//   'DUSDC' (label strings)      →  quote.symbol
//   parseDecimalAmount(x, 6)     →  parseDecimalAmount(x, Number(quote.decimals))

// IMPORTANT: PLP itself stays 6n hardcoded (PLP is a separate coin
// whose decimals the protocol fixes). Only quote-side scaling becomes
// dynamic. The line printing the share/value ratio:
//   `share/value ratio:  ${formatDecimal(ratioE6, 6n)} PLP per 1 DUSDC of vault_value`
// becomes:
//   `share/value ratio:  ${formatDecimal(ratioE6, 6n)} PLP per 1 ${quote.symbol} of vault_value`

// In the buildLpSupplyTx call: add `coinType: quote.coinType`.
```

- [ ] **Step 13.2: Smoke test**

Run: `npm run lp-supply -- --amount 1`
Expected: dry-run summary; vault metrics and share/value ratio render correctly.

---

## Task 14: Update src/scripts/lp-withdraw.ts

**Files:**
- Modify: `src/scripts/lp-withdraw.ts`

- [ ] **Step 14.1: Resolve quote, replace constants (PLP-aware)**

```typescript
// Add import:
import { resolveQuote } from '../lib/quote.js';

// In main(), after createContext():
const quote = await resolveQuote(ctx, readFlag(argv, '--quote'));

// Delete:
const QUOTE_DECIMALS = 6n;

// Substitutions throughout the file:
//   ctx.config.QUOTE_COIN_TYPE   →  quote.coinType
//   QUOTE_DECIMALS               →  quote.decimals
//   'DUSDC' (label strings)      →  quote.symbol
//   parseDecimalAmount(x, 6)     →  parseDecimalAmount(x, Number(quote.decimals))

// IMPORTANT: PLP shares stay 6n hardcoded (PLP coin decimals are
// fixed by the protocol). --shares <human> is a PLP amount, NOT a
// quote amount — leave `parseDecimalAmount(sharesRaw, 6)` alone.
// Only the DUSDC-side (vault value, payout estimate) becomes dynamic.

// In the buildLpWithdrawTx call: add `coinType: quote.coinType`.
```

- [ ] **Step 14.2: Smoke test**

Run: `npm run lp-withdraw -- --shares 1`
Expected: dry-run summary prints.

---

## Task 15: Update src/scripts/e2e.ts

**Files:**
- Modify: `src/scripts/e2e.ts`

- [ ] **Step 15.1: Resolve quote ONCE at top of orchestrator; thread through all sub-steps**

```typescript
// Add import:
import { resolveQuote } from '../lib/quote.js';

// At top of main(), after createContext():
const quote = await resolveQuote(ctx, readFlag(argv, '--quote'));

// Delete:
const QUOTE_DECIMALS = 6n;

// Replace at line 45 and any other site:
(await ctx.client.getBalance({ owner: sender, coinType: quote.coinType }))

// Pass coinType: quote.coinType to every PTB builder call.
// Replace QUOTE_DECIMALS with quote.decimals throughout.
// Replace 'DUSDC' label strings with quote.symbol.
```

- [ ] **Step 15.2: Verify typecheck passes (final compile-error check)**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 15.3: Run full test suite**

Run: `npm test`
Expected: 38 tests passing (28 existing + 10 new). No regressions.

- [ ] **Step 15.4: Smoke test e2e dry-run**

Run: `npm run e2e`
Expected: dry-run sequence runs end-to-end without crashing; each step's printed labels use the dynamic symbol.

- [ ] **Step 15.5: Commit the full refactor**

```bash
git add src/config.ts src/ptb/ src/scripts/
git commit -m "refactor: thread chain-resolved Quote through all scripts and builders"
```

---

## Task 16: Update .env.example

**Files:**
- Modify: `.env.example`

- [ ] **Step 16.1: Delete the Quote section**

Remove these two lines from `.env.example`:

```
# --- Quote ---
QUOTE_COIN_TYPE=0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC
```

(Leaves a single blank line where the section was — that's fine.)

- [ ] **Step 16.2: Verify config still loads from a clean copy**

Run: `cp .env.example /tmp/test.env && env -i NODE_ENV=test sh -c "cd $(pwd) && cp /tmp/test.env .env.test && DOTENV_CONFIG_PATH=.env.test npm run typecheck"`

Or simpler: just confirm by reading `src/config.ts` no longer references `QUOTE_COIN_TYPE` (this was already verified in Task 4).

---

## Task 17: Update README.md

**Files:**
- Modify: `README.md`

- [ ] **Step 17.1: Remove QUOTE_COIN_TYPE row from Configuration table**

In the Configuration table ([README.md:54-65](../../README.md#L54-L65)), delete the row:

```
| `QUOTE_COIN_TYPE` | DUSDC fully-qualified type |
```

- [ ] **Step 17.2: Add `--quote` flag documentation**

Add a new section after the existing Command reference (after [README.md:111](../../README.md#L111)):

```markdown
### Quote selection

All commands resolve the quote asset from the protocol's
`Predict.treasury_config.accepted_quotes` set on startup. Currently this
set contains only DUSDC; the CLI auto-selects it.

When Mysten adds a second quote asset (e.g. USDC), the CLI will refuse to
run signing commands without an explicit `--quote`:

```bash
npm run mint-binary -- --quote DUSDC --strike 80500 --qty 5 --direction up
npm run deposit     -- --quote 0xe95040…::dusdc::DUSDC --amount 100   # full type also works
```

The flag accepts either a symbol (case-insensitive match against
`CoinMetadata.symbol`) or a full coin type (containing `::`).
```

- [ ] **Step 17.3: Add troubleshooting entry**

Add a new entry to the Troubleshooting section (after [README.md:294](../../README.md#L294)):

```markdown
### "--quote required to disambiguate"

`Predict.treasury_config.accepted_quotes` contains more than one quote
asset. Re-run with `--quote <symbol>` (e.g. `--quote DUSDC`) or the full
coin type. `npm run inspect` lists the accepted quotes under
`TreasuryConfig — accepted quotes`.
```

- [ ] **Step 17.4: Update Configuration intro line if needed**

The line at [README.md:50](../../README.md#L50) says "All on-chain identifiers live in `.env`." This is still mostly true — only the quote no longer does. Optionally append: "Quote asset is discovered from the protocol's `accepted_quotes` at runtime."

- [ ] **Step 17.5: Commit docs**

```bash
git add .env.example README.md
git commit -m "docs: drop QUOTE_COIN_TYPE from .env.example and document chain-synced quote selection"
```

---

## Task 18: Final verification

**Files:**
- (no edits — verification only)

- [ ] **Step 18.1: Confirm zero references to dead names**

Run: `grep -rn 'QUOTE_COIN_TYPE\|QUOTE_DECIMALS' src/ test/ .env.example`
Expected: zero hits. (Hits in `docs/` or `notes/` are fine — those are historical.)

- [ ] **Step 18.2: Full test + typecheck**

Run: `npm run typecheck && npm test`
Expected: typecheck green; 38 tests passing.

- [ ] **Step 18.3: Run inspect to verify live behavior**

Run: `npm run --silent inspect | grep -A 3 'TreasuryConfig\|Wallet\|quote_balance'`
Expected: TreasuryConfig section lists DUSDC; Wallet section shows DUSDC label dynamically; manager `quote_balance (DUSDC)` line shows correct number.

- [ ] **Step 18.4: If any changes from verification, commit them; otherwise done.**

```bash
git status         # should be clean if no fixes needed
git log --oneline -5   # confirm the 3 commits from this plan are present
```

---

## Summary of expected git history after this plan

```
docs: drop QUOTE_COIN_TYPE from .env.example and document chain-synced quote selection
refactor: thread chain-resolved Quote through all scripts and builders
feat: add resolveQuote helper for chain-synced quote discovery
docs: chain-synced quote discovery design spec   ← already exists (29ce7d1)
```

Three new commits on top of the spec commit. Each is independently revertable.
