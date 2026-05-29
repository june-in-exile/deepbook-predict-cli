import React from 'react';
import { Box, Text } from 'ink';

import type { ScreenProps } from '../App.js';
import { useApp } from '../state/AppContext.js';
import { useAsync } from '../hooks/useAsync.js';
import { useTabs } from '../hooks/useTabs.js';
import { useValues } from '../hooks/useValues.js';
import { Tabs } from '../components/Tabs.js';
import { Async } from '../components/Async.js';
import { WriteForm } from '../components/WriteForm.js';
import { formatDecimal, parseDecimalAmount } from '../../scripts/_cli.js';
import { PRICE_DECIMALS, perUnitE9, shortId } from '../format.js';
import {
  getManager,
  getQuoteBalance,
  listBinaryPositions,
  listRangePositions,
} from '../../lib/manager.js';
import { Lifecycle, getOracle, type OracleState } from '../../lib/oracle.js';
import { resolveOracle, pickPositionOracle, pickRangePositionOracle } from '../../lib/oracle-pick.js';
import { buildMintBinaryTx } from '../../ptb/mintBinary.js';
import { buildMintRangeTx } from '../../ptb/mintRange.js';
import { buildRedeemTx } from '../../ptb/redeem.js';
import { buildRedeemRangeTx } from '../../ptb/redeemRange.js';
import { previewBinary, previewRange } from '../preview.js';

const tryParse = (human: string, decimals: number): bigint | null => {
  try {
    const v = parseDecimalAmount(human, decimals);
    return v > 0n ? v : null;
  } catch {
    return null;
  }
};

export const TradeScreen = ({ focus, onExit }: ScreenProps): React.ReactElement => {
  const [tab] = useTabs(4, focus);
  return (
    <Box flexDirection="column">
      <Tabs labels={['Mint UP/DOWN', 'Mint Range', 'Redeem', 'Redeem Range']} index={tab} focus={focus} />
      {tab === 0 ? <MintBinaryTab focus={focus} onExit={onExit} /> : null}
      {tab === 1 ? <MintRangeTab focus={focus} onExit={onExit} /> : null}
      {tab === 2 ? <RedeemTab focus={focus} onExit={onExit} /> : null}
      {tab === 3 ? <RedeemRangeTab focus={focus} onExit={onExit} /> : null}
    </Box>
  );
};

const OracleLine = ({ oracle }: { oracle: OracleState }): React.ReactElement => (
  <Text dimColor>
    oracle {shortId(oracle.id)} {oracle.underlyingAsset} spot {formatDecimal(oracle.spot, PRICE_DECIMALS)}{' '}
    <Text color={oracle.lifecycle === 'Active' ? 'green' : 'yellow'}>{oracle.lifecycle}</Text>
  </Text>
);

// --- Mint binary -----------------------------------------------------------
const MintBinaryTab = ({ focus, onExit }: ScreenProps): React.ReactElement => {
  const app = useApp();
  const { ctx, quote, sender, canSign, selectedOracleId, selectedManagerId, refreshNonce } = app;
  const { values, setValue } = useValues({ strike: '', qty: '', direction: 'up' });
  const oracleState = useAsync(() => resolveOracle(ctx, selectedOracleId ?? undefined), [refreshNonce, selectedOracleId]);
  const balanceState = useAsync(
    () => (selectedManagerId ? getManager(ctx, selectedManagerId).then((m) => getQuoteBalance(ctx, m, quote.coinType)) : Promise.resolve(null)),
    [refreshNonce, selectedManagerId],
  );

  const strike = tryParse(values.strike ?? '', 9);
  const qty = tryParse(values.qty ?? '', Number(quote.decimals));
  const dir = (values.direction ?? '').trim().toLowerCase();
  const isUp = dir === 'up';
  const dirValid = dir === 'up' || dir === 'down';
  const oracle = oracleState.value;

  const previewState = useAsync(
    () =>
      oracle && strike !== null && qty !== null && dirValid
        ? previewBinary(ctx, sender ?? "", oracle, strike, qty, isUp).then((r) => r as { cost: bigint; payout: bigint } | null)
        : Promise.resolve(null),
    [oracle?.id, values.strike, values.qty, values.direction, refreshNonce],
  );

  const cost = previewState.value?.cost ?? null;
  const balance = balanceState.value;
  const insufficient = cost !== null && balance !== null && balance < cost;
  const oracleActive = oracle?.lifecycle === Lifecycle.Active;
  const ready = canSign && sender !== null && selectedManagerId !== null && oracleActive && dirValid && strike !== null && qty !== null && !insufficient;
  const reason = !canSign ? 'read-only' : !selectedManagerId ? 'no manager' : !oracleActive ? 'oracle not Active' : insufficient ? 'insufficient balance' : !dirValid ? 'direction up|down' : '';

  return (
    <Box flexDirection="column">
      <Async state={oracleState} loadingLabel="resolving oracle…">{(o) => <OracleLine oracle={o} />}</Async>
      <WriteForm
        focus={focus}
        onExit={onExit}
        fields={[
          { key: 'strike', label: 'strike $', placeholder: '80000' },
          { key: 'qty', label: `qty ${quote.symbol}`, placeholder: '5' },
          { key: 'direction', label: 'direction', placeholder: 'up | down' },
        ]}
        values={values}
        setValue={setValue}
        canRun={ready}
        blockedReason={reason}
        actionLabel="dry-run · mint"
        confirmMessage={`Mint ${isUp ? 'UP' : 'DOWN'} strike ${values.strike} qty ${values.qty} for ~${cost !== null ? formatDecimal(cost, quote.decimals) : '?'} ${quote.symbol}?`}
        buildTx={async () =>
          buildMintBinaryTx(ctx, {
            managerId: selectedManagerId ?? '',
            oracleId: oracle?.id ?? '',
            expiryMs: oracle?.expiryMs ?? 0n,
            strike: strike ?? 0n,
            isUp,
            quantity: qty ?? 0n,
            coinType: quote.coinType,
          })
        }
        renderPreview={<PreviewBox cost={cost} payout={previewState.value?.payout ?? null} qty={qty} balance={balance} quote={quote} loading={previewState.loading} />}
      />
    </Box>
  );
};

