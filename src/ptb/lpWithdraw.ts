import { Transaction } from '@mysten/sui/transactions';

import type { Ctx } from '../client.js';

export type LpWithdrawArgs = Readonly<{
  /** Shares (PLP raw units) to burn. */
  shares: bigint;
  /** Sender — must own the PLP coins. */
  sender: string;
  /** Quote coin type to receive. Defaults to `ctx.config.QUOTE_COIN_TYPE`. */
  coinType?: string;
}>;

/**
 * Builds the LP-withdraw PTB:
 *   1. (optional) mergeCoins<PLP>   — only if more than one PLP coin
 *   2. splitCoins<PLP>              — exact `shares`
 *   3. moveCall predict::withdraw<Quote>(...) -> Coin<Quote>
 *   4. transferObjects [Quote coin] — recipient
 */
export const buildLpWithdrawTx = async (ctx: Ctx, args: LpWithdrawArgs): Promise<Transaction> => {
  const quoteType = args.coinType ?? ctx.config.QUOTE_COIN_TYPE;
  const plpType = `${ctx.config.PACKAGE_ID}::plp::PLP`;
  if (args.shares <= 0n) throw new Error(`shares must be positive; got ${args.shares}`);

  const plpCoins = await fetchAllCoins(ctx, args.sender, plpType);
  if (plpCoins.length === 0) throw new Error(`No ${plpType} coins owned by ${args.sender}`);
  const total = plpCoins.reduce((sum, c) => sum + BigInt(c.balance), 0n);
  if (total < args.shares) {
    throw new Error(`Insufficient PLP: have ${total} raw, need ${args.shares}`);
  }
  const sorted = [...plpCoins].sort((a, b) =>
    BigInt(a.balance) < BigInt(b.balance) ? 1 : BigInt(a.balance) > BigInt(b.balance) ? -1 : 0,
  );
  const primary = sorted[0]!;
  const tx = new Transaction();
  const primaryArg = tx.object(primary.coinObjectId);

  if (BigInt(primary.balance) < args.shares) {
    const others = sorted.slice(1).map((c) => tx.object(c.coinObjectId));
    tx.mergeCoins(primaryArg, others);
  }

  const [burnCoin] = tx.splitCoins(primaryArg, [args.shares]);
  if (!burnCoin) throw new Error('splitCoins returned no result');

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

const fetchAllCoins = async (
  ctx: Ctx,
  owner: string,
  coinType: string,
): Promise<readonly { coinObjectId: string; balance: string }[]> => {
  const out: { coinObjectId: string; balance: string }[] = [];
  let cursor: string | null | undefined = undefined;
  do {
    const page = await ctx.client.getCoins({ owner, coinType, cursor: cursor ?? null });
    for (const c of page.data) out.push({ coinObjectId: c.coinObjectId, balance: c.balance });
    cursor = page.hasNextPage ? page.nextCursor : undefined;
  } while (cursor);
  return out;
};
