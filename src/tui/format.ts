// Pure display helpers shared across TUI screens. No I/O, no React — unit-testable.
import { formatDecimal } from '../scripts/_cli.js';

/** Strike / spot / forward / settlement prices are all 1e9-scaled on-chain. */
export const PRICE_DECIMALS = 9n;
/** PLP coin decimals are fixed by the protocol at 6. */
export const PLP_DECIMALS = 6n;
/** SUI gas coin decimals. */
export const SUI_DECIMALS = 9n;

/** Abbreviate a 0x object id to `0x1234…cdef` for compact display. */
export const shortId = (id: string, head = 6, tail = 4): string => {
  if (!id.startsWith('0x') || id.length <= 2 + head + tail) return id;
  return `${id.slice(0, 2 + head)}…${id.slice(-tail)}`;
};

/**
 * Human "time to expiry" relative to `now` (ms). Positive → "12.4h",
 * already-passed → "12.4h ago". Switches to days past ~48h for readability.
 */
export const formatTimeToExpiry = (expiryMs: number, now: number): string => {
  const diffH = (expiryMs - now) / 3_600_000;
  const abs = Math.abs(diffH);
  const unit = abs >= 48 ? `${(abs / 24).toFixed(1)}d` : `${abs.toFixed(1)}h`;
  return diffH >= 0 ? unit : `${unit} ago`;
};

/** ISO timestamp trimmed of the millisecond ".000". */
export const formatUtc = (ms: number | bigint): string =>
  new Date(Number(ms)).toISOString().replace('.000Z', 'Z');

/** Indexer status string, but show "settled" once a settlement price exists. */
export const oracleStatusLabel = (status: string, settlementPrice: number | null): string =>
  settlementPrice !== null ? 'settled' : status;

/** Convert a 1e6-scaled cost into a 1e9-scaled per-$1-contract price. */
export const perUnitE9 = (costE6: bigint, qtyE6: bigint): bigint =>
  qtyE6 > 0n ? (costE6 * 1_000_000_000n) / qtyE6 : 0n;

/** Format a 1e9-scaled price for table cells, right-padded to `width`. */
export const fmtPriceCell = (v: bigint | null, width = 8): string =>
  v === null ? '—'.padStart(width) : formatDecimal(v, PRICE_DECIMALS).padStart(width);