// --- Mint range ------------------------------------------------------------
const MintRangeTab = ({ focus, onExit }: ScreenProps): React.ReactElement => {
  const app = useApp();
  const { ctx, quote, sender, canSign, selectedOracleId, selectedManagerId, refreshNonce } = app;
  const { values, setValue } = useValues({ lower: '', higher: '', qty: '' });
  const oracleState = useAsync(() => resolveOracle(ctx, selectedOracleId ?? undefined), [refreshNonce, selectedOracleId]);
  const balanceState = useAsync(
    () => (selectedManagerId ? getManager(ctx, selectedManagerId).then((m) => getQuoteBalance(ctx, m, quote.coinType)) : Promise.resolve(null)),
    [refreshNonce, selectedManagerId],
  );

  const lower = tryParse(values.lower ?? '', 9);
  const higher = tryParse(values.higher ?? '', 9);
  const qty = tryParse(values.qty ?? '', Number(quote.decimals));
  const rangeValid = lower !== null && higher !== null && higher > lower;
  const oracle = oracleState.value;

  const previewState = useAsync(
    () =>
      oracle && rangeValid && qty !== null
        ? previewRange(ctx, sender ?? "", oracle, lower, higher, qty).then((r) => r as { cost: bigint; payout: bigint } | null)
        : Promise.resolve(null),
    [oracle?.id, values.lower, values.higher, values.qty, refreshNonce],
  );

  const cost = previewState.value?.cost ?? null;
  const balance = balanceState.value;
  const insufficient = cost !== null && balance !== null && balance < cost;
  const oracleActive = oracle?.lifecycle === Lifecycle.Active;
  const ready = canSign && sender !== null && selectedManagerId !== null && oracleActive && rangeValid && qty !== null && !insufficient;
  const reason = !canSign ? 'read-only' : !selectedManagerId ? 'no manager' : !oracleActive ? 'oracle not Active' : !rangeValid ? 'need higher > lower' : insufficient ? 'insufficient balance' : '';

  return (
    <Box flexDirection="column">
      <Async state={oracleState} loadingLabel="resolving oracle…">{(o) => <OracleLine oracle={o} />}</Async>
      <WriteForm
        focus={focus}
        onExit={onExit}
        fields={[
          { key: 'lower', label: 'lower $', placeholder: '80000' },
          { key: 'higher', label: 'higher $', placeholder: '81000' },
          { key: 'qty', label: `qty ${quote.symbol}`, placeholder: '5' },
        ]}
        values={values}
        setValue={setValue}
        canRun={ready}
        blockedReason={reason}
        actionLabel="dry-run · mint range"
        confirmMessage={`Mint range (${values.lower}, ${values.higher}] qty ${values.qty} for ~${cost !== null ? formatDecimal(cost, quote.decimals) : '?'} ${quote.symbol}?`}
        buildTx={async () =>
          buildMintRangeTx(ctx, {
            managerId: selectedManagerId ?? '',
            oracleId: oracle?.id ?? '',
            expiryMs: oracle?.expiryMs ?? 0n,
            lower: lower ?? 0n,
            higher: higher ?? 0n,
            quantity: qty ?? 0n,
            coinType: quote.coinType,
          })
        }
        renderPreview={<PreviewBox cost={cost} payout={previewState.value?.payout ?? null} qty={qty} balance={balance} quote={quote} loading={previewState.loading} />}
      />
    </Box>
  );
};

