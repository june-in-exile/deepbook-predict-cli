import { SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';

import type { Config } from './config.js';
import { loadConfig } from './config.js';

export type Ctx = Readonly<{
  config: Config;
  client: SuiClient;
}>;

export const createContext = (): Ctx => {
  const config = loadConfig();
  const client = new SuiClient({ url: config.RPC_URL });
  return Object.freeze({ config, client });
};

/**
 * Returns the configured keypair. Throws a clear error if PRIVATE_KEY isn't
 * set — the read-only scripts on Day 3-5 don't need it; signing scripts do.
 */
export const requireKeypair = (cfg: Config): Ed25519Keypair => {
  if (!cfg.PRIVATE_KEY) {
    throw new Error(
      'PRIVATE_KEY is required for this command. Run `sui keytool export --key-identity <address>` and put the suiprivkey1… string in .env.',
    );
  }
  const { schema, secretKey } = decodeSuiPrivateKey(cfg.PRIVATE_KEY);
  if (schema !== 'ED25519') {
    throw new Error(`Unsupported key schema "${schema}"; only ED25519 is wired up.`);
  }
  return Ed25519Keypair.fromSecretKey(secretKey);
};
