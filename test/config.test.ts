import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const VALID = Object.freeze({
  RPC_URL: 'https://fullnode.testnet.sui.io:443',
  SERVER_URL: 'https://predict-server.testnet.mystenlabs.com',
  PACKAGE_ID: '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138',
});

describe('loadConfig', () => {
  let original: NodeJS.ProcessEnv;

  beforeEach(() => {
    original = { ...process.env };
    // Strip every key the loader might pick up so each test starts clean.
    for (const k of Object.keys(VALID)) delete process.env[k];
    delete process.env.PRIVATE_KEY;
  });
  afterEach(() => {
    process.env = original;
  });

  it('returns a frozen config when every required var is present', () => {
    Object.assign(process.env, VALID);
    const cfg = loadConfig();
    expect(cfg.PACKAGE_ID).toBe(VALID.PACKAGE_ID);
    expect(cfg.PRIVATE_KEY).toBeUndefined();
    expect(Object.isFrozen(cfg)).toBe(true);
  });

  it('throws with a readable message when a required var is missing', () => {
    const { PACKAGE_ID: _omit, ...partial } = VALID;
    Object.assign(process.env, partial);
    expect(() => loadConfig()).toThrowError(/PACKAGE_ID/);
  });

  it('rejects a malformed object id (no 0x prefix)', () => {
    Object.assign(process.env, VALID, {
      PACKAGE_ID: 'f5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138',
    });
    expect(() => loadConfig()).toThrowError(/PACKAGE_ID/);
  });

  it('keeps PRIVATE_KEY optional but propagates it when present', () => {
    Object.assign(process.env, VALID, {
      PRIVATE_KEY: 'suiprivkey1qzfaketestkeyxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    });
    const cfg = loadConfig();
    expect(cfg.PRIVATE_KEY).toMatch(/^suiprivkey1/);
  });

  it('rejects a PRIVATE_KEY that is not in suiprivkey1 form', () => {
    Object.assign(process.env, VALID, { PRIVATE_KEY: '0xdeadbeef' });
    expect(() => loadConfig()).toThrowError(/PRIVATE_KEY/);
  });
});
