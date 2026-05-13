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
  raw: Record<string, unknown>;
}>;

export const getPredict = async (ctx: Ctx): Promise<PredictState> => {
  const res = await ctx.client.getObject({
    id: ctx.config.PREDICT_OBJECT_ID,
    options: { showContent: true, showType: true },
  });
  const fields = extractMoveFields(res, ctx.config.PREDICT_OBJECT_ID);
  return Object.freeze({
    id: ctx.config.PREDICT_OBJECT_ID,
    tradingPaused: Boolean(fields.trading_paused),
    acceptedQuotes: parseAcceptedQuotes(fields.treasury_config),
    riskConfig: nestedFields(fields.risk_config),
    pricingConfig: nestedFields(fields.pricing_config),
    treasuryConfig: nestedFields(fields.treasury_config),
    oracleConfig: nestedFields(fields.oracle_config),
    vault: nestedFields(fields.vault),
    withdrawalLimiter: nestedFields(fields.withdrawal_limiter),
    raw: fields,
  });
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
