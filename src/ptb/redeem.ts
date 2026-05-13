import { Transaction } from '@mysten/sui/transactions';

import type { Ctx } from '../client.js';

export type RedeemArgs = Readonly<{
  oracleId: string;
  expiryMs: bigint;
  strike: bigint;
  isUp: boolean;
  quantity: bigint;
  coinType?: string;
}>;

/**
 * Builds the redeem PTB:
 *   1. market_key::up|down  -> MarketKey
 *   2. predict::redeem<Quote>   (no return; payout deposited back into manager)
 *
 * Two execution paths inside the protocol (transparent to caller):
 *   - oracle Settled  + snapshot present: payout = settlement-price bid
 *   - oracle Active + fresh:               payout = current live SVI bid
 *
 * Pending or stale oracles abort inside assert_quoteable_oracle.
 */
export const buildRedeemTx = (ctx: Ctx, args: RedeemArgs): Transaction => {
  const coinType = args.coinType ?? ctx.config.QUOTE_COIN_TYPE;
  if (args.quantity <= 0n) throw new Error(`quantity must be positive; got ${args.quantity}`);
  if (args.strike <= 0n) throw new Error(`strike must be positive; got ${args.strike}`);

  const pkg = ctx.config.PACKAGE_ID;
  const tx = new Transaction();

  const [key] = tx.moveCall({
    target: `${pkg}::market_key::${args.isUp ? 'up' : 'down'}`,
    arguments: [
      tx.pure.id(args.oracleId),
      tx.pure.u64(args.expiryMs),
      tx.pure.u64(args.strike),
    ],
  });
  if (!key) throw new Error('market_key constructor returned no result');

  tx.moveCall({
    target: `${pkg}::predict::redeem`,
    typeArguments: [coinType],
    arguments: [
      tx.object(ctx.config.PREDICT_OBJECT_ID),
      tx.object(ctx.config.MANAGER_OBJECT_ID),
      tx.object(args.oracleId),
      key,
      tx.pure.u64(args.quantity),
      tx.object('0x6'),
    ],
  });

  return tx;
};
