import type { Ctx } from '../client.js';
import { getOracle, type OracleState } from './oracle.js';
import { findActiveOracles, listOracles, type OracleEntry } from './server.js';

export interface ResolveOracleInput {
  readonly envOracleId: string;
  readonly activeOracles: readonly OracleEntry[];
}

export interface ResolveOracleResult {
  readonly oracleId: string;
  readonly warnings: readonly string[];
}

/**
 * Pure decision: given the env-configured oracle ID and the indexer's current
 * active set, choose which oracle ID to use, plus any user-visible warnings
 * the caller should emit to stderr.
 *
 * Behavior (the spec the tests lock in):
 *   - Empty active set      → use env ID + warn "no active oracle…".
 *   - Indexer pick == env   → use env ID, silent.
 *   - Indexer pick != env   → use indexer pick + hint "update ORACLE_OBJECT_ID".
 *   - Multiple actives      → pick the earliest-expiring one (next to settle).
 *
 * No I/O, no Date.now(), no mutation of `activeOracles`. The caller already
 * filtered via findActiveOracles() — this function trusts that.
 */
export const resolveOracleId = ({
  envOracleId,
  activeOracles,
}: ResolveOracleInput): ResolveOracleResult => {
  if (activeOracles.length === 0) {
    return {
      oracleId: envOracleId,
      warnings: [`⚠ no active oracle in indexer — showing stale ORACLE_OBJECT_ID from .env (${envOracleId})`],
    };
  }
  const pick = [...activeOracles].sort((a, b) => a.expiry - b.expiry)[0]!;
  if (pick.oracle_id === envOracleId) {
    return { oracleId: envOracleId, warnings: [] };
  }
  return {
    oracleId: pick.oracle_id,
    warnings: [`💡 indexer shows newer active oracle ${pick.oracle_id} — consider updating ORACLE_OBJECT_ID in .env`],
  };
};

/**
 * IO wrapper used by every script that needs an oracle. Explicit `oracleFlag`
 * wins (no indexer hit, no warnings). Otherwise consult the indexer's active
 * set; emit warnings to stderr; fall back to env id with a clear warning if
 * the indexer is unreachable.
 */
export const resolveOracle = async (
  ctx: Ctx,
  oracleFlag?: string,
): Promise<OracleState> => {
  if (oracleFlag) return getOracle(ctx, oracleFlag);

  const envId = ctx.config.ORACLE_OBJECT_ID;
  let oracleId: string;
  try {
    const allOracles = await listOracles(ctx);
    const resolved = resolveOracleId({
      envOracleId: envId,
      activeOracles: findActiveOracles(allOracles),
    });
    for (const w of resolved.warnings) process.stderr.write(`${w}\n`);
    oracleId = resolved.oracleId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`⚠ indexer unreachable (${msg}); falling back to ORACLE_OBJECT_ID from .env\n`);
    oracleId = envId;
  }
  return getOracle(ctx, oracleId);
};
