import { Transaction } from '@mysten/sui/transactions';

import type { Ctx } from '../client.js';

export type RedeemRangeArgs = Readonly<{
  oracleId: string;
  expiryMs: bigint;
  lower: bigint;
  higher: bigint;
  quantity: bigint;
  /** Quote coin type. Resolved from accepted_quotes via resolveQuote(). */
  coinType: string;
}>;

/**
 * Builds the redeem-range PTB:
 *   1. range_key::new(oracle, expiry, lower, higher) -> RangeKey
 *   2. predict::redeem_range<Quote>   (no return; payout deposited back into manager)
 *
 * Two execution paths inside the protocol (transparent to caller):
 *   - oracle Settled  + snapshot present: payout = (lower <= settle <= higher) ? qty : 0
 *   - oracle Active   + fresh:            payout = current live SVI bid for the range
 *
 * Pending or stale oracles abort inside assert_quoteable_oracle.
 */
export const buildRedeemRangeTx = (ctx: Ctx, args: RedeemRangeArgs): Transaction => {
  if (args.quantity <= 0n) throw new Error(`quantity must be positive; got ${args.quantity}`);
  if (args.lower <= 0n) throw new Error(`lower must be positive; got ${args.lower}`);
  if (args.higher <= args.lower) {
    throw new Error(`higher must be > lower; got lower=${args.lower} higher=${args.higher}`);
  }

  const pkg = ctx.config.PACKAGE_ID;
  const tx = new Transaction();

  const [key] = tx.moveCall({
    target: `${pkg}::range_key::new`,
    arguments: [
      tx.pure.id(args.oracleId),
      tx.pure.u64(args.expiryMs),
      tx.pure.u64(args.lower),
      tx.pure.u64(args.higher),
    ],
  });
  if (!key) throw new Error('range_key constructor returned no result');

  tx.moveCall({
    target: `${pkg}::predict::redeem_range`,
    typeArguments: [args.coinType],
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
