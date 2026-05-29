import type { Ctx } from '../client.js';
import type { OracleState } from '../lib/oracle.js';
import { decodeU64LittleEndian, devInspectReturnValues } from '../lib/view.js';
import { buildTradeAmountsPreviewTx } from '../ptb/mintBinary.js';
import { buildRangeTradeAmountsPreviewTx } from '../ptb/mintRange.js';

export type TradeAmounts = Readonly<{ cost: bigint; payout: bigint }>;

/** devInspect predict::get_trade_amounts for a binary market. Throws on failure. */
export const previewBinary = async (
  ctx: Ctx,
  sender: string,
  oracle: OracleState,
  strike: bigint,
  qty: bigint,
  isUp: boolean,
): Promise<TradeAmounts> => {
  const tx = buildTradeAmountsPreviewTx(ctx, { oracleId: oracle.id, expiryMs: oracle.expiryMs, strike, isUp, quantity: qty });
  const [cost, payout] = await devInspectReturnValues(ctx, tx, sender);
  if (!cost || !payout) throw new Error('get_trade_amounts returned < 2 values');
  return { cost: decodeU64LittleEndian(cost), payout: decodeU64LittleEndian(payout) };
};

/** Same, but ignores failures (returns null) — used in side-by-side tables. */
export const previewBinarySafe = async (
  ctx: Ctx,
  sender: string,
  oracle: OracleState,
  strike: bigint,
  qty: bigint,
  isUp: boolean,
): Promise<TradeAmounts | null> => {
  try {
    return await previewBinary(ctx, sender, oracle, strike, qty, isUp);
  } catch {
    return null;
  }
};

/** devInspect predict::get_range_trade_amounts. Throws on failure. */
export const previewRange = async (
  ctx: Ctx,
  sender: string,
  oracle: OracleState,
  lower: bigint,
  higher: bigint,
  qty: bigint,
): Promise<TradeAmounts> => {
  const tx = buildRangeTradeAmountsPreviewTx(ctx, { oracleId: oracle.id, expiryMs: oracle.expiryMs, lower, higher, quantity: qty });
  const [cost, payout] = await devInspectReturnValues(ctx, tx, sender);
  if (!cost || !payout) throw new Error('get_range_trade_amounts returned < 2 values');
  return { cost: decodeU64LittleEndian(cost), payout: decodeU64LittleEndian(payout) };
};

export const previewRangeSafe = async (
  ctx: Ctx,
  sender: string,
  oracle: OracleState,
  lower: bigint,
  higher: bigint,
  qty: bigint,
): Promise<TradeAmounts | null> => {
  try {
    return await previewRange(ctx, sender, oracle, lower, higher, qty);
  } catch {
    return null;
  }
};
