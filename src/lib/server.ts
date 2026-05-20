import { z } from 'zod';

import type { Ctx } from '../client.js';

const HEX_OBJECT_ID = /^0x[0-9a-f]{64}$/;

/** /status — indexer health + per-pipeline lag. */
const PipelineLagSchema = z.object({
  pipeline: z.string(),
  checkpoint_hi_inclusive: z.number(),
  timestamp_ms_hi_inclusive: z.number(),
  epoch_hi_inclusive: z.number(),
  checkpoint_lag: z.number(),
  time_lag_ms: z.number(),
  time_lag_seconds: z.number(),
  latest_onchain_checkpoint: z.number(),
  is_backfill: z.boolean(),
});

const StatusSchema = z.object({
  status: z.string(),
  latest_onchain_checkpoint: z.number(),
  current_time_ms: z.number(),
  earliest_checkpoint: z.number(),
  max_lag_pipeline: z.string(),
  max_checkpoint_lag: z.number(),
  max_time_lag_seconds: z.number(),
  pipelines: z.array(PipelineLagSchema),
});

export type IndexerStatus = z.infer<typeof StatusSchema>;

const ManagerEntrySchema = z.object({
  digest: z.string(),
  checkpoint: z.number(),
  checkpoint_timestamp_ms: z.number(),
  package: z.string(),
  manager_id: z.string().regex(HEX_OBJECT_ID),
  owner: z.string().regex(HEX_OBJECT_ID),
});

export type ManagerEntry = z.infer<typeof ManagerEntrySchema>;

const OracleEntrySchema = z.object({
  predict_id: z.string().regex(HEX_OBJECT_ID),
  oracle_id: z.string().regex(HEX_OBJECT_ID),
  oracle_cap_id: z.string().regex(HEX_OBJECT_ID),
  underlying_asset: z.string(),
  expiry: z.number(),
  min_strike: z.number(),
  tick_size: z.number(),
  status: z.enum(['active', 'inactive', 'pending_settlement', 'settled']),
  activated_at: z.number().nullable(),
  settlement_price: z.number().nullable(),
  settled_at: z.number().nullable(),
  created_checkpoint: z.number(),
});

export type OracleEntry = z.infer<typeof OracleEntrySchema>;

const ManagersResponse = z.array(ManagerEntrySchema);
const OraclesResponse = z.array(OracleEntrySchema);

export const getStatus = async (ctx: Ctx): Promise<IndexerStatus> =>
  fetchJson(ctx, '/status', StatusSchema);

export const listManagers = async (ctx: Ctx, owner?: string): Promise<readonly ManagerEntry[]> => {
  const path = owner ? `/managers?owner=${owner}` : '/managers';
  return Object.freeze(await fetchJson(ctx, path, ManagersResponse));
};

export const listOracles = async (ctx: Ctx): Promise<readonly OracleEntry[]> =>
  Object.freeze(await fetchJson(ctx, '/oracles', OraclesResponse));

/**
 * Resolves the unique Predict shared-object id from the indexer's `/oracles`
 * feed. Called once during `createContext`; the resulting id flows on Ctx so
 * downstream PTB / read code never needs to know about indexer plumbing.
 *
 * Fails fast on indexer unreachable, empty oracle set, or multiple distinct
 * predict objects (would indicate a mid-migration deployment that requires
 * a manual decision — we refuse to silently pick one).
 *
 * Does not require a Ctx so that `createContext` can call it before the Ctx
 * is fully constructed.
 */
export const resolvePredictObjectId = async (serverUrl: string): Promise<string> => {
  const url = `${serverUrl}/oracles`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Cannot resolve PREDICT_OBJECT_ID: indexer GET ${url} failed (${res.status} ${res.statusText}).`,
    );
  }
  const body = (await res.json()) as unknown;
  const parsed = OraclesResponse.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `GET ${url}: response shape unexpected — ${issue?.path.join('.') || '(root)'}: ${issue?.message}`,
    );
  }
  const ids = new Set(parsed.data.map((o) => o.predict_id));
  if (ids.size === 0) {
    throw new Error(`Indexer at ${url} returned no oracles; cannot auto-resolve PREDICT_OBJECT_ID.`);
  }
  if (ids.size > 1) {
    throw new Error(
      `Indexer returned multiple distinct predict objects (${[...ids].join(', ')}); ` +
        `cannot auto-resolve. Likely mid-deployment — wait for the indexer to converge.`,
    );
  }
  return [...ids][0]!;
};

/**
 * Filter oracles to ones currently Active *and* whose expiry hasn't passed
 * by the client's clock. The server marks `status` from on-chain events
 * but doesn't re-evaluate against wall-clock — an oracle past its expiry
 * with no settlement push yet will still say `status=active`.
 */
export const findActiveOracles = (
  oracles: readonly OracleEntry[],
  opts: { now?: number; underlyingAsset?: string } = {},
): readonly OracleEntry[] => {
  const now = opts.now ?? Date.now();
  return oracles.filter((o) => {
    if (o.status !== 'active') return false;
    if (o.settlement_price !== null) return false;
    if (o.expiry <= now) return false;
    if (opts.underlyingAsset && o.underlying_asset !== opts.underlyingAsset) return false;
    return true;
  });
};

const fetchJson = async <T>(
  ctx: Ctx,
  path: string,
  schema: z.ZodType<T>,
): Promise<T> => {
  const url = `${ctx.config.SERVER_URL}${path}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as unknown;
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `GET ${url}: response shape unexpected — ${issue?.path.join('.') || '(root)'}: ${issue?.message}`,
    );
  }
  return parsed.data;
};
