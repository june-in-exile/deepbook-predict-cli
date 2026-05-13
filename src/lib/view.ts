import type { Transaction } from '@mysten/sui/transactions';

import type { Ctx } from '../client.js';

/**
 * Runs a built Transaction through devInspect and returns the raw return
 * values of the last MoveCall as little-endian byte arrays. Each
 * `bigint` decode uses `decodeU64LittleEndian` below.
 *
 * Caller-supplied `sender` is required because devInspect needs one,
 * but no signing happens — the sender just has to exist as an address.
 */
export const devInspectReturnValues = async (
  ctx: Ctx,
  tx: Transaction,
  sender: string,
): Promise<readonly Uint8Array[]> => {
  const res = await ctx.client.devInspectTransactionBlock({
    transactionBlock: tx,
    sender,
  });
  if (res.effects.status.status !== 'success') {
    throw new Error(
      `devInspect failed: ${res.effects.status.error ?? 'unknown'}`,
    );
  }
  const last = res.results?.[res.results.length - 1];
  const rvs = last?.returnValues ?? [];
  return rvs.map(([bytes]) => Uint8Array.from(bytes));
};

export const decodeU64LittleEndian = (bytes: Uint8Array): bigint => {
  let n = 0n;
  for (let i = 0; i < bytes.length; i += 1) {
    n += BigInt(bytes[i] ?? 0) << BigInt(i * 8);
  }
  return n;
};