// --- Redeem binary ---------------------------------------------------------
const RedeemTab = ({ focus, onExit }: ScreenProps): React.ReactElement => {
  const app = useApp();
  const { ctx, quote, sender, canSign, selectedOracleId, selectedManagerId, refreshNonce } = app;
  const { values, setValue } = useValues({ strike: '', qty: '', direction: 'up' });

  const strike = tryParse(values.strike ?? '', 9);
  const qty = tryParse(values.qty ?? '', Number(quote.decimals));
  const dir = (values.direction ?? '').trim().toLowerCase();
  const isUp = dir === 'up';
  const dirValid = dir === 'up' || dir === 'down';

  // Resolve the oracle from selection, else from the matching manager position.
  const oracleState = useAsync<OracleState | null>(async () => {
    if (selectedOracleId) return getOracle(ctx, selectedOracleId);
    if (!selectedManagerId || strike === null || !dirValid) return null;
    const m = await getManager(ctx, selectedManagerId);
    const positions = await listBinaryPositions(ctx, m);
    const match = pickPositionOracle(positions, strike, isUp);
    return getOracle(ctx, match.oracleId);
  }, [refreshNonce, selectedOracleId, selectedManagerId, values.strike, values.direction]);
  const oracle = oracleState.value;

  const previewState = useAsync(
    () =>
      oracle && strike !== null && qty !== null && dirValid && oracle.lifecycle === Lifecycle.Active
        ? previewBinary(ctx, sender ?? "", oracle, strike, qty, isUp).then((r) => r as { cost: bigint; payout: bigint } | null)
        : Promise.resolve(null),
    [oracle?.id, values.strike, values.qty, values.direction, refreshNonce],
  );

  const quoteable = oracle && (oracle.lifecycle === Lifecycle.Active || oracle.lifecycle === Lifecycle.Settled);
  const ready = canSign && sender !== null && selectedManagerId !== null && !!quoteable && dirValid && strike !== null && qty !== null;
  const reason = !canSign ? 'read-only' : !selectedManagerId ? 'no manager' : !quoteable ? 'oracle not Active/Settled' : '';

  return (
    <Box flexDirection="column">
      {oracle ? <OracleLine oracle={oracle} /> : <Text dimColor>{oracleState.loading ? 'resolving oracle…' : 'enter strike/direction to match a position'}</Text>}
      <WriteForm
        focus={focus}
        onExit={onExit}
        fields={[
          { key: 'strike', label: 'strike $', placeholder: '80500' },
          { key: 'qty', label: `qty ${quote.symbol}`, placeholder: '5' },
          { key: 'direction', label: 'direction', placeholder: 'up | down' },
        ]}
        values={values}
        setValue={setValue}
        canRun={ready}
        blockedReason={reason}
        actionLabel="dry-run · redeem"
        confirmMessage={`Redeem ${isUp ? 'UP' : 'DOWN'} strike ${values.strike} qty ${values.qty}?`}
        buildTx={async () =>
          buildRedeemTx(ctx, {
            managerId: selectedManagerId ?? '',
            oracleId: oracle?.id ?? '',
            expiryMs: oracle?.expiryMs ?? 0n,
            strike: strike ?? 0n,
            isUp,
            quantity: qty ?? 0n,
            coinType: quote.coinType,
          })
        }
        renderPreview={
          <Text>
            preview payout:{' '}
            {previewState.value ? (
              <Text color="green">{formatDecimal(previewState.value.payout, quote.decimals)} {quote.symbol}</Text>
            ) : (
              <Text dimColor>{oracle?.lifecycle === Lifecycle.Settled ? 'settled — payout fixed at settlement' : 'enter inputs'}</Text>
            )}
          </Text>
        }
      />
    </Box>
  );
};

