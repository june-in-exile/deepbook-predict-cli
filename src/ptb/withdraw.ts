import { Transaction } from '@mysten/sui/transactions';

import type { Ctx } from '../client.js';

export type WithdrawArgs = Readonly<{
  /** Amount in raw on-chain units (e.g. 100 DUSDC = 100_000_000n). */
  amount: bigint;
  /** Address that will sign and receive the withdrawn coins. */
  recipient: string;
  /** Coin type to withdraw. Defaults to `ctx.config.QUOTE_COIN_TYPE`. */
  coinType?: string;
}>;

/**
 * Builds (but does not execute) a PTB that withdraws `amount` from the
 * PredictManager and transfers it to `recipient`.
 *
 *   1. moveCall predict_manager::withdraw<Quote>  -> returns Coin<Quote>
 *   2. transferObjects [coin]                      -> recipient
 */
export const buildWithdrawTx = (ctx: Ctx, args: WithdrawArgs): Transaction => {
  const coinType = args.coinType ?? ctx.config.QUOTE_COIN_TYPE;
  if (args.amount <= 0n) {
    throw new Error(`withdraw amount must be positive; got ${args.amount}`);
  }

  const tx = new Transaction();
  const [coin] = tx.moveCall({
    target: `${ctx.config.PACKAGE_ID}::predict_manager::withdraw`,
    typeArguments: [coinType],
    arguments: [tx.object(ctx.config.MANAGER_OBJECT_ID), tx.pure.u64(args.amount)],
  });
  if (!coin) throw new Error('predict_manager::withdraw produced no Coin result');
  tx.transferObjects([coin], tx.pure.address(args.recipient));

  return tx;
};
