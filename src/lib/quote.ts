import type { Ctx } from '../client.js';

export type Quote = Readonly<{
  /** Full coin type, e.g. `0xe95040…::dusdc::DUSDC`. */
  coinType: string;
  /** Symbol from CoinMetadata, e.g. `DUSDC`. Display-only. */
  symbol: string;
  /** Decimals from CoinMetadata, e.g. `6n`. Used in formatDecimal/parseDecimalAmount. */
  decimals: bigint;
}>;

/**
 * Resolves which quote asset the user wants from the protocol's
 * `accepted_quotes` set. Auto-selects when exactly one is available;
 * requires `--quote <symbol-or-type>` to disambiguate when ≥ 2.
 */
export const resolveQuote = async (
  ctx: Ctx,
  quoteArg: string | undefined,
): Promise<Quote> => {
  const accepted = await fetchAcceptedQuotes(ctx);
  if (accepted.length === 0) {
    throw new Error(
      `Predict object ${ctx.predictObjectId} has no accepted quotes — protocol misconfigured.`,
    );
  }

  const metadata = await Promise.all(
    accepted.map(async (coinType) => {
      const md = await ctx.client.getCoinMetadata({ coinType });
      if (!md) throw new Error(`CoinMetadata not found for ${coinType}`);
      return { coinType, symbol: md.symbol, decimals: BigInt(md.decimals) };
    }),
  );

  if (!quoteArg) {
    if (metadata.length === 1) return Object.freeze(metadata[0]!);
    throw new Error(
      `--quote required to disambiguate. Multiple accepted quotes available: ` +
        formatChoices(metadata),
    );
  }

  const chosen = matchQuote(metadata, quoteArg);
  if (!chosen) {
    throw new Error(
      `--quote "${quoteArg}" did not match any accepted quote. Available: ` +
        formatChoices(metadata),
    );
  }
  return Object.freeze(chosen);
};

const fetchAcceptedQuotes = async (ctx: Ctx): Promise<readonly string[]> => {
  const res = await ctx.client.getObject({
    id: ctx.predictObjectId,
    options: { showContent: true },
  });
  const content = (res as { data?: { content?: { dataType?: string; fields?: unknown } } })?.data
    ?.content;
  if (!content || content.dataType !== 'moveObject') {
    throw new Error(`Predict object ${ctx.predictObjectId} has no Move content`);
  }
  const fields = content.fields as Record<string, unknown>;
  const treasury = nested(fields.treasury_config);
  const set = nested(treasury.accepted_quotes);
  const contents = (set.contents ?? []) as Array<{ fields?: { name?: string } } | string>;
  return contents
    .map((c) => (typeof c === 'string' ? c : c.fields?.name))
    .filter((n): n is string => Boolean(n))
    .map((n) => (n.startsWith('0x') ? n : `0x${n}`));
};

const matchQuote = (candidates: readonly Quote[], arg: string): Quote | undefined => {
  if (arg.includes('::')) return candidates.find((c) => c.coinType === arg);
  const lower = arg.trim().toLowerCase();
  return candidates.find((c) => c.symbol.toLowerCase() === lower);
};

const formatChoices = (quotes: readonly Quote[]): string =>
  '[' + quotes.map((q) => `${q.symbol} (${q.coinType})`).join(', ') + ']';

const nested = (raw: unknown): Record<string, unknown> => {
  if (raw && typeof raw === 'object' && 'fields' in raw) {
    const inner = (raw as { fields?: unknown }).fields;
    if (inner && typeof inner === 'object') return inner as Record<string, unknown>;
  }
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
};
