import { describe, expect, it } from 'vitest';

import type { Position } from '../src/lib/manager.js';
import { pickActiveOracle, pickPositionOracle } from '../src/lib/oracle-pick.js';
import type { OracleEntry } from '../src/lib/server.js';

const EARLIER_ID = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const LATER_ID = '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

const baseEntry: OracleEntry = {
  predict_id: '0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a',
  oracle_id: EARLIER_ID,
  oracle_cap_id: '0x09c3dfff1abb4cd648753805c18a05bcc03d2a4c8f9f7a04b928568aed59f9e3',
  underlying_asset: 'BTC',
  expiry: 1_778_673_600_000,
  min_strike: 50_000_000_000_000,
  tick_size: 1_000_000_000,
  status: 'active',
  activated_at: 1_778_653_000_000,
  settlement_price: null,
  settled_at: null,
  created_checkpoint: 336_363_109,
};

const make = (overrides: Partial<OracleEntry> = {}): OracleEntry => ({ ...baseEntry, ...overrides });

describe('pickActiveOracle', () => {
  it('throws when the active set is empty', () => {
    expect(() => pickActiveOracle([])).toThrow(/No active oracle/i);
  });

  it('returns the single active oracle when only one is available', () => {
    const only = make({ oracle_id: EARLIER_ID });
    expect(pickActiveOracle([only])).toBe(only);
  });

  it('picks the earliest-expiring oracle when multiple are active', () => {
    const earlier = make({ oracle_id: EARLIER_ID, expiry: 1_500_000_000_000 });
    const later = make({ oracle_id: LATER_ID, expiry: 2_000_000_000_000 });
    expect(pickActiveOracle([later, earlier])).toBe(earlier);
  });

  it('does not mutate the input list when sorting', () => {
    const input = [
      make({ oracle_id: LATER_ID, expiry: 2_000_000_000_000 }),
      make({ oracle_id: EARLIER_ID, expiry: 1_500_000_000_000 }),
    ];
    const snapshot = [...input];

    pickActiveOracle(input);

    expect(input).toEqual(snapshot);
  });
});

describe('pickPositionOracle', () => {
  const ORACLE_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const ORACLE_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

  const position = (overrides: Partial<Position>): Position =>
    Object.freeze({
      oracleId: ORACLE_A,
      expiryMs: 1_778_673_600_000n,
      strike: 80_000_000_000_000n,
      isUp: true,
      quantity: 5_000_000n,
      ...overrides,
    });

  it('throws when no position matches', () => {
    expect(() => pickPositionOracle([position({ strike: 81_000_000_000_000n })], 80_000_000_000_000n, true)).toThrow(
      /No binary position at strike=80000000000000 direction=up/,
    );
  });

  it('returns the unique match when exactly one position fits', () => {
    const match = position({ oracleId: ORACLE_A });
    const other = position({ strike: 81_000_000_000_000n, oracleId: ORACLE_B });
    expect(pickPositionOracle([other, match], 80_000_000_000_000n, true)).toBe(match);
  });

  it('throws with disambiguation hint when multiple positions match different expiries', () => {
    const earlier = position({ expiryMs: 1_700_000_000_000n, oracleId: ORACLE_A });
    const later = position({ expiryMs: 1_900_000_000_000n, oracleId: ORACLE_B });
    expect(() => pickPositionOracle([earlier, later], 80_000_000_000_000n, true)).toThrow(
      /Multiple positions match.*Pass --oracle/s,
    );
  });

  it('treats UP and DOWN positions at the same strike as distinct', () => {
    const up = position({ isUp: true, oracleId: ORACLE_A });
    const down = position({ isUp: false, oracleId: ORACLE_B });
    expect(pickPositionOracle([up, down], 80_000_000_000_000n, false)).toBe(down);
  });
});
