import React, { useState } from 'react';
import { Box, Text } from 'ink';

import type { ScreenProps } from '../App.js';
import { useApp } from '../state/AppContext.js';
import { useAsync } from '../hooks/useAsync.js';
import { useFieldNav } from '../hooks/useFieldNav.js';
import { useValues } from '../hooks/useValues.js';
import { Field, ActionRow } from '../components/Field.js';
import { Async } from '../components/Async.js';
import { parseDecimalAmount } from '../../scripts/_cli.js';
import { fmtPriceCell, perUnitE9, formatUtc, formatTimeToExpiry, PRICE_DECIMALS } from '../format.js';
import { formatDecimal } from '../../scripts/_cli.js';
import { resolveOracle } from '../../lib/oracle-pick.js';
import { Lifecycle } from '../../lib/oracle.js';
import { previewBinarySafe, previewRangeSafe } from '../preview.js';

type BinRow = Readonly<{ strike: bigint; upAsk: bigint | null; upBid: bigint | null; downAsk: bigint | null; downBid: bigint | null; askSum: bigint | null; spread: bigint | null }>;
type RngRow = Readonly<{ lower: bigint; higher: bigint; width: bigint; ask: bigint | null; bid: bigint | null }>;
type Query = Readonly<{ strikes: readonly bigint[]; ranges: ReadonlyArray<{ lower: bigint; higher: bigint }>; qty: bigint }>;
type Result = Readonly<{ oracleId: string; asset: string; spot: bigint; forward: bigint; expiryMs: bigint; binary: readonly BinRow[]; range: readonly RngRow[] }>;

const parseStrikes = (s: string): readonly bigint[] =>
  s.split(',').map((x) => x.trim()).filter(Boolean).map((x) => parseDecimalAmount(x, 9));

const parseRanges = (s: string): ReadonlyArray<{ lower: bigint; higher: bigint }> =>
  s.split(',').map((x) => x.trim()).filter(Boolean).map((pair) => {
    const [lo, hi] = pair.split('-');
    if (!lo || !hi) throw new Error(`range "${pair}" must be "<lower>-<higher>"`);
    const lower = parseDecimalAmount(lo, 9);
    const higher = parseDecimalAmount(hi, 9);
    if (higher <= lower) throw new Error(`range "${pair}" needs higher > lower`);
    return { lower, higher };
  });

const runPreview = async (app: ReturnType<typeof useApp>, q: Query): Promise<Result> => {
  const { ctx, sender, selectedOracleId } = app;
  const oracle = await resolveOracle(ctx, selectedOracleId ?? undefined);
  if (oracle.lifecycle !== Lifecycle.Active) throw new Error(`oracle is ${oracle.lifecycle}; preview requires Active`);
  const addr = sender ?? '';

  const binary = await Promise.all(
    q.strikes.map(async (strike) => {
      const [up, down] = await Promise.all([
        previewBinarySafe(ctx, addr, oracle, strike, q.qty, true),
        previewBinarySafe(ctx, addr, oracle, strike, q.qty, false),
      ]);
      const upAsk = up ? perUnitE9(up.cost, q.qty) : null;
      const upBid = up ? perUnitE9(up.payout, q.qty) : null;
      const downAsk = down ? perUnitE9(down.cost, q.qty) : null;
      const downBid = down ? perUnitE9(down.payout, q.qty) : null;
      const askSum = upAsk !== null && downAsk !== null ? upAsk + downAsk : null;
      const spread = askSum !== null ? 1_000_000_000n - askSum : null;
      return { strike, upAsk, upBid, downAsk, downBid, askSum, spread };
    }),
  );

  const range = await Promise.all(
    q.ranges.map(async (r) => {
      const res = await previewRangeSafe(ctx, addr, oracle, r.lower, r.higher, q.qty);
      return {
        lower: r.lower,
        higher: r.higher,
        width: r.higher - r.lower,
        ask: res ? perUnitE9(res.cost, q.qty) : null,
        bid: res ? perUnitE9(res.payout, q.qty) : null,
      };
    }),
  );

  return { oracleId: oracle.id, asset: oracle.underlyingAsset, spot: oracle.spot, forward: oracle.forward, expiryMs: oracle.expiryMs, binary, range };
};

