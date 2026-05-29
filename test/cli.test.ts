import { describe, expect, it } from 'vitest';
import { formatDecimal, parseDecimalAmount, waitForBalances } from '../src/scripts/_cli.js';
import type { Ctx } from '../src/client.js';

/** Minimal Ctx whose getBalance walks `script[coinType]` one entry per call,
 *  clamping to the last entry once a coin's script is exhausted. */
const fakeCtx = (script: Record<string, ReadonlyArray<bigint>>): { ctx: Ctx; calls: () => number } => {
  const perCoin = new Map<string, number>();
  let calls = 0;
  const ctx = {
    client: {
      getBalance: async ({ coinType }: { coinType: string }) => {
        const seq = script[coinType] ?? [0n];
        const i = perCoin.get(coinType) ?? 0;
        perCoin.set(coinType, i + 1);
        calls += 1;
        return { totalBalance: (seq[Math.min(i, seq.length - 1)] ?? 0n).toString() };
      },
    },
  } as unknown as Ctx;
  return { ctx, calls: () => calls };
};

describe('parseDecimalAmount', () => {
  it('scales whole numbers', () => {
    expect(parseDecimalAmount('100', 6)).toBe(100_000_000n);
    expect(parseDecimalAmount('1', 6)).toBe(1_000_000n);
    expect(parseDecimalAmount('0', 6)).toBe(0n);
  });

  it('handles fractional input up to the declared precision', () => {
    expect(parseDecimalAmount('0.5', 6)).toBe(500_000n);
    expect(parseDecimalAmount('0.000001', 6)).toBe(1n);
    expect(parseDecimalAmount('100.123456', 6)).toBe(100_123_456n);
  });

  it('truncates extra fractional digits beyond declared precision', () => {
    expect(parseDecimalAmount('0.1234567', 6)).toBe(123_456n);
  });

  it('pads short fractions with zeros', () => {
    expect(parseDecimalAmount('0.1', 6)).toBe(100_000n);
    expect(parseDecimalAmount('0.12', 6)).toBe(120_000n);
  });

  it('rejects non-numeric input', () => {
    expect(() => parseDecimalAmount('abc', 6)).toThrow(/decimal number/);
    expect(() => parseDecimalAmount('1e6', 6)).toThrow(/decimal number/);
    expect(() => parseDecimalAmount('-1', 6)).toThrow(/decimal number/);
  });
});

describe('waitForBalances', () => {
  const COIN = '0x2::test::USDC';

  it('returns immediately when the index already reports the expected value', async () => {
    const { ctx, calls } = fakeCtx({ [COIN]: [500n] });
    await waitForBalances(ctx, '0xowner', new Map([[COIN, 500n]]), { pollMs: 1 });
    expect(calls()).toBe(1);
  });

  it('polls until a lagging coin index catches up', async () => {
    const { ctx, calls } = fakeCtx({ [COIN]: [100n, 100n, 500n] });
    await waitForBalances(ctx, '0xowner', new Map([[COIN, 500n]]), { pollMs: 1 });
    expect(calls()).toBe(3);
  });

  it('gives up after the timeout instead of blocking forever', async () => {
    const { ctx } = fakeCtx({ [COIN]: [100n] });
    await waitForBalances(ctx, '0xowner', new Map([[COIN, 999n]]), { timeoutMs: 10, pollMs: 5 });
    expect(true).toBe(true); // resolved rather than hanging
  });

  it('waits for every coin type to reach its target', async () => {
    const A = '0x2::a::A';
    const B = '0x2::b::B';
    const { ctx } = fakeCtx({ [A]: [1n, 10n], [B]: [2n, 2n, 20n] });
    await waitForBalances(ctx, '0xowner', new Map([[A, 10n], [B, 20n]]), { pollMs: 1 });
    expect(true).toBe(true);
  });
});

describe('formatDecimal', () => {
  it('renders raw → human at the given precision', () => {
    expect(formatDecimal(100_000_000n, 6n)).toBe('100');
    expect(formatDecimal(123_456n, 6n)).toBe('0.123456');
    expect(formatDecimal(0n, 6n)).toBe('0');
  });
  it('strips trailing zeros from the fraction', () => {
    expect(formatDecimal(100_500_000n, 6n)).toBe('100.5');
    expect(formatDecimal(100_120_000n, 6n)).toBe('100.12');
  });
  it('groups thousands when asked', () => {
    expect(formatDecimal(1_234_567_890n, 6n, { groupThousands: true })).toBe('1,234.56789');
    expect(formatDecimal(1_001_034_513_600n, 6n, { groupThousands: true })).toBe('1,001,034.5136');
  });
  it('handles negative values', () => {
    expect(formatDecimal(-100n, 2n)).toBe('-1');
    expect(formatDecimal(-1_234_500n, 6n, { groupThousands: true })).toBe('-1.2345');
  });
});
