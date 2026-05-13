import type { Ctx } from '../client.js';

export const Lifecycle = {
  Inactive: 'Inactive',
  Active: 'Active',
  PendingSettlement: 'PendingSettlement',
  Settled: 'Settled',
} as const;
export type Lifecycle = (typeof Lifecycle)[keyof typeof Lifecycle];

export type SVI = Readonly<{
  a: bigint;
  b: bigint;
  rho: bigint;
  m: bigint;
  sigma: bigint;
}>;

export type OracleState = Readonly<{
  id: string;
  underlyingAsset: string;
  expiryMs: bigint;
  active: boolean;
  spot: bigint;
  forward: bigint;
  svi: SVI;
  timestampMs: bigint;
  settlementPrice: bigint | null;
  authorizedCaps: readonly string[];
  lifecycle: Lifecycle;
}>;

export const getOracle = async (ctx: Ctx, id: string): Promise<OracleState> => {
  const res = await ctx.client.getObject({
    id,
    options: { showContent: true, showType: true },
  });
  if (res.error) {
    throw new Error(`Failed to read OracleSVI ${id}: ${JSON.stringify(res.error)}`);
  }
  const content = res.data?.content;
  if (!content || content.dataType !== 'moveObject') {
    throw new Error(`OracleSVI ${id} has no Move content`);
  }
  const fields = content.fields as Record<string, unknown>;
  return parseOracle(id, fields, BigInt(Date.now()));
};

export const parseOracle = (
  id: string,
  fields: Record<string, unknown>,
  nowMs: bigint,
): OracleState => {
  const prices = inner(fields.prices);
  const sviFields = inner(fields.svi);
  const active = Boolean(fields.active);
  const expiryMs = readBigInt(fields.expiry);
  const settlementPrice = readOptionalBigInt(fields.settlement_price);
  const lifecycle = computeLifecycle({ active, settlementPrice, expiryMs, nowMs });

  return Object.freeze({
    id,
    underlyingAsset: String(fields.underlying_asset ?? ''),
    expiryMs,
    active,
    spot: readBigInt(prices.spot),
    forward: readBigInt(prices.forward),
    svi: Object.freeze({
      a: readBigInt(sviFields.a),
      b: readBigInt(sviFields.b),
      rho: parseI64(sviFields.rho),
      m: parseI64(sviFields.m),
      sigma: readBigInt(sviFields.sigma),
    }),
    timestampMs: readBigInt(fields.timestamp),
    settlementPrice,
    authorizedCaps: readCapList(fields.authorized_caps),
    lifecycle,
  });
};

export const computeLifecycle = (s: {
  active: boolean;
  settlementPrice: bigint | null;
  expiryMs: bigint;
  nowMs: bigint;
}): Lifecycle => {
  if (s.settlementPrice !== null) return Lifecycle.Settled;
  if (s.nowMs >= s.expiryMs) return Lifecycle.PendingSettlement;
  if (!s.active) return Lifecycle.Inactive;
  return Lifecycle.Active;
};

export const parseI64 = (raw: unknown): bigint => {
  if (!raw || typeof raw !== 'object') return 0n;
  const fields = inner(raw);
  const magnitude = readBigInt(fields.magnitude);
  return fields.is_negative ? -magnitude : magnitude;
};

const inner = (raw: unknown): Record<string, unknown> => {
  if (raw && typeof raw === 'object' && 'fields' in raw) {
    const f = (raw as { fields?: unknown }).fields;
    if (f && typeof f === 'object') return f as Record<string, unknown>;
  }
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
};

const readBigInt = (v: unknown): bigint => {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(v);
  if (typeof v === 'string' && v.length > 0) return BigInt(v);
  return 0n;
};

const readOptionalBigInt = (v: unknown): bigint | null => {
  if (v === null || v === undefined) return null;
  // Move Option<u64> may surface as null OR as `{ vec: ['value'] }` depending on SDK
  if (typeof v === 'object' && 'vec' in v) {
    const arr = (v as { vec?: unknown[] }).vec ?? [];
    if (arr.length === 0) return null;
    return readBigInt(arr[0]);
  }
  return readBigInt(v);
};

const readCapList = (raw: unknown): readonly string[] => {
  const set = inner(raw);
  const contents = (set.contents ?? []) as unknown[];
  return contents.filter((c): c is string => typeof c === 'string');
};
