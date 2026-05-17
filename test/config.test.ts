import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const VALID = Object.freeze({
  RPC_URL: 'https://fullnode.testnet.sui.io:443',
  SERVER_URL: 'https://predict-server.testnet.mystenlabs.com',
  PACKAGE_ID: '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138',
  PREDICT_OBJECT_ID: '0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a',
  PREDICT_REGISTRY_ID: '0x43af14fed5480c20ff77e2263d5f794c35b9fab7e2212903127062f4fe2a6e64',
  MANAGER_OBJECT_ID: '0xe55ea85bcf29d5cbea28e29cfaf6c3ecc58f461053aa06b4436b950e98608a3d',
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
      PREDICT_OBJECT_ID: 'c8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a',
    });
    expect(() => loadConfig()).toThrowError(/PREDICT_OBJECT_ID/);
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
