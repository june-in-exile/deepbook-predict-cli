import { Transaction } from '@mysten/sui/transactions';

import type { Ctx } from '../client.js';
import { splitFromOwned } from '../lib/coins.js';

export type LpSupplyArgs = Readonly<{
  amount: bigint;
  sender: string;
  coinType?: string;
}>;

export const buildLpSupplyTx = async (ctx: Ctx, args: LpSupplyArgs): Promise<Transaction> => {
  const coinType = args.coinType ?? ctx.config.QUOTE_COIN_TYPE;
  if (args.amount <= 0n) throw new Error(`amount must be positive; got ${args.amount}`);

  const tx = new Transaction();
  const supplyCoin = await splitFromOwned(ctx, tx, args.sender, coinType, args.amount);

  const [plpCoin] = tx.moveCall({
    target: `${ctx.config.PACKAGE_ID}::predict::supply`,
    typeArguments: [coinType],
    arguments: [
      tx.object(ctx.config.PREDICT_OBJECT_ID),
      supplyCoin,
      tx.object('0x6'),
    ],
  });
  if (!plpCoin) throw new Error('predict::supply produced no PLP coin');

  tx.transferObjects([plpCoin], tx.pure.address(args.sender));
  return tx;
};
