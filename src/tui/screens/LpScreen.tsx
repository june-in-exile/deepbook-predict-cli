import React from 'react';
import { Box, Text } from 'ink';

import type { ScreenProps } from '../App.js';
import { useApp } from '../state/AppContext.js';
import { useAsync } from '../hooks/useAsync.js';
import { useTabs } from '../hooks/useTabs.js';
import { useValues } from '../hooks/useValues.js';
import { Tabs } from '../components/Tabs.js';
import { WriteForm } from '../components/WriteForm.js';
import { Async } from '../components/Async.js';
import { formatDecimal, parseDecimalAmount } from '../../scripts/_cli.js';
import { PLP_DECIMALS } from '../format.js';
import { getPredict, type PredictState } from '../../lib/predict.js';
import { buildLpSupplyTx } from '../../ptb/lpSupply.js';
import { buildLpWithdrawTx } from '../../ptb/lpWithdraw.js';

const tryParse = (human: string, decimals: number): bigint | null => {
  try {
    return parseDecimalAmount(human, decimals);
  } catch {
    return null;
  }
};

const sharesMinted = (amount: bigint, p: PredictState): bigint => {
  if (p.plpTotalSupply === 0n) return amount;
  if (p.vaultValue === 0n) return 0n;
  return (amount * p.plpTotalSupply) / p.vaultValue;
};

const sharesToAmount = (shares: bigint, p: PredictState): bigint => {
  if (shares === 0n || p.plpTotalSupply === 0n) return 0n;
  if (p.plpTotalSupply === shares) return p.vaultValue;
  return (shares * p.vaultValue) / p.plpTotalSupply;
};

export const LpScreen = ({ focus, onExit }: ScreenProps): React.ReactElement => {
  const app = useApp();
  const { ctx, quote, sender, canSign, refreshNonce } = app;
  const [tab] = useTabs(2, focus);
  const predictState = useAsync(() => getPredict(ctx), [refreshNonce]);

  const blocked = canSign ? undefined : 'set PRIVATE_KEY to sign';

  return (
    <Box flexDirection="column">
      <Tabs labels={['Supply', 'Withdraw']} index={tab} focus={focus} />
      <Async state={predictState} loadingLabel="loading vault…">
        {(p) =>
          tab === 0 ? <SupplyTab focus={focus} onExit={onExit} p={p} /> : <WithdrawTab focus={focus} onExit={onExit} p={p} />
        }
      </Async>
      <VaultSummary state={predictState.value} quoteSymbol={quote.symbol} decimals={quote.decimals} />
      {!sender ? <Text color="red">no sender</Text> : null}
      {blocked ? <Text dimColor>{blocked}</Text> : null}
    </Box>
  );
};

const VaultSummary = ({
  state,
  quoteSymbol,
  decimals,
}: {
  state: PredictState | null;
  quoteSymbol: string;
  decimals: bigint;
}): React.ReactElement | null => {
  if (!state) return null;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>
        vault value {formatDecimal(state.vaultValue, decimals, { groupThousands: true })} {quoteSymbol} · balance{' '}
        {formatDecimal(state.vaultBalance, decimals, { groupThousands: true })} · PLP supply{' '}
        {formatDecimal(state.plpTotalSupply, PLP_DECIMALS, { groupThousands: true })}
      </Text>
    </Box>
  );
};

const SupplyTab = ({ focus, onExit, p }: ScreenProps & { p: PredictState }): React.ReactElement => {
  const { ctx, quote, sender, canSign } = useApp();
  const { values, setValue } = useValues({ amount: '' });
  const amount = tryParse(values.amount ?? '', Number(quote.decimals));
  const preview =
    amount !== null && amount > 0n ? sharesMinted(amount, p) : null;

  return (
    <WriteForm
      focus={focus}
      onExit={onExit}
      fields={[{ key: 'amount', label: `amount ${quote.symbol}`, placeholder: '100' }]}
      values={values}
      setValue={setValue}
      canRun={canSign && sender !== null}
      blockedReason={canSign ? '' : 'read-only'}
      actionLabel="dry-run · supply"
      confirmMessage={`Supply ${values.amount} ${quote.symbol} for ~${preview !== null ? formatDecimal(preview, PLP_DECIMALS) : '?'} PLP?`}
      buildTx={() =>
        buildLpSupplyTx(ctx, { amount: amount ?? 0n, sender: sender ?? '', coinType: quote.coinType })
      }
      renderPreview={
        <Text>
          preview shares:{' '}
          {preview !== null ? (
            <Text color="green">{formatDecimal(preview, PLP_DECIMALS)} PLP</Text>
          ) : (
            <Text dimColor>enter an amount</Text>
          )}
          {p.plpTotalSupply === 0n ? <Text dimColor>  (first supplier — 1:1)</Text> : null}
        </Text>
      }
    />
  );
};

const WithdrawTab = ({ focus, onExit, p }: ScreenProps & { p: PredictState }): React.ReactElement => {
  const { ctx, quote, sender, canSign } = useApp();
  const { values, setValue } = useValues({ shares: '' });
  const shares = tryParse(values.shares ?? '', Number(PLP_DECIMALS));
  const available = p.vaultBalance > p.vaultTotalMaxPayout ? p.vaultBalance - p.vaultTotalMaxPayout : 0n;
  const amountOut = shares !== null && shares > 0n ? sharesToAmount(shares, p) : null;
  const exceeds = amountOut !== null && amountOut > available;

  return (
    <WriteForm
      focus={focus}
      onExit={onExit}
      fields={[{ key: 'shares', label: 'shares PLP', placeholder: '50' }]}
      values={values}
      setValue={setValue}
      canRun={canSign && sender !== null && !exceeds}
      blockedReason={!canSign ? 'read-only' : exceeds ? 'exceeds available' : ''}
      actionLabel="dry-run · withdraw"
      confirmMessage={`Burn ${values.shares} PLP for ~${amountOut !== null ? formatDecimal(amountOut, quote.decimals) : '?'} ${quote.symbol}?`}
      buildTx={() =>
        buildLpWithdrawTx(ctx, { shares: shares ?? 0n, sender: sender ?? '', coinType: quote.coinType })
      }
      renderPreview={
        <Box flexDirection="column">
          <Text>
            preview out:{' '}
            {amountOut !== null ? (
              <Text color={exceeds ? 'red' : 'green'}>
                {formatDecimal(amountOut, quote.decimals)} {quote.symbol}
              </Text>
            ) : (
              <Text dimColor>enter shares</Text>
            )}
          </Text>
          <Text dimColor>
            available to withdraw {formatDecimal(available, quote.decimals)} {quote.symbol} (balance − max_payout)
          </Text>
          {exceeds ? <Text color="red">would exceed available — try fewer shares</Text> : null}
        </Box>
      }
    />
  );
};
