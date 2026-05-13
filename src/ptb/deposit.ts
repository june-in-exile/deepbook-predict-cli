import { Transaction } from '@mysten/sui/transactions';

import type { Ctx } from '../client.js';

export type DepositArgs = Readonly<{
  /** Amount in raw on-chain units (e.g. 100 DUSDC = 100_000_000n). */
  amount: bigint;
  /** Address that will sign the transaction; must own the source coins. */
  sender: string;
  /** Coin type to deposit. Defaults to `ctx.config.QUOTE_COIN_TYPE`. */
  coinType?: string;
}>;

/**
 * Builds (but does not execute) a PTB that splits `amount` off the sender's
 * `coinType` coins and deposits it into the PredictManager.
 *
 * The PTB executes one or two commands:
 *   1. (optional) mergeCoins  — only if more than one coin object is owned
 *   2. splitCoins             — carve out exactly `amount`
 *   3. moveCall predict_manager::deposit
 */
export const buildDepositTx = async (ctx: Ctx, args: DepositArgs): Promise<Transaction> => {
  const coinType = args.coinType ?? ctx.config.QUOTE_COIN_TYPE;
  if (args.amount <= 0n) {
    throw new Error(`deposit amount must be positive; got ${args.amount}`);
  }

  const coins = await fetchAllCoins(ctx, args.sender, coinType);
  if (coins.length === 0) {
    throw new Error(`No ${coinType} coins owned by ${args.sender}`);
  }
  const total = coins.reduce((sum, c) => sum + BigInt(c.balance), 0n);
  if (total < args.amount) {
    throw new Error(
      `Insufficient ${coinType}: have ${total} raw units, need ${args.amount}`,
    );
  }

  const sorted = [...coins].sort((a, b) => compareDesc(BigInt(a.balance), BigInt(b.balance)));
  const primary = sorted[0]!;
  const tx = new Transaction();
  const primaryArg = tx.object(primary.coinObjectId);

  if (BigInt(primary.balance) < args.amount) {
    const others = sorted.slice(1).map((c) => tx.object(c.coinObjectId));
    tx.mergeCoins(primaryArg, others);
  }

  const [depositCoin] = tx.splitCoins(primaryArg, [args.amount]);
  if (!depositCoin) {
    throw new Error('splitCoins returned no result — this should not happen');
  }

  tx.moveCall({
    target: `${ctx.config.PACKAGE_ID}::predict_manager::deposit`,
    typeArguments: [coinType],
    arguments: [tx.object(ctx.config.MANAGER_OBJECT_ID), depositCoin],
  });

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

const compareDesc = (a: bigint, b: bigint): number => (a < b ? 1 : a > b ? -1 : 0);
