import { Transaction } from '@mysten/sui/transactions';

import type { Ctx } from '../client.js';

export type MintBinaryArgs = Readonly<{
  /** Target PredictManager id (auto-resolved from sender's owned objects). */
  managerId: string;
  /** ID of the OracleSVI shared object being traded against. */
  oracleId: string;
  /** Expiry timestamp in ms. Must equal the oracle's expiry field — the
   *  protocol's `assert_key_matches` will revert otherwise. */
  expiryMs: bigint;
  /** Strike price, 1e9-scaled (e.g. $80_000 → 80_000_000_000_000n). */
  strike: bigint;
  /** Direction: true = UP (price > strike at expiry); false = DOWN. */
  isUp: boolean;
  /** Position quantity in 1e6 raw units. Doubles as max payout. */
  quantity: bigint;
  /** Quote coin type. Resolved from accepted_quotes via resolveQuote(). */
  coinType: string;
}>;

/**
 * Builds the mint-binary PTB. Two move calls:
 *   1. market_key::up | market_key::down  -> MarketKey
 *   2. predict::mint<Quote>               -> (no return)
 *
 * No Coin argument: premium is auto-pulled from the PredictManager's
 * balance via the internal `manager.withdraw<Quote>(cost, ctx)` call.
 */
export const buildMintBinaryTx = (ctx: Ctx, args: MintBinaryArgs): Transaction => {
  const coinType = args.coinType;
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
    target: `${pkg}::predict::mint`,
    typeArguments: [coinType],
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
 * Builds a parallel PTB that calls `predict::get_trade_amounts(...)` —
 * a pure view that returns `(mint_cost, redeem_payout)` for previewing
 * the trade before signing.
 */
export const buildTradeAmountsPreviewTx = (
  ctx: Ctx,
  args: Pick<MintBinaryArgs, 'oracleId' | 'expiryMs' | 'strike' | 'isUp' | 'quantity'>,
): Transaction => {
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
    target: `${pkg}::predict::get_trade_amounts`,
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
