import { describe, expect, it } from 'vitest';
import { parseDecimalAmount } from '../src/scripts/_cli.js';

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
