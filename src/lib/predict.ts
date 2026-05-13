import type { SuiObjectResponse } from '@mysten/sui/client';

import type { Ctx } from '../client.js';

export type PredictState = Readonly<{
  id: string;
  tradingPaused: boolean;
  acceptedQuotes: readonly string[];
  riskConfig: Record<string, unknown>;
  pricingConfig: Record<string, unknown>;
  treasuryConfig: Record<string, unknown>;
  oracleConfig: Record<string, unknown>;
  vault: Record<string, unknown>;
  withdrawalLimiter: Record<string, unknown>;
  /** vault.balance - vault.total_mtm — what LPs claim against. */
  vaultValue: bigint;
  /** vault.balance — gross quote held in the vault. */
  vaultBalance: bigint;
  /** vault.total_mtm — outstanding liability to position holders. */
  vaultMtm: bigint;
  /** PLP supply (treasury_cap.total_supply.value). */
  plpTotalSupply: bigint;
  raw: Record<string, unknown>;
}>;

export const getPredict = async (ctx: Ctx): Promise<PredictState> => {
  const res = await ctx.client.getObject({
    id: ctx.config.PREDICT_OBJECT_ID,
    options: { showContent: true, showType: true },
  });
  const fields = extractMoveFields(res, ctx.config.PREDICT_OBJECT_ID);
  const vault = nestedFields(fields.vault);
  const vaultBalance = readBigInt(vault.balance);
  const vaultMtm = readBigInt(vault.total_mtm);
  const vaultValue = vaultBalance > vaultMtm ? vaultBalance - vaultMtm : 0n;
  return Object.freeze({
    id: ctx.config.PREDICT_OBJECT_ID,
    tradingPaused: Boolean(fields.trading_paused),
    acceptedQuotes: parseAcceptedQuotes(fields.treasury_config),
    riskConfig: nestedFields(fields.risk_config),
    pricingConfig: nestedFields(fields.pricing_config),
    treasuryConfig: nestedFields(fields.treasury_config),
    oracleConfig: nestedFields(fields.oracle_config),
    vault,
    withdrawalLimiter: nestedFields(fields.withdrawal_limiter),
    vaultBalance,
    vaultMtm,
    vaultValue,
    plpTotalSupply: parsePlpSupply(fields.treasury_cap),
    raw: fields,
  });
};

const parsePlpSupply = (raw: unknown): bigint => {
  // TreasuryCap { id, total_supply: Supply<PLP> { value: u64 } }
  const fields = nestedFields(raw);
  const supply = nestedFields(fields.total_supply);
  return readBigInt(supply.value);
};

const readBigInt = (v: unknown): bigint => {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(v);
  if (typeof v === 'string' && v.length > 0) return BigInt(v);
  return 0n;
};

const extractMoveFields = (
  res: SuiObjectResponse,
  id: string,
): Record<string, unknown> => {
  if (res.error) {
    throw new Error(`Failed to read Predict object ${id}: ${JSON.stringify(res.error)}`);
  }
  const content = res.data?.content;
  if (!content || content.dataType !== 'moveObject') {
    throw new Error(`Predict object ${id} has no Move content; got ${content?.dataType ?? 'null'}`);
  }
  return content.fields as Record<string, unknown>;
};

const nestedFields = (raw: unknown): Record<string, unknown> => {
  if (raw && typeof raw === 'object' && 'fields' in raw) {
    const inner = (raw as { fields?: unknown }).fields;
    if (inner && typeof inner === 'object') return inner as Record<string, unknown>;
  }
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
};

const parseAcceptedQuotes = (treasuryConfig: unknown): readonly string[] => {
  const inner = nestedFields(treasuryConfig);
  const set = nestedFields(inner.accepted_quotes);
  const contents = (set.contents ?? []) as Array<{ fields?: { name?: string } } | string>;
  return contents
    .map((c) => (typeof c === 'string' ? c : c.fields?.name))
    .filter((n): n is string => Boolean(n))
    .map((n) => (n.startsWith('0x') ? n : `0x${n}`));
};
