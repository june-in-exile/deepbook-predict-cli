import { describe, expect, it } from 'vitest';

import { resolveOracleId } from '../src/scripts/_resolve-oracle.js';
import type { OracleEntry } from '../src/lib/server.js';

const ENV_ID = '0x990e6e4ac4439590e20d818fb5daa8d3e61c4e64b0827f14e8f1d0a263d8e5ca';
const NEW_ID = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const EARLIER_ID = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const LATER_ID = '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

const baseEntry: OracleEntry = {
  predict_id: '0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a',
  oracle_id: NEW_ID,
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

describe('resolveOracleId', () => {
  it('falls back to env ID and warns when no active oracle is available', () => {
    const result = resolveOracleId({ envOracleId: ENV_ID, activeOracles: [] });

    expect(result.oracleId).toBe(ENV_ID);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/no active oracle/i);
  });

  it('uses the indexer ID silently when it matches the env value', () => {
    const result = resolveOracleId({
      envOracleId: ENV_ID,
      activeOracles: [make({ oracle_id: ENV_ID })],
    });

    expect(result.oracleId).toBe(ENV_ID);
    expect(result.warnings).toEqual([]);
  });

  it('uses the indexer ID and hints to update env when they differ', () => {
    const result = resolveOracleId({
      envOracleId: ENV_ID,
      activeOracles: [make({ oracle_id: NEW_ID })],
    });

    expect(result.oracleId).toBe(NEW_ID);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(NEW_ID);
    expect(result.warnings[0]).toMatch(/ORACLE_OBJECT_ID/);
  });

  it('picks the earliest-expiring oracle when multiple are active', () => {
    const result = resolveOracleId({
      envOracleId: ENV_ID,
      activeOracles: [
        make({ oracle_id: LATER_ID, expiry: 2_000_000_000_000 }),
        make({ oracle_id: EARLIER_ID, expiry: 1_500_000_000_000 }),
      ],
    });

    expect(result.oracleId).toBe(EARLIER_ID);
  });

  it('does not mutate the input oracle list when sorting', () => {
    const input = [
      make({ oracle_id: LATER_ID, expiry: 2_000_000_000_000 }),
      make({ oracle_id: EARLIER_ID, expiry: 1_500_000_000_000 }),
    ];
    const snapshot = [...input];

    resolveOracleId({ envOracleId: ENV_ID, activeOracles: input });

    expect(input).toEqual(snapshot);
  });
});
