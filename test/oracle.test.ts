import { describe, expect, it } from 'vitest';
import { Lifecycle, computeLifecycle, parseI64 } from '../src/lib/oracle.js';

describe('parseI64', () => {
  it('decodes positive value', () => {
    expect(parseI64({ is_negative: false, magnitude: '1606269' })).toBe(1606269n);
  });
  it('decodes negative value', () => {
    expect(parseI64({ is_negative: true, magnitude: '1606269' })).toBe(-1606269n);
  });
  it('round-trips zero', () => {
    expect(parseI64({ is_negative: false, magnitude: '0' })).toBe(0n);
  });
  it('returns 0n for malformed input rather than throwing', () => {
    expect(parseI64(undefined)).toBe(0n);
    expect(parseI64({})).toBe(0n);
  });
});

describe('computeLifecycle (mirrors oracle.move::status)', () => {
  // Source precedence: settled > pending-settlement > inactive > active.
  it('Settled wins over everything when settlement_price is set', () => {
    expect(
      computeLifecycle({ active: true, settlementPrice: 99n, expiryMs: 100n, nowMs: 50n }),
    ).toBe(Lifecycle.Settled);
    expect(
      computeLifecycle({ active: false, settlementPrice: 99n, expiryMs: 100n, nowMs: 200n }),
    ).toBe(Lifecycle.Settled);
  });

  it('PendingSettlement when now >= expiry and not settled', () => {
    expect(
      computeLifecycle({ active: true, settlementPrice: null, expiryMs: 100n, nowMs: 100n }),
    ).toBe(Lifecycle.PendingSettlement);
    expect(
      computeLifecycle({ active: true, settlementPrice: null, expiryMs: 100n, nowMs: 999n }),
    ).toBe(Lifecycle.PendingSettlement);
  });

  it('Inactive when not active and before expiry', () => {
    expect(
      computeLifecycle({ active: false, settlementPrice: null, expiryMs: 100n, nowMs: 50n }),
    ).toBe(Lifecycle.Inactive);
  });

  it('Active when active and before expiry', () => {
    expect(
      computeLifecycle({ active: true, settlementPrice: null, expiryMs: 100n, nowMs: 50n }),
    ).toBe(Lifecycle.Active);
  });
});
