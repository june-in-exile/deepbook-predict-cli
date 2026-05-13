import { Transaction } from '@mysten/sui/transactions';

import type { Ctx } from '../client.js';

export type LpSupplyArgs = Readonly<{
  amount: bigint;
  sender: string;
  coinType?: string;
}>;

/**
 * Builds the LP-supply PTB:
 *   1. (optional) mergeCoins   — only if more than one coin object owned
 *   2. splitCoins              — exactly `amount`
 *   3. moveCall predict::supply<Quote>(...) -> Coin<PLP>
 *   4. transferObjects [coin]  — recipient
 *
 * The PLP coin MUST be transferred — without (4) the PTB fails with an
 * unused-value error.
 */
export const buildLpSupplyTx = async (ctx: Ctx, args: LpSupplyArgs): Promise<Transaction> => {
  const coinType = args.coinType ?? ctx.config.QUOTE_COIN_TYPE;
  if (args.amount <= 0n) throw new Error(`amount must be positive; got ${args.amount}`);

  const coins = await fetchAllCoins(ctx, args.sender, coinType);
  if (coins.length === 0) throw new Error(`No ${coinType} coins owned by ${args.sender}`);
  const total = coins.reduce((sum, c) => sum + BigInt(c.balance), 0n);
  if (total < args.amount) {
    throw new Error(`Insufficient ${coinType}: have ${total} raw, need ${args.amount}`);
  }
  const sorted = [...coins].sort((a, b) =>
    BigInt(a.balance) < BigInt(b.balance) ? 1 : BigInt(a.balance) > BigInt(b.balance) ? -1 : 0,
  );
  const primary = sorted[0]!;
  const tx = new Transaction();
  const primaryArg = tx.object(primary.coinObjectId);

  if (BigInt(primary.balance) < args.amount) {
    const others = sorted.slice(1).map((c) => tx.object(c.coinObjectId));
    tx.mergeCoins(primaryArg, others);
  }

  const [supplyCoin] = tx.splitCoins(primaryArg, [args.amount]);
  if (!supplyCoin) throw new Error('splitCoins returned no result');

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