export const PreviewScreen = ({ focus, onExit }: ScreenProps): React.ReactElement => {
  const app = useApp();
  const { quote } = app;
  const { values, setValue } = useValues({ strikes: '', ranges: '', qty: '1' });
  const [query, setQuery] = useState<Query | null>(null);
  const [parseErr, setParseErr] = useState<string | null>(null);

  const fields = [
    { key: 'strikes', label: 'strikes', placeholder: '79000,80000,80500' },
    { key: 'ranges', label: 'ranges', placeholder: '79500-80500,80500-81500' },
    { key: 'qty', label: `qty ${quote.symbol}`, placeholder: '1' },
  ];
  const actionIndex = fields.length;

  const { focusIndex, setFocusIndex } = useFieldNav({
    slots: fields.length + 1,
    active: focus,
    onEnter: (i) => {
      if (i !== actionIndex) {
        setFocusIndex(Math.min(i + 1, actionIndex));
        return;
      }
      try {
        const strikes = parseStrikes(values.strikes ?? '');
        const ranges = parseRanges(values.ranges ?? '');
        if (strikes.length === 0 && ranges.length === 0) throw new Error('enter at least one strike or range');
        const qty = parseDecimalAmount((values.qty ?? '1') || '1', Number(quote.decimals));
        setParseErr(null);
        setQuery({ strikes, ranges, qty });
      } catch (e) {
        setParseErr(e instanceof Error ? e.message : String(e));
        setQuery(null);
      }
    },
    onEscape: onExit,
  });

  const state = useAsync(
    () => (query ? runPreview(app, query) : Promise.resolve(null)),
    [query, app.refreshNonce, app.selectedOracleId],
  );

  return (
    <Box flexDirection="column">
      {fields.map((f, i) => (
        <Field key={f.key} label={f.label} value={values[f.key] ?? ''} onChange={(v) => setValue(f.key, v)} focus={focus && focusIndex === i} placeholder={f.placeholder} />
      ))}
      <Box marginTop={1}>
        <ActionRow label="compute preview" focus={focus && focusIndex === actionIndex} />
      </Box>
      {parseErr ? <Text color="red">✗ {parseErr}</Text> : null}
      {query ? (
        <Box marginTop={1} flexDirection="column">
          <Async state={state} loadingLabel="pricing…">{(r) => (r ? <PreviewTables result={r} quote={quote} /> : <Text dimColor>—</Text>)}</Async>
        </Box>
      ) : (
        <Text dimColor>fill fields, then run compute</Text>
      )}
    </Box>
  );
};

const PreviewTables = ({ result, quote }: { result: Result; quote: { symbol: string; decimals: bigint } }): React.ReactElement => (
  <Box flexDirection="column">
    <Box flexDirection="column">
      <Text>
        <Text dimColor>oracle    </Text> {result.oracleId}
      </Text>
      <Text>
        <Text dimColor>underlying</Text> {result.asset}
      </Text>
      <Text>
        <Text dimColor>spot      </Text> {formatDecimal(result.spot, PRICE_DECIMALS)}
      </Text>
      <Text>
        <Text dimColor>forward   </Text> {formatDecimal(result.forward, PRICE_DECIMALS)}
      </Text>
      <Text>
        <Text dimColor>expiry    </Text> {formatUtc(result.expiryMs)} ({formatTimeToExpiry(Number(result.expiryMs), Date.now())})
      </Text>
    </Box>
    {result.binary.length > 0 ? (
      <Box flexDirection="column" marginTop={1}>
        <Text bold>binary (per $1 contract, 1e9)</Text>
        <Text dimColor>{'strike   '}|  UP ask  UP bid  | DOWN ask DOWN bid |  ask sum   spread</Text>
        {result.binary.map((b, i) => (
          <Text key={i}>
            {fmtPriceCell(b.strike, 8)} | {fmtPriceCell(b.upAsk)} {fmtPriceCell(b.upBid)} | {fmtPriceCell(b.downAsk)} {fmtPriceCell(b.downBid)} | {fmtPriceCell(b.askSum)} {fmtPriceCell(b.spread)}
          </Text>
        ))}
      </Box>
    ) : null}
    {result.range.length > 0 ? (
      <Box flexDirection="column" marginTop={1}>
        <Text bold>range (per $1 contract, 1e9)</Text>
        <Text dimColor>{'lower    higher    width   |   ask       bid'}</Text>
        {result.range.map((r, i) => (
          <Text key={i}>
            {fmtPriceCell(r.lower, 8)} {fmtPriceCell(r.higher, 8)} {fmtPriceCell(r.width, 6)} | {fmtPriceCell(r.ask)} {fmtPriceCell(r.bid)}
          </Text>
        ))}
      </Box>
    ) : null}
  </Box>
);