// --- Redeem range ----------------------------------------------------------
const RedeemRangeTab = ({ focus, onExit }: ScreenProps): React.ReactElement => {
  const app = useApp();
  const { ctx, quote, sender, canSign, selectedOracleId, selectedManagerId, refreshNonce } = app;
  const { values, setValue } = useValues({ lower: '', higher: '', qty: '' });

  const lower = tryParse(values.lower ?? '', 9);
  const higher = tryParse(values.higher ?? '', 9);
  const qty = tryParse(values.qty ?? '', Number(quote.decimals));
  const rangeValid = lower !== null && higher !== null && higher > lower;

  const oracleState = useAsync<OracleState | null>(async () => {
    if (selectedOracleId) return getOracle(ctx, selectedOracleId);
    if (!selectedManagerId || !rangeValid) return null;
    const m = await getManager(ctx, selectedManagerId);
    const positions = await listRangePositions(ctx, m);
    const match = pickRangePositionOracle(positions, lower, higher);
    return getOracle(ctx, match.oracleId);
  }, [refreshNonce, selectedOracleId, selectedManagerId, values.lower, values.higher]);
  const oracle = oracleState.value;

  const settledPayout =
    oracle && oracle.lifecycle === Lifecycle.Settled && qty !== null && rangeValid
      ? oracle.settlementPrice !== null && oracle.settlementPrice >= lower && oracle.settlementPrice <= higher
        ? qty
        : 0n
      : null;
  const previewState = useAsync(
    () =>
      oracle && rangeValid && qty !== null && oracle.lifecycle === Lifecycle.Active
        ? previewRange(ctx, sender ?? "", oracle, lower, higher, qty).then((r) => r as { cost: bigint; payout: bigint } | null)
        : Promise.resolve(null),
    [oracle?.id, values.lower, values.higher, values.qty, refreshNonce],
  );
  const payout = settledPayout ?? previewState.value?.payout ?? null;

  const quoteable = oracle && (oracle.lifecycle === Lifecycle.Active || oracle.lifecycle === Lifecycle.Settled);
  const ready = canSign && sender !== null && selectedManagerId !== null && !!quoteable && rangeValid && qty !== null;
  const reason = !canSign ? 'read-only' : !selectedManagerId ? 'no manager' : !quoteable ? 'oracle not Active/Settled' : !rangeValid ? 'need higher > lower' : '';

  return (
    <Box flexDirection="column">
      {oracle ? <OracleLine oracle={oracle} /> : <Text dimColor>{oracleState.loading ? 'resolving oracle…' : 'enter lower/higher to match a position'}</Text>}
      <WriteForm
        focus={focus}
        onExit={onExit}
        fields={[
          { key: 'lower', label: 'lower $', placeholder: '80000' },
          { key: 'higher', label: 'higher $', placeholder: '81000' },
          { key: 'qty', label: `qty ${quote.symbol}`, placeholder: '5' },
        ]}
        values={values}
        setValue={setValue}
        canRun={ready}
        blockedReason={reason}
        actionLabel="dry-run · redeem range"
        confirmMessage={`Redeem range (${values.lower}, ${values.higher}] qty ${values.qty}?`}
        buildTx={async () =>
          buildRedeemRangeTx(ctx, {
            managerId: selectedManagerId ?? '',
            oracleId: oracle?.id ?? '',
            expiryMs: oracle?.expiryMs ?? 0n,
            lower: lower ?? 0n,
            higher: higher ?? 0n,
            quantity: qty ?? 0n,
            coinType: quote.coinType,
          })
        }
        renderPreview={
          <Text>
            preview payout:{' '}
            {payout !== null ? (
              <Text color="green">{formatDecimal(payout, quote.decimals)} {quote.symbol}</Text>
            ) : (
              <Text dimColor>enter inputs</Text>
            )}
          </Text>
        }
      />
    </Box>
  );
};

const PreviewBox = ({
  cost,
  payout,
  qty,
  balance,
  quote,
  loading,
}: {
  cost: bigint | null;
  payout: bigint | null;
  qty: bigint | null;
  balance: bigint | null;
  quote: { symbol: string; decimals: bigint };
  loading: boolean;
}): React.ReactElement => {
  if (cost === null || payout === null) {
    return <Text dimColor>{loading ? 'pricing…' : 'enter valid inputs to price'}</Text>;
  }
  const askE9 = qty ? perUnitE9(cost, qty) : 0n;
  const bidE9 = qty ? perUnitE9(payout, qty) : 0n;
  return (
    <Box flexDirection="column">
      <Text>
        cost <Text color="yellow">{formatDecimal(cost, quote.decimals)}</Text> {quote.symbol} · instant-sell bid{' '}
        {formatDecimal(payout, quote.decimals)} {quote.symbol}
      </Text>
      <Text dimColor>
        implied ask {formatDecimal(askE9, PRICE_DECIMALS)} · bid {formatDecimal(bidE9, PRICE_DECIMALS)} per $1 contract
      </Text>
      {balance !== null ? (
        <Text dimColor>
          manager balance {formatDecimal(balance, quote.decimals)} {quote.symbol}
          {balance < cost ? <Text color="red">  — insufficient</Text> : null}
        </Text>
      ) : null}
    </Box>
  );
};
