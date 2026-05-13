import { Transaction } from '@mysten/sui/transactions';

import type { Ctx } from '../client.js';
import { splitFromOwned } from '../lib/coins.js';

export type LpWithdrawArgs = Readonly<{
  shares: bigint;
  sender: string;
  coinType?: string;
}>;

export const buildLpWithdrawTx = async (ctx: Ctx, args: LpWithdrawArgs): Promise<Transaction> => {
  const quoteType = args.coinType ?? ctx.config.QUOTE_COIN_TYPE;
  const plpType = `${ctx.config.PACKAGE_ID}::plp::PLP`;
  if (args.shares <= 0n) throw new Error(`shares must be positive; got ${args.shares}`);

  const tx = new Transaction();
  const burnCoin = await splitFromOwned(ctx, tx, args.sender, plpType, args.shares);

  const [quoteCoin] = tx.moveCall({
    target: `${ctx.config.PACKAGE_ID}::predict::withdraw`,
    typeArguments: [quoteType],
    arguments: [
      tx.object(ctx.config.PREDICT_OBJECT_ID),
      burnCoin,
      tx.object('0x6'),
    ],
  });
  if (!quoteCoin) throw new Error('predict::withdraw produced no Quote coin');

  tx.transferObjects([quoteCoin], tx.pure.address(args.sender));
  return tx;
};
