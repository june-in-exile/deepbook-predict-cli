import { describe, it, expect } from 'vitest';

import {
  shortId,
  formatTimeToExpiry,
  formatUtc,
  oracleStatusLabel,
  perUnitE9,
  fmtPriceCell,
} from '../src/tui/format.js';

describe('shortId', () => {
  it('abbreviates a full object id', () => {
    expect(shortId('0x' + 'ab'.repeat(32))).toBe('0xababab…abab');
  });
  it('leaves short / non-hex strings untouched', () => {
    expect(shortId('BTC')).toBe('BTC');
    expect(shortId('0xabcd')).toBe('0xabcd');
  });
});

describe('formatTimeToExpiry', () => {
  const now = 1_000_000_000_000;
  it('shows hours into the future', () => {
    expect(formatTimeToExpiry(now + 3_600_000 * 12.4, now)).toBe('12.4h');
  });
  it('marks past expiries as ago', () => {
    expect(formatTimeToExpiry(now - 3_600_000 * 2, now)).toBe('2.0h ago');
  });
  it('switches to days past 48h', () => {
    expect(formatTimeToExpiry(now + 3_600_000 * 72, now)).toBe('3.0d');
  });
});

describe('formatUtc', () => {
  it('trims the millisecond suffix', () => {
    expect(formatUtc(0)).toBe('1970-01-01T00:00:00Z');
  });
});

describe('oracleStatusLabel', () => {
  it('reports settled once a settlement price exists', () => {
    expect(oracleStatusLabel('active', 80_000)).toBe('settled');
  });
  it('passes the raw status through otherwise', () => {
    expect(oracleStatusLabel('active', null)).toBe('active');
  });
});

describe('perUnitE9', () => {
  it('rescales a 1e6 cost to a 1e9 per-unit price', () => {
    // cost 2.4 (2_400_000 e6) over qty 5 ($5 e6) → 0.48 per $1 → 480_000_000 e9
    expect(perUnitE9(2_400_000n, 5_000_000n)).toBe(480_000_000n);
  });
  it('returns 0 for zero quantity', () => {
    expect(perUnitE9(123n, 0n)).toBe(0n);
  });
});

describe('fmtPriceCell', () => {
  it('renders an em-dash for null', () => {
    expect(fmtPriceCell(null, 8)).toBe('       —');
  });
  it('right-pads a formatted price', () => {
    expect(fmtPriceCell(500_000_000n, 8)).toBe('     0.5');
  });
});
