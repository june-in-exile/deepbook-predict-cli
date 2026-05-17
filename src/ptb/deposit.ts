import { Transaction } from '@mysten/sui/transactions';

import type { Ctx } from '../client.js';
import { splitFromOwned } from '../lib/coins.js';

export type DepositArgs = Readonly<{
  /** Amount in raw on-chain units (e.g. 100 DUSDC = 100_000_000n). */
  amount: bigint;
  /** Address that will sign the transaction; must own the source coins. */
  sender: string;
  /** Coin type to deposit. Resolved from accepted_quotes via resolveQuote(). */
  coinType: string;
}>;

/**
 * Builds (but does not execute) a PTB that splits `amount` off the sender's
 * `coinType` coins and deposits it into the PredictManager.
 */
export const buildDepositTx = async (ctx: Ctx, args: DepositArgs): Promise<Transaction> => {
  const coinType = args.coinType;
  if (args.amount <= 0n) throw new Error(`deposit amount must be positive; got ${args.amount}`);

  const tx = new Transaction();
  const depositCoin = await splitFromOwned(ctx, tx, args.sender, coinType, args.amount);

  tx.moveCall({
    target: `${ctx.config.PACKAGE_ID}::predict_manager::deposit`,
    typeArguments: [coinType],
    arguments: [tx.object(ctx.config.MANAGER_OBJECT_ID), depositCoin],
  });

  return tx;
};
