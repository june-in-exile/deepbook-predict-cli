import { describe, expect, it } from 'vitest';
import { formatDecimal, parseDecimalAmount } from '../src/scripts/_cli.js';

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
