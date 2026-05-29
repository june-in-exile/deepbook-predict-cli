import { describe, it, expect } from 'vitest';

import { parsePositionEntry } from '../src/lib/manager.js';

// Shape returned by getDynamicFieldObject for a binary position entry. The
// on-chain MarketKey field is `direction` (u8: 0 = UP, 1 = DOWN) — there is no
// `is_up` field.
const entry = (direction: number, qty: string) => ({
  dataType: 'moveObject',
  fields: {
    name: {
      type: '0xpkg::market_key::MarketKey',
      fields: {
        direction,
        expiry: '1780128000000',
        oracle_id: '0x11c5fff',
        strike: '73576000000000',
      },
    },
    value: qty,
  },
});

describe('parsePositionEntry', () => {
  it('decodes direction 0 as UP', () => {
    const p = parsePositionEntry(entry(0, '66970541'));
    expect(p).not.toBeNull();
    expect(p?.isUp).toBe(true);
    expect(p?.quantity).toBe(66970541n);
    expect(p?.strike).toBe(73576000000000n);
  });

  it('decodes direction 1 as DOWN', () => {
    expect(parsePositionEntry(entry(1, '1000000'))?.isUp).toBe(false);
  });

  it('returns null for non-moveObject content', () => {
    expect(parsePositionEntry(null)).toBeNull();
  });
});
