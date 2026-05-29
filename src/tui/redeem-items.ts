// Pure helpers for the Redeem position picker. No I/O, no React — unit-testable.
import type { Position, RangePosition } from '../lib/manager.js';
import type { RedeemArgs } from '../ptb/redeem.js';
import type { RedeemRangeArgs } from '../ptb/redeemRange.js';
import { formatDecimal } from '../scripts/_cli.js';
import { PRICE_DECIMALS, formatUtc } from './format.js';

/** A redeemable manager position, tagged by market kind. */
export type RedeemItem =
  | Readonly<{ kind: 'binary'; pos: Position }>
  | Readonly<{ kind: 'range'; pos: RangePosition }>;

/**
 * Merge binary and range positions into a single redeemable list: drops
 * zero-quantity entries (nothing to redeem) and orders by nearest expiry so
 * the soonest-to-settle position sits at the top.
 */
export const buildRedeemItems = (
  bin: readonly Position[],
  range: readonly RangePosition[],
): readonly RedeemItem[] => {
  const items: RedeemItem[] = [
    ...bin.filter((p) => p.quantity > 0n).map((pos): RedeemItem => ({ kind: 'binary', pos })),
    ...range.filter((p) => p.quantity > 0n).map((pos): RedeemItem => ({ kind: 'range', pos })),
  ];
  return Object.freeze(
    [...items].sort((a, b) => (a.pos.expiryMs < b.pos.expiryMs ? -1 : a.pos.expiryMs > b.pos.expiryMs ? 1 : 0)),
  );
};

/** One-line `Select` label for a redeemable position. */
export const redeemItemLabel = (item: RedeemItem, quoteDecimals: bigint): string => {
  const qty = formatDecimal(item.pos.quantity, quoteDecimals);
  const exp = formatUtc(item.pos.expiryMs);
  if (item.kind === 'binary') {
    const dir = item.pos.isUp ? 'UP' : 'DOWN';
    return `${dir} strike ${formatDecimal(item.pos.strike, PRICE_DECIMALS)} · qty ${qty} · exp ${exp}`;
  }
  const lo = formatDecimal(item.pos.lowerStrike, PRICE_DECIMALS);
  const hi = formatDecimal(item.pos.higherStrike, PRICE_DECIMALS);
  return `range ${lo}–${hi} · qty ${qty} · exp ${exp}`;
};

/**
 * Validate a parsed redeem quantity against the position size. Returns a
 * user-facing reason when invalid, or null when the quantity is acceptable
 * (`0 < qty <= available`).
 */
export const redeemQtyError = (
  qty: bigint | null,
  available: bigint,
  decimals: bigint,
): string | null => {
  if (qty === null || qty <= 0n) return 'enter a positive quantity';
  if (qty > available) return `max ${formatDecimal(available, decimals)}`;
  return null;
};

/**
 * Settled range payout: a range position pays its full quantity when the
 * oracle's settlement price lands inside `[lower, higher]`, otherwise zero.
 * Returns null while the oracle has no settlement price yet (still Active).
 */
export const settledRangePayout = (
  settlementPrice: bigint | null,
  lower: bigint,
  higher: bigint,
  qty: bigint,
): bigint | null => {
  if (settlementPrice === null) return null;
  return settlementPrice >= lower && settlementPrice <= higher ? qty : 0n;
};

/** A built redeem plan: which PTB builder to call and the args to pass it. */
export type RedeemTxPlan =
  | Readonly<{ kind: 'binary'; args: RedeemArgs }>
  | Readonly<{ kind: 'range'; args: RedeemRangeArgs }>;

/**
 * Map a selected position + quantity into the args for its PTB builder. All
 * market parameters come from the position itself — never retyped by the user.
 */
export const redeemTxPlan = (
  item: RedeemItem,
  quantity: bigint,
  managerId: string,
  coinType: string,
): RedeemTxPlan => {
  if (item.kind === 'binary') {
    return {
      kind: 'binary',
      args: {
        managerId,
        oracleId: item.pos.oracleId,
        expiryMs: item.pos.expiryMs,
        strike: item.pos.strike,
        isUp: item.pos.isUp,
        quantity,
        coinType,
      },
    };
  }
  return {
    kind: 'range',
    args: {
      managerId,
      oracleId: item.pos.oracleId,
      expiryMs: item.pos.expiryMs,
      lower: item.pos.lowerStrike,
      higher: item.pos.higherStrike,
      quantity,
      coinType,
    },
  };
};
