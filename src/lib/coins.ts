import type { Transaction, TransactionObjectArgument } from '@mysten/sui/transactions';

import type { Ctx } from '../client.js';

/**
 * Fetches every coin object of `coinType` owned by `owner`, paginating
 * through the full result set.
 */
export const fetchAllCoins = async (
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

/**
 * Adds merge+split commands to `tx` so that exactly `amount` units of
 * `coinType` are carved off into a fresh transaction argument.
 * Throws if the owner doesn't have enough.
 *
 * Used by deposit, lp-supply, lp-withdraw — three call-sites all
 * doing "find coins, optionally merge into largest, split exact
 * amount, return the split arg".
 */
export const splitFromOwned = async (
  ctx: Ctx,
  tx: Transaction,
  owner: string,
  coinType: string,
  amount: bigint,
): Promise<TransactionObjectArgument> => {
  if (amount <= 0n) throw new Error(`amount must be positive; got ${amount}`);

  const coins = await fetchAllCoins(ctx, owner, coinType);
  if (coins.length === 0) throw new Error(`No ${coinType} coins owned by ${owner}`);
  const total = coins.reduce((sum, c) => sum + BigInt(c.balance), 0n);
  if (total < amount) {
    throw new Error(`Insufficient ${coinType}: have ${total} raw, need ${amount}`);
  }

  const sorted = [...coins].sort((a, b) =>
    BigInt(a.balance) < BigInt(b.balance) ? 1 : BigInt(a.balance) > BigInt(b.balance) ? -1 : 0,
  );
  const primary = sorted[0]!;
  const primaryArg = tx.object(primary.coinObjectId);

  if (BigInt(primary.balance) < amount) {
    const others = sorted.slice(1).map((c) => tx.object(c.coinObjectId));
    tx.mergeCoins(primaryArg, others);
  }

  const [out] = tx.splitCoins(primaryArg, [amount]);
  if (!out) throw new Error('splitCoins returned no result');
  return out;
};
