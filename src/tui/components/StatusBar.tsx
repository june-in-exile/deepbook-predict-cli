import React from 'react';
import { Box, Text } from 'ink';

import { formatDecimal } from '../../scripts/_cli.js';
import { getManager, getQuoteBalance } from '../../lib/manager.js';
import { getOracle } from '../../lib/oracle.js';
import { useApp } from '../state/AppContext.js';
import { useAsync } from '../hooks/useAsync.js';
import { PLP_DECIMALS, PRICE_DECIMALS, SUI_DECIMALS, formatTimeToExpiry, shortId } from '../format.js';

type HeaderData = Readonly<{
  walletQuote: bigint;
  walletPlp: bigint;
  walletSui: bigint;
  managerBalance: bigint | null;
  oracle: { asset: string; spot: bigint; expiryMs: bigint; lifecycle: string } | null;
}>;

const loadHeader = async (
  app: ReturnType<typeof useApp>,
): Promise<HeaderData> => {
  const { ctx, quote, sender, selectedManagerId, selectedOracleId } = app;
  const plpType = `${ctx.config.PACKAGE_ID}::plp::PLP`;
  const bal = async (coinType: string): Promise<bigint> => {
    if (!sender) return 0n;
    const r = await ctx.client.getBalance({ owner: sender, coinType });
    return BigInt(r.totalBalance);
  };

  const [walletQuote, walletPlp, walletSui, managerBalance, oracle] = await Promise.all([
    bal(quote.coinType),
    bal(plpType),
    bal('0x2::sui::SUI'),
    selectedManagerId
      ? getManager(ctx, selectedManagerId).then((m) => getQuoteBalance(ctx, m, quote.coinType))
      : Promise.resolve(null),
    selectedOracleId
      ? getOracle(ctx, selectedOracleId).then((o) => ({
          asset: o.underlyingAsset,
          spot: o.spot,
          expiryMs: o.expiryMs,
          lifecycle: o.lifecycle,
        }))
      : Promise.resolve(null),
  ]);

  return { walletQuote, walletPlp, walletSui, managerBalance, oracle };
};

export const StatusBar = (): React.ReactElement => {
  const app = useApp();
  const { ctx, quote, sender, canSign, selectedManagerId, selectedOracleId, refreshNonce } = app;
  const state = useAsync(
    () => loadHeader(app),
    [refreshNonce, sender, selectedManagerId, selectedOracleId],
  );
  const d = state.value;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color="cyanBright">
          deepbook-predict
        </Text>
        <Box>
          {canSign ? null : <Text color="yellow">READ-ONLY </Text>}
          <Text dimColor>{ctx.config.RPC_URL.replace(/^https?:\/\//, '')}</Text>
        </Box>
      </Box>

      <Text>
        <Text dimColor>wallet </Text>
        {sender ? shortId(sender) : <Text color="red">(no sender)</Text>}
        {d ? (
          <Text>
            {'  '}
            {quote.symbol} <Text color="green">{formatDecimal(d.walletQuote, quote.decimals)}</Text>
            {'  PLP '}
            {formatDecimal(d.walletPlp, PLP_DECIMALS)}
            {'  SUI '}
            {formatDecimal(d.walletSui, SUI_DECIMALS)}
          </Text>
        ) : (
          <Text dimColor>{state.error ? '  (load failed)' : '  …'}</Text>
        )}
      </Text>

      <Text>
        <Text dimColor>manager </Text>
        {selectedManagerId ? shortId(selectedManagerId) : <Text dimColor>none selected</Text>}
        {d && d.managerBalance !== null ? (
          <Text>
            {'  bal '}
            <Text color="green">{formatDecimal(d.managerBalance, quote.decimals)}</Text> {quote.symbol}
          </Text>
        ) : null}
      </Text>

      <Text>
        <Text dimColor>oracle </Text>
        {selectedOracleId ? (
          d && d.oracle ? (
            <Text>
              {shortId(selectedOracleId)} {d.oracle.asset} spot{' '}
              {formatDecimal(d.oracle.spot, PRICE_DECIMALS)} exp{' '}
              {formatTimeToExpiry(Number(d.oracle.expiryMs), Date.now())}{' '}
              <Text color={d.oracle.lifecycle === 'Active' ? 'green' : 'yellow'}>{d.oracle.lifecycle}</Text>
            </Text>
          ) : (
            <Text>{shortId(selectedOracleId)} <Text dimColor>…</Text></Text>
          )
        ) : (
          <Text dimColor>none selected — pick one in Markets</Text>
        )}
      </Text>
    </Box>
  );
};
