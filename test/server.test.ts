import { describe, expect, it } from 'vitest';
import { findActiveOracles, type OracleEntry } from '../src/lib/server.js';

const baseEntry: OracleEntry = {
  predict_id: '0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a',
  oracle_id: '0x3d7033b21ac61a9cf5c5f0a442164da0375fae8b9b55b7c105d2be599bcc1b7b',
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

describe('findActiveOracles', () => {
  it('keeps active oracles with future expiry', () => {
    const got = findActiveOracles([make()], { now: 1_778_660_000_000 });
    expect(got).toHaveLength(1);
  });

  it('drops oracles whose expiry already passed even if status is still active', () => {
    const got = findActiveOracles([make()], { now: 1_778_700_000_000 });
    expect(got).toHaveLength(0);
  });

  it('drops oracles with a non-null settlement_price', () => {
    const got = findActiveOracles([make({ settlement_price: 80_000_000_000_000 })], {
      now: 1_778_660_000_000,
    });
    expect(got).toHaveLength(0);
  });

  it('filters by underlying when asked', () => {
    const list = [make({ underlying_asset: 'BTC' }), make({ underlying_asset: 'ETH' })];
    const got = findActiveOracles(list, { now: 1_778_660_000_000, underlyingAsset: 'ETH' });
    expect(got).toHaveLength(1);
    expect(got[0]?.underlying_asset).toBe('ETH');
  });

  it('returns empty list when given empty input', () => {
    expect(findActiveOracles([], { now: 1_778_660_000_000 })).toHaveLength(0);
  });
});
