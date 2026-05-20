import { Transaction } from '@mysten/sui/transactions';

import type { Ctx } from '../client.js';

export type MintRangeArgs = Readonly<{
  /** Target PredictManager id (auto-resolved from sender's owned objects). */
  managerId: string;
  /** ID of the OracleSVI shared object being traded against. */
  oracleId: string;
  /** Expiry timestamp in ms. Must equal the oracle's expiry field — the
   *  protocol's `assert_key_matches` will revert otherwise. */
  expiryMs: bigint;
  /** Lower strike, 1e9-scaled (e.g. $80_000 → 80_000_000_000_000n). */
  lower: bigint;
  /** Higher strike, 1e9-scaled. Must be strictly greater than `lower`. */
  higher: bigint;
  /** Position quantity in quote-decimals (1e6 for DUSDC). Doubles as max payout. */
  quantity: bigint;
  /** Quote coin type. Resolved from accepted_quotes via resolveQuote(). */
  coinType: string;
}>;

/**
 * Builds the mint-range PTB. Two move calls:
 *   1. range_key::new(oracle, expiry, lower, higher)  -> RangeKey
 *   2. predict::mint_range<Quote>                     -> (no return)
 *
 * Premium is auto-pulled from the PredictManager's balance via the
 * internal `manager.withdraw<Quote>(cost, ctx)` call inside mint_range.
 */
export const buildMintRangeTx = (ctx: Ctx, args: MintRangeArgs): Transaction => {
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
    target: `${pkg}::predict::mint_range`,
    typeArguments: [args.coinType],
    arguments: [
      tx.object(ctx.predictObjectId),
      tx.object(args.managerId),
      tx.object(args.oracleId),
      key,
      tx.pure.u64(args.quantity),
      tx.object('0x6'), // Clock
    ],
  });

  return tx;
};

/**
 * Builds a parallel PTB that calls `predict::get_range_trade_amounts(...)` —
 * a pure view that returns `(mint_cost, redeem_payout)` for previewing the
 * trade before signing.
 */
export const buildRangeTradeAmountsPreviewTx = (
  ctx: Ctx,
  args: Pick<MintRangeArgs, 'oracleId' | 'expiryMs' | 'lower' | 'higher' | 'quantity'>,
): Transaction => {
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
    target: `${pkg}::predict::get_range_trade_amounts`,
    arguments: [
      tx.object(ctx.predictObjectId),
      tx.object(args.oracleId),
      key,
      tx.pure.u64(args.quantity),
      tx.object('0x6'),
    ],
  });

  return tx;
};
