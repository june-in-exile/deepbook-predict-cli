import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

import type { ScreenProps } from '../App.js';
import { useApp } from '../state/AppContext.js';
import { useAsync } from '../hooks/useAsync.js';
import { useTabs } from '../hooks/useTabs.js';
import { useValues } from '../hooks/useValues.js';
import { Tabs } from '../components/Tabs.js';
import { Async } from '../components/Async.js';
import { Select } from '../components/Select.js';
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
import { resolveOracle } from '../../lib/oracle-pick.js';
import { buildMintBinaryTx } from '../../ptb/mintBinary.js';
import { buildMintRangeTx } from '../../ptb/mintRange.js';
import { buildRedeemTx } from '../../ptb/redeem.js';
import { buildRedeemRangeTx } from '../../ptb/redeemRange.js';
import { previewBinary, previewRange } from '../preview.js';
import {
  buildRedeemItems,
  redeemItemLabel,
  redeemQtyError,
  redeemTxPlan,
  settledRangePayout,
  type RedeemItem,
} from '../redeem-items.js';

const tryParse = (human: string, decimals: number): bigint | null => {
  try {
    const v = parseDecimalAmount(human, decimals);
    return v > 0n ? v : null;
  } catch {
    return null;
  }
};

export const TradeScreen = ({ focus, onExit }: ScreenProps): React.ReactElement => {
  const [tab] = useTabs(3, focus, onExit);
  return (
    <Box flexDirection="column">
      <Tabs labels={['Mint UP/DOWN', 'Mint Range', 'Redeem']} index={tab} focus={focus} />
      {tab === 0 ? <MintBinaryTab focus={focus} onExit={onExit} /> : null}
      {tab === 1 ? <MintRangeTab focus={focus} onExit={onExit} /> : null}
      {tab === 2 ? <RedeemTab focus={focus} onExit={onExit} /> : null}
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

// --- Redeem ----------------------------------------------------------------
// Two-phase: pick a redeemable position from the manager, then redeem it (qty
// pre-filled to the full position, editable for a partial redeem).
const RedeemTab = ({ focus, onExit }: ScreenProps): React.ReactElement => {
  const app = useApp();
  const { ctx, quote, selectedManagerId, refreshNonce } = app;
  const { values, setValue } = useValues({ qty: '' });
  const [selected, setSelected] = useState<RedeemItem | null>(null);

  const itemsState = useAsync<readonly RedeemItem[]>(async () => {
    if (!selectedManagerId) return [];
    const m = await getManager(ctx, selectedManagerId);
    const [bin, range] = await Promise.all([listBinaryPositions(ctx, m), listRangePositions(ctx, m)]);
    return buildRedeemItems(bin, range);
  }, [refreshNonce, selectedManagerId]);

  // Esc returns to the sidebar only while picking; the form handles its own Esc.
  useInput(
    (_input, key) => {
      if (key.escape) onExit();
    },
    { isActive: focus && selected === null },
  );

  if (selected !== null) {
    return <RedeemForm item={selected} focus={focus} values={values} setValue={setValue} onBack={() => setSelected(null)} />;
  }

  if (!selectedManagerId) return <Text color="yellow">select a manager in Account first</Text>;

  return (
    <Async state={itemsState} loadingLabel="loading positions…">
      {(items) =>
        items.length === 0 ? (
          <Text dimColor>no redeemable positions</Text>
        ) : (
          <Box flexDirection="column">
            <Text dimColor>pick a position to redeem:</Text>
            <Select
              items={items.map((it) => ({ label: redeemItemLabel(it, quote.decimals), value: it }))}
              focus={focus}
              onSelect={(it) => {
                setValue('qty', formatDecimal(it.pos.quantity, quote.decimals));
                setSelected(it);
              }}
            />
          </Box>
        )
      }
    </Async>
  );
};

const RedeemForm = ({
  item,
  focus,
  values,
  setValue,
  onBack,
}: {
  item: RedeemItem;
  focus: boolean;
  values: Readonly<Record<string, string>>;
  setValue: (key: string, value: string) => void;
  onBack: () => void;
}): React.ReactElement => {
  const app = useApp();
  const { ctx, quote, sender, canSign, selectedManagerId, refreshNonce } = app;
  const qty = tryParse(values.qty ?? '', Number(quote.decimals));

  const oracleState = useAsync<OracleState | null>(() => getOracle(ctx, item.pos.oracleId), [item.pos.oracleId, refreshNonce]);
  const oracle = oracleState.value;

  const previewState = useAsync(
    () =>
      oracle && qty !== null && oracle.lifecycle === Lifecycle.Active
        ? (item.kind === 'binary'
            ? previewBinary(ctx, sender ?? '', oracle, item.pos.strike, qty, item.pos.isUp)
            : previewRange(ctx, sender ?? '', oracle, item.pos.lowerStrike, item.pos.higherStrike, qty)
          ).then((r) => r as { cost: bigint; payout: bigint } | null)
        : Promise.resolve(null),
    [oracle?.id, item.pos.oracleId, values.qty, refreshNonce],
  );

  const settledPayout =
    oracle && oracle.lifecycle === Lifecycle.Settled && qty !== null && item.kind === 'range'
      ? settledRangePayout(oracle.settlementPrice, item.pos.lowerStrike, item.pos.higherStrike, qty)
      : null;
  const payout = settledPayout ?? previewState.value?.payout ?? null;

  const qtyErr = redeemQtyError(qty, item.pos.quantity, quote.decimals);
  const quoteable = oracle && (oracle.lifecycle === Lifecycle.Active || oracle.lifecycle === Lifecycle.Settled);
  const ready = canSign && sender !== null && selectedManagerId !== null && !!quoteable && qtyErr === null;
  const reason = !canSign ? 'read-only' : !selectedManagerId ? 'no manager' : !quoteable ? 'oracle not Active/Settled' : qtyErr ?? '';
  const label = redeemItemLabel(item, quote.decimals);

  return (
    <Box flexDirection="column">
      <Text dimColor>▸ {label}</Text>
      {oracle ? <OracleLine oracle={oracle} /> : <Text dimColor>{oracleState.loading ? 'resolving oracle…' : ''}</Text>}
      <WriteForm
        focus={focus}
        onExit={onBack}
        fields={[{ key: 'qty', label: `qty ${quote.symbol}`, placeholder: formatDecimal(item.pos.quantity, quote.decimals) }]}
        values={values}
        setValue={setValue}
        canRun={ready}
        blockedReason={reason}
        actionLabel="dry-run · redeem"
        confirmMessage={`Redeem ${label} — qty ${values.qty}?`}
        buildTx={async () => {
          const plan = redeemTxPlan(item, qty ?? 0n, selectedManagerId ?? '', quote.coinType);
          return plan.kind === 'binary' ? buildRedeemTx(ctx, plan.args) : buildRedeemRangeTx(ctx, plan.args);
        }}
        renderPreview={
          <Text>
            preview payout:{' '}
            {payout !== null ? (
              <Text color="green">{formatDecimal(payout, quote.decimals)} {quote.symbol}</Text>
            ) : (
              <Text dimColor>{oracle?.lifecycle === Lifecycle.Settled ? 'settled — payout fixed at settlement' : 'enter qty'}</Text>
            )}
          </Text>
        }
      />
      <Text dimColor>esc · back to positions</Text>
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
