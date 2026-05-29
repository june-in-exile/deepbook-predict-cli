import { describe, it, expect } from 'vitest';

import type { Position, RangePosition } from '../src/lib/manager.js';
import {
  buildRedeemItems,
  redeemItemLabel,
  redeemQtyError,
  redeemTxPlan,
  settledRangePayout,
  type RedeemItem,
} from '../src/tui/redeem-items.js';

const E9 = 10n ** 9n;
const JUN19 = BigInt(Date.UTC(2026, 5, 19, 8, 0, 0));
const MAY30 = BigInt(Date.UTC(2026, 4, 30, 8, 0, 0));

const binDown: Position = {
  oracleId: '0xosc',
  expiryMs: MAY30,
  strike: 73576n * E9,
  isUp: false,
  quantity: 66_970_541n,
};
const binUpZero: Position = {
  oracleId: '0xzero',
  expiryMs: JUN19,
  strike: 74000n * E9,
  isUp: true,
  quantity: 0n,
};
const rangePos: RangePosition = {
  oracleId: '0xrng',
  expiryMs: JUN19,
  lowerStrike: 73500n * E9,
  higherStrike: 74500n * E9,
  quantity: 2_000_000n,
};

describe('buildRedeemItems', () => {
  it('drops zero-quantity positions, merges binary + range, sorts by expiry', () => {
    const items = buildRedeemItems([binUpZero, binDown], [rangePos]);
    expect(items).toEqual([
      { kind: 'binary', pos: binDown },
      { kind: 'range', pos: rangePos },
    ]);
  });

  it('returns an empty list when nothing is redeemable', () => {
    expect(buildRedeemItems([binUpZero], [])).toEqual([]);
  });
});

describe('redeemItemLabel', () => {
  it('formats a binary DOWN position', () => {
    const item: RedeemItem = { kind: 'binary', pos: binDown };
    expect(redeemItemLabel(item, 6n)).toBe('DOWN strike 73576 · qty 66.970541 · exp 2026-05-30T08:00:00Z');
  });

  it('formats a range position', () => {
    const item: RedeemItem = { kind: 'range', pos: rangePos };
    expect(redeemItemLabel(item, 6n)).toBe('range 73500–74500 · qty 2 · exp 2026-06-19T08:00:00Z');
  });
});

describe('redeemQtyError', () => {
  it('rejects missing or non-positive quantities', () => {
    expect(redeemQtyError(null, 100n, 6n)).toBe('enter a positive quantity');
    expect(redeemQtyError(0n, 100n, 6n)).toBe('enter a positive quantity');
  });

  it('rejects quantities above the position size', () => {
    expect(redeemQtyError(150n, 100n, 6n)).toContain('max');
  });

  it('accepts the full and a partial quantity', () => {
    expect(redeemQtyError(100n, 100n, 6n)).toBeNull();
    expect(redeemQtyError(40n, 100n, 6n)).toBeNull();
  });
});

describe('settledRangePayout', () => {
  const lo = 73500n * E9;
  const hi = 74500n * E9;

  it('is null until a settlement price exists', () => {
    expect(settledRangePayout(null, lo, hi, 2n)).toBeNull();
  });

  it('pays the full quantity when the settlement lands inside the range', () => {
    expect(settledRangePayout(74000n * E9, lo, hi, 2n)).toBe(2n);
    expect(settledRangePayout(lo, lo, hi, 2n)).toBe(2n);
    expect(settledRangePayout(hi, lo, hi, 2n)).toBe(2n);
  });

  it('pays zero when the settlement lands outside the range', () => {
    expect(settledRangePayout(80000n * E9, lo, hi, 2n)).toBe(0n);
  });
});

describe('redeemTxPlan', () => {
  it('maps a binary item to buildRedeemTx args', () => {
    const item: RedeemItem = { kind: 'binary', pos: binDown };
    expect(redeemTxPlan(item, 10n, '0xmgr', '0xUSDC')).toEqual({
      kind: 'binary',
      args: {
        managerId: '0xmgr',
        oracleId: '0xosc',
        expiryMs: MAY30,
        strike: 73576n * E9,
        isUp: false,
        quantity: 10n,
        coinType: '0xUSDC',
      },
    });
  });

  it('maps a range item to buildRedeemRangeTx args', () => {
    const item: RedeemItem = { kind: 'range', pos: rangePos };
    expect(redeemTxPlan(item, 5n, '0xmgr', '0xUSDC')).toEqual({
      kind: 'range',
      args: {
        managerId: '0xmgr',
        oracleId: '0xrng',
        expiryMs: JUN19,
        lower: 73500n * E9,
        higher: 74500n * E9,
        quantity: 5n,
        coinType: '0xUSDC',
      },
    });
  });
});
