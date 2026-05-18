import type { Ctx } from '../client.js';
import type { Position, RangePosition } from './manager.js';
import { getOracle, type OracleState } from './oracle.js';
import { findActiveOracles, listOracles, type OracleEntry } from './server.js';

/**
 * Pure: pick the earliest-expiring oracle from a pre-filtered active set.
 *
 * Throws when the set is empty — callers cannot proceed without an active
 * oracle and should not silently fall back to a stale value. Callers that
 * want a specific (possibly Settled) oracle must look it up by id directly.
 *
 * Does not mutate the input array.
 */
export const pickActiveOracle = (actives: readonly OracleEntry[]): OracleEntry => {
  if (actives.length === 0) {
    throw new Error(
      'No active oracle in indexer. Pass --oracle <id> explicitly, or run `npm run markets` to inspect current oracle state.',
    );
  }
  return [...actives].sort((a, b) => a.expiry - b.expiry)[0]!;
};

/**
 * Pure: find the unique manager-side binary position matching (strike, isUp).
 *
 * Each Position records its source oracle id directly, so this also tells the
 * caller which oracle to load. Throws when zero or multiple matches exist —
 * callers must disambiguate explicitly (via --oracle) rather than guess.
 */
export const pickPositionOracle = (
  positions: readonly Position[],
  strike: bigint,
  isUp: boolean,
): Position => {
  const dir = isUp ? 'up' : 'down';
  const matches = positions.filter((p) => p.strike === strike && p.isUp === isUp);
  if (matches.length === 0) {
    throw new Error(
      `No binary position at strike=${strike} direction=${dir}. Run \`npm run inspect\` to list your positions.`,
    );
  }
  if (matches.length > 1) {
    const lines = matches
      .map(
        (p) =>
          `  expiry=${new Date(Number(p.expiryMs)).toISOString()} oracle=${p.oracleId} qty=${p.quantity}`,
      )
      .join('\n');
    throw new Error(
      `Multiple positions match strike=${strike} direction=${dir}:\n${lines}\nPass --oracle <id> to disambiguate.`,
    );
  }
  return matches[0]!;
};

/**
 * Pure: find the unique manager-side range position matching (lower, higher).
 *
 * Each RangePosition records its source oracle id directly, so this also tells
 * the caller which oracle to load. Throws when zero or multiple matches exist —
 * callers must disambiguate explicitly (via --oracle) rather than guess.
 */
export const pickRangePositionOracle = (
  positions: readonly RangePosition[],
  lower: bigint,
  higher: bigint,
): RangePosition => {
  const matches = positions.filter(
    (p) => p.lowerStrike === lower && p.higherStrike === higher,
  );
  if (matches.length === 0) {
    throw new Error(
      `No range position at lower=${lower} higher=${higher}. Run \`npm run inspect\` to list your positions.`,
    );
  }
  if (matches.length > 1) {
    const lines = matches
      .map(
        (p) =>
          `  expiry=${new Date(Number(p.expiryMs)).toISOString()} oracle=${p.oracleId} qty=${p.quantity}`,
      )
      .join('\n');
    throw new Error(
      `Multiple range positions match lower=${lower} higher=${higher}:\n${lines}\nPass --oracle <id> to disambiguate.`,
    );
  }
  return matches[0]!;
};

/**
 * IO wrapper used by scripts that need an Active oracle. Explicit
 * `oracleFlag` wins (no indexer hit). Otherwise consult the indexer's active
 * set and pick the next one to settle. No env fallback — indexer is the
 * single source of truth, and the call fails loudly if the indexer is
 * unreachable or has no active oracle.
 */
export const resolveOracle = async (
  ctx: Ctx,
  oracleFlag?: string,
): Promise<OracleState> => {
  if (oracleFlag) return getOracle(ctx, oracleFlag);
  const allOracles = await listOracles(ctx);
  const pick = pickActiveOracle(findActiveOracles(allOracles));
  return getOracle(ctx, pick.oracle_id);
};
