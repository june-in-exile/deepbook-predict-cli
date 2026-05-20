import { describe, expect, it } from 'vitest';

import type { Ctx } from '../src/client.js';
import { resolveQuote } from '../src/lib/quote.js';

const DUSDC_TYPE =
  '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC';
const USDC_TYPE =
  '0x1111111111111111111111111111111111111111111111111111111111111111::usdc::USDC';

const makeCtx = (stubs: {
  acceptedQuotes: readonly string[];
  coinMetadata: Record<string, { symbol: string; decimals: number } | null>;
}): Ctx =>
  ({
    config: {},
    predictObjectId: '0xpredict',
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
    const result = await resolveQuote(ctx, undefined);
    expect(result.coinType).toBe(DUSDC_TYPE);
    expect(result.symbol).toBe('DUSDC');
    expect(result.decimals).toBe(6n);
  });

  it('single quote, matching symbol flag → returns it', async () => {
    const ctx = makeCtx({
      acceptedQuotes: [DUSDC_TYPE],
      coinMetadata: { [DUSDC_TYPE]: { symbol: 'DUSDC', decimals: 6 } },
    });
    const result = await resolveQuote(ctx, 'DUSDC');
    expect(result.coinType).toBe(DUSDC_TYPE);
    expect(result.symbol).toBe('DUSDC');
  });

  it('single quote, matching full-type flag → returns it', async () => {
    const ctx = makeCtx({
      acceptedQuotes: [DUSDC_TYPE],
      coinMetadata: { [DUSDC_TYPE]: { symbol: 'DUSDC', decimals: 6 } },
    });
    const result = await resolveQuote(ctx, DUSDC_TYPE);
    expect(result.coinType).toBe(DUSDC_TYPE);
  });

  it('single quote, mismatched flag → throws with available list', async () => {
    const ctx = makeCtx({
      acceptedQuotes: [DUSDC_TYPE],
      coinMetadata: { [DUSDC_TYPE]: { symbol: 'DUSDC', decimals: 6 } },
    });
    await expect(resolveQuote(ctx, 'WRONG')).rejects.toThrow(/did not match.*DUSDC/);
  });

  it('multi quote, no flag → throws AmbiguousQuote', async () => {
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
    const result = await resolveQuote(ctx, 'USDC');
    expect(result.coinType).toBe(USDC_TYPE);
    expect(result.symbol).toBe('USDC');
  });

  it('multi quote, matching full-type flag → returns chosen', async () => {
    const ctx = makeCtx({
      acceptedQuotes: [DUSDC_TYPE, USDC_TYPE],
      coinMetadata: {
        [DUSDC_TYPE]: { symbol: 'DUSDC', decimals: 6 },
        [USDC_TYPE]: { symbol: 'USDC', decimals: 6 },
      },
    });
    const result = await resolveQuote(ctx, DUSDC_TYPE);
    expect(result.coinType).toBe(DUSDC_TYPE);
    expect(result.symbol).toBe('DUSDC');
  });

  it('multi quote, case-mismatched symbol flag → still matches (case-insensitive)', async () => {
    const ctx = makeCtx({
      acceptedQuotes: [DUSDC_TYPE, USDC_TYPE],
      coinMetadata: {
        [DUSDC_TYPE]: { symbol: 'DUSDC', decimals: 6 },
        [USDC_TYPE]: { symbol: 'USDC', decimals: 6 },
      },
    });
    const result = await resolveQuote(ctx, 'dusdc');
    expect(result.coinType).toBe(DUSDC_TYPE);
    expect(result.symbol).toBe('DUSDC');
  });

  it('empty accepted_quotes → throws', async () => {
    const ctx = makeCtx({ acceptedQuotes: [], coinMetadata: {} });
    await expect(resolveQuote(ctx, undefined)).rejects.toThrow(/no accepted quotes/i);
  });

  it('getCoinMetadata returns null → throws', async () => {
    const ctx = makeCtx({
      acceptedQuotes: [DUSDC_TYPE],
      coinMetadata: { [DUSDC_TYPE]: null },
    });
    await expect(resolveQuote(ctx, undefined)).rejects.toThrow(/CoinMetadata not found/);
  });
});
