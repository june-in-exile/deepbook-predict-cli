import React, { useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { Transaction } from '@mysten/sui/transactions';

import type { ScreenProps } from '../App.js';
import { SECTIONS } from '../sections.js';
import { useApp } from '../state/AppContext.js';
import { useAsync } from '../hooks/useAsync.js';
import { useTabs } from '../hooks/useTabs.js';
import { useValues } from '../hooks/useValues.js';
import { Tabs } from '../components/Tabs.js';
import { Async } from '../components/Async.js';
import { Select } from '../components/Select.js';
import { WriteForm } from '../components/WriteForm.js';
import { formatDecimal, parseDecimalAmount } from '../../scripts/_cli.js';
import { PLP_DECIMALS, PRICE_DECIMALS, SUI_DECIMALS, formatUtc, shortId } from '../format.js';
import {
  findOwnedManagers,
  getManager,
  getQuoteBalance,
  listBinaryPositions,
  listRangePositions,
  type Position,
  type RangePosition,
} from '../../lib/manager.js';
import { getOracle, type OracleState } from '../../lib/oracle.js';
import { getPredict, type PredictState } from '../../lib/predict.js';
import { buildDepositTx } from '../../ptb/deposit.js';
import { buildWithdrawTx } from '../../ptb/withdraw.js';

const LOW_BALANCE_THRESHOLD_RAW = 10_000_000n;

export const AccountScreen = ({ focus, onExit }: ScreenProps): React.ReactElement => {
  const [tab] = useTabs(3, focus);
  return (
    <Box flexDirection="column">
      <Tabs labels={['Overview', 'Deposit', 'Withdraw']} index={tab} focus={focus} />
      {tab === 0 ? <Overview focus={focus} onExit={onExit} /> : null}
      {tab === 1 ? <DepositTab focus={focus} onExit={onExit} /> : null}
      {tab === 2 ? <WithdrawTab focus={focus} onExit={onExit} /> : null}
    </Box>
  );
};

type OverviewData = Readonly<{
  predict: PredictState;
  managers: readonly string[];
  manager: { id: string; owner: string; balance: bigint; bin: readonly Position[]; range: readonly RangePosition[] } | null;
  wallet: { quote: bigint; plp: bigint; sui: bigint };
  oracle: OracleState | null;
}>;

const loadOverview = async (app: ReturnType<typeof useApp>): Promise<OverviewData> => {
  const { ctx, quote, sender, selectedManagerId, selectedOracleId } = app;
  const owner = sender ?? '';
  const plpType = `${ctx.config.PACKAGE_ID}::plp::PLP`;
  const bal = async (coinType: string): Promise<bigint> =>
    owner ? BigInt((await ctx.client.getBalance({ owner, coinType })).totalBalance) : 0n;

  const [predict, managers, walletQuote, walletPlp, walletSui, oracle] = await Promise.all([
    getPredict(ctx),
    owner ? findOwnedManagers(ctx, owner) : Promise.resolve([] as readonly string[]),
    bal(quote.coinType),
    bal(plpType),
    bal('0x2::sui::SUI'),
    selectedOracleId ? getOracle(ctx, selectedOracleId) : Promise.resolve(null),
  ]);

  let manager: OverviewData['manager'] = null;
  if (selectedManagerId) {
    const m = await getManager(ctx, selectedManagerId);
    const [balance, bin, range] = await Promise.all([
      getQuoteBalance(ctx, m, quote.coinType),
      listBinaryPositions(ctx, m),
      listRangePositions(ctx, m),
    ]);
    manager = { id: m.id, owner: m.owner, balance, bin, range };
  }

  return { predict, managers, manager, wallet: { quote: walletQuote, plp: walletPlp, sui: walletSui }, oracle };
};

const Check = ({ ok, label }: { ok: boolean; label: string }): React.ReactElement => (
  <Text>
    <Text color={ok ? 'green' : 'red'}>{ok ? '✓' : '✗'}</Text> {label}
  </Text>
);

/**
 * Fixed rows around the scrolling Overview body so the frame fits the terminal —
 * a frame taller than the viewport can't be cleared by Ink and piles up stale
 * copies. StatusBar (6) + content border (2) + scroll footer (1) + app footer (1)
 * = 10, plus one spare against resizes. The floor is `SECTIONS.length` so the
 * frame fills the sidebar-pinned height instead of painting blank rows beneath.
 */
const CHROME_ROWS = 11;

export const accountPageSize = (rows: number): number =>
  Math.max(SECTIONS.length, rows - CHROME_ROWS);

type Quote = ReturnType<typeof useApp>['quote'];

/**
 * Flatten the read-only Overview into short, single-row lines (long stat lines
 * are split so they never wrap and defeat the row-budget). Used only once a
 * manager is selected, when every block — including the position list — is text.
 */
const inspectLines = (d: OverviewData, quote: Quote): React.ReactElement[] => {
  const dec = { groupThousands: true };
  const lines: React.ReactElement[] = [
    <Text bold>Readiness</Text>,
    <Check ok={d.managers.length > 0} label="PredictManager exists" />,
    <Check ok={d.wallet.quote > 0n} label={`Wallet holds ${quote.symbol}`} />,
    <Check ok={(d.manager?.balance ?? 0n) >= LOW_BALANCE_THRESHOLD_RAW} label="Manager funded above $10" />,
    <Text bold>Predict</Text>,
    <Text dimColor>
      paused {String(d.predict.tradingPaused)} · accepted quotes {d.predict.acceptedQuotes.length}
    </Text>,
    <Text dimColor>
      vault value {formatDecimal(d.predict.vaultValue, quote.decimals, dec)} · balance{' '}
      {formatDecimal(d.predict.vaultBalance, quote.decimals, dec)}
    </Text>,
    <Text dimColor>
      MTM {formatDecimal(d.predict.vaultMtm, quote.decimals, dec)} · max_payout{' '}
      {formatDecimal(d.predict.vaultTotalMaxPayout, quote.decimals, dec)}
    </Text>,
    <Text dimColor>PLP supply {formatDecimal(d.predict.plpTotalSupply, PLP_DECIMALS, dec)}</Text>,
  ];

  if (d.manager) {
    const m = d.manager;
    lines.push(
      <Text bold>Manager</Text>,
      <Text dimColor>id    {m.id}</Text>,
      <Text dimColor>owner {m.owner}</Text>,
      <Text dimColor>
        binary {m.bin.length} · range {m.range.length}
      </Text>,
      ...m.bin.map((p) => (
        <Text dimColor>
          {'  '}
          {p.isUp ? 'UP  ' : 'DOWN'} strike {formatDecimal(p.strike, PRICE_DECIMALS)} qty {String(p.quantity)} exp{' '}
          {formatUtc(p.expiryMs)}
        </Text>
      )),
      ...m.range.map((p) => (
        <Text dimColor>
          {'  '}({formatDecimal(p.lowerStrike, PRICE_DECIMALS)} .. {formatDecimal(p.higherStrike, PRICE_DECIMALS)}] qty{' '}
          {String(p.quantity)} exp {formatUtc(p.expiryMs)}
        </Text>
      )),
    );
  }

  lines.push(
    <Text bold>Wallet</Text>,
    <Text dimColor>
      {quote.symbol} {formatDecimal(d.wallet.quote, quote.decimals, dec)} · PLP{' '}
      {formatDecimal(d.wallet.plp, PLP_DECIMALS, dec)} · SUI {formatDecimal(d.wallet.sui, SUI_DECIMALS, dec)}
    </Text>,
  );

  if (d.oracle) {
    lines.push(
      <Text bold>Selected oracle</Text>,
      <Text dimColor>
        {shortId(d.oracle.id)} {d.oracle.underlyingAsset} {d.oracle.lifecycle} · spot{' '}
        {formatDecimal(d.oracle.spot, PRICE_DECIMALS)} · expiry {formatUtc(d.oracle.expiryMs)}
      </Text>,
    );
  }

  return lines;
};

/** Windowed, scrollable render of the read-only Overview once a manager is selected. */
const InspectBody = ({
  lines,
  focus,
  onExit,
}: {
  lines: readonly React.ReactElement[];
  focus: boolean;
  onExit: () => void;
}): React.ReactElement => {
  const { stdout } = useStdout();
  const [offset, setOffset] = useState(0);

  const total = lines.length;
  const pageSize = accountPageSize(stdout?.rows ?? 30);
  const maxOffset = Math.max(0, total - pageSize);
  const clamped = Math.min(offset, maxOffset);
  const window = lines.slice(clamped, clamped + pageSize);

  useInput(
    (input, key) => {
      if (key.escape) return onExit();
      if (key.upArrow || input === 'k') setOffset((o) => Math.max(0, o - 1));
      else if (key.downArrow || input === 'j') setOffset((o) => Math.min(maxOffset, o + 1));
      else if (input === ' ') setOffset((o) => Math.min(maxOffset, o + pageSize));
      else if (input === 'b') setOffset((o) => Math.max(0, o - pageSize));
      else if (input === 'g') setOffset(0);
      else if (input === 'G') setOffset(maxOffset);
    },
    { isActive: focus },
  );

  return (
    <Box flexDirection="column">
      {window.map((node, i) => (
        <React.Fragment key={clamped + i}>{node}</React.Fragment>
      ))}
      <Text dimColor>
        {total === 0 ? 0 : clamped + 1}-{Math.min(clamped + pageSize, total)} of {total} · ↑/↓ j/k · space/b page · g/G
      </Text>
    </Box>
  );
};

const Overview = ({ focus, onExit }: ScreenProps): React.ReactElement => {
  const app = useApp();
  const { ctx, quote, canSign, selectedManagerId, setSelectedManagerId, refreshNonce } = app;
  const state = useAsync(() => loadOverview(app), [refreshNonce, app.sender, selectedManagerId, app.selectedOracleId]);

  // Esc handled here whenever the manager picker / create action isn't the active control.
  useInput(
    (_input, key) => {
      if (key.escape) onExit();
    },
    { isActive: focus },
  );

  return (
    <Async state={state} loadingLabel="loading account…">
      {(d) =>
        // Manager selected ⇒ every block (incl. positions) is read-only text, which
        // can outgrow the viewport — render it scrollable. Otherwise the manager
        // picker / create form is the active control and the layout stays bounded.
        d.manager ? (
          <InspectBody lines={inspectLines(d, quote)} focus={focus} onExit={onExit} />
        ) : (
          <Box flexDirection="column">
            <Text bold>Readiness</Text>
            <Check ok={d.managers.length > 0} label="PredictManager exists" />
            <Check ok={d.wallet.quote > 0n} label={`Wallet holds ${quote.symbol}`} />
            <Check ok={false} label="Manager funded above $10" />

            <Box marginTop={1} flexDirection="column">
              <Text bold>Predict</Text>
              <Text dimColor>
                paused {String(d.predict.tradingPaused)} · vault value{' '}
                {formatDecimal(d.predict.vaultValue, quote.decimals, { groupThousands: true })} · balance{' '}
                {formatDecimal(d.predict.vaultBalance, quote.decimals, { groupThousands: true })} · MTM{' '}
                {formatDecimal(d.predict.vaultMtm, quote.decimals, { groupThousands: true })}
              </Text>
              <Text dimColor>
                max_payout {formatDecimal(d.predict.vaultTotalMaxPayout, quote.decimals, { groupThousands: true })} · PLP supply{' '}
                {formatDecimal(d.predict.plpTotalSupply, PLP_DECIMALS, { groupThousands: true })} · accepted quotes{' '}
                {d.predict.acceptedQuotes.length}
              </Text>
            </Box>

            <Box marginTop={1} flexDirection="column">
              <Text bold>Manager</Text>
              <ManagerBlock
                data={d}
                focus={focus}
                selectedManagerId={selectedManagerId}
                onSelect={setSelectedManagerId}
                canSign={canSign}
                ctx={ctx}
                onExit={onExit}
              />
            </Box>

            <Box marginTop={1} flexDirection="column">
              <Text bold>Wallet</Text>
              <Text dimColor>
                {quote.symbol} {formatDecimal(d.wallet.quote, quote.decimals, { groupThousands: true })} · PLP{' '}
                {formatDecimal(d.wallet.plp, PLP_DECIMALS, { groupThousands: true })} · SUI{' '}
                {formatDecimal(d.wallet.sui, SUI_DECIMALS, { groupThousands: true })}
              </Text>
            </Box>

            {d.oracle ? (
              <Box marginTop={1} flexDirection="column">
                <Text bold>Selected oracle</Text>
                <Text dimColor>
                  {shortId(d.oracle.id)} {d.oracle.underlyingAsset} {d.oracle.lifecycle} · spot{' '}
                  {formatDecimal(d.oracle.spot, PRICE_DECIMALS)} · expiry {formatUtc(d.oracle.expiryMs)}
                </Text>
              </Box>
            ) : null}
          </Box>
        )
      }
    </Async>
  );
};

const ManagerBlock = ({
  data,
  focus,
  selectedManagerId,
  onSelect,
  canSign,
  ctx,
  onExit,
}: {
  data: OverviewData;
  focus: boolean;
  selectedManagerId: string | null;
  onSelect: (id: string) => void;
  canSign: boolean;
  ctx: ReturnType<typeof useApp>['ctx'];
  onExit: () => void;
}): React.ReactElement => {
  if (data.manager) {
    const m = data.manager;
    return (
      <Box flexDirection="column">
        <Text dimColor>id    {m.id}</Text>
        <Text dimColor>owner {m.owner}</Text>
        <Text dimColor>binary {m.bin.length} · range {m.range.length}</Text>
        {m.bin.map((p, i) => (
          <Text key={`b${i}`} dimColor>
            {'  '}
            {p.isUp ? 'UP  ' : 'DOWN'} strike {formatDecimal(p.strike, PRICE_DECIMALS)} qty {String(p.quantity)} exp {formatUtc(p.expiryMs)}
          </Text>
        ))}
        {m.range.map((p, i) => (
          <Text key={`r${i}`} dimColor>
            {'  '}({formatDecimal(p.lowerStrike, PRICE_DECIMALS)} .. {formatDecimal(p.higherStrike, PRICE_DECIMALS)}] qty {String(p.quantity)} exp{' '}
            {formatUtc(p.expiryMs)}
          </Text>
        ))}
      </Box>
    );
  }

  if (data.managers.length > 0) {
    return (
      <Box flexDirection="column">
        <Text dimColor>select a manager:</Text>
        <Select
          items={data.managers.map((id) => ({ label: id, value: id }))}
          focus={focus}
          onSelect={(id) => onSelect(id)}
        />
      </Box>
    );
  }

  // No manager owned — offer to create one.
  return (
    <Box flexDirection="column">
      <Text color="yellow">No PredictManager owned by this address.</Text>
      <WriteForm
        focus={focus}
        onExit={onExit}
        fields={[]}
        values={{}}
        setValue={() => {}}
        canRun={canSign}
        blockedReason={canSign ? '' : 'read-only'}
        actionLabel="create manager"
        confirmMessage="Sign predict::create_manager?"
        buildTx={async () => {
          const tx = new Transaction();
          tx.moveCall({ target: `${ctx.config.PACKAGE_ID}::predict::create_manager`, arguments: [] });
          return tx;
        }}
      />
    </Box>
  );
};

const DepositTab = ({ focus, onExit }: ScreenProps): React.ReactElement => {
  const { ctx, quote, sender, canSign, selectedManagerId } = useApp();
  const { values, setValue } = useValues({ amount: '' });
  const ready = canSign && sender !== null && selectedManagerId !== null;
  const reason = !selectedManagerId ? 'no manager selected' : !canSign ? 'read-only' : '';
  return (
    <WriteForm
      focus={focus}
      onExit={onExit}
      fields={[{ key: 'amount', label: `amount ${quote.symbol}`, placeholder: '100' }]}
      values={values}
      setValue={setValue}
      canRun={ready}
      blockedReason={reason}
      actionLabel="dry-run · deposit"
      confirmMessage={`Deposit ${values.amount} ${quote.symbol} into the manager?`}
      buildTx={async () => {
        const amount = parseDecimalAmount(values.amount ?? '', Number(quote.decimals));
        return buildDepositTx(ctx, { amount, sender: sender ?? '', managerId: selectedManagerId ?? '', coinType: quote.coinType });
      }}
      renderPreview={<Text dimColor>splits {values.amount || '—'} {quote.symbol} from wallet into the manager</Text>}
    />
  );
};

const WithdrawTab = ({ focus, onExit }: ScreenProps): React.ReactElement => {
  const { ctx, quote, sender, canSign, selectedManagerId } = useApp();
  const { values, setValue } = useValues({ amount: '', recipient: '' });
  const ready = canSign && sender !== null && selectedManagerId !== null;
  const reason = !selectedManagerId ? 'no manager selected' : !canSign ? 'read-only' : '';
  return (
    <WriteForm
      focus={focus}
      onExit={onExit}
      fields={[
        { key: 'amount', label: `amount ${quote.symbol}`, placeholder: '50' },
        { key: 'recipient', label: 'recipient', placeholder: '(defaults to sender)' },
      ]}
      values={values}
      setValue={setValue}
      canRun={ready}
      blockedReason={reason}
      actionLabel="dry-run · withdraw"
      confirmMessage={`Withdraw ${values.amount} ${quote.symbol}?`}
      buildTx={async () => {
        const amount = parseDecimalAmount(values.amount ?? '', Number(quote.decimals));
        const recipient = (values.recipient ?? '').trim() || (sender ?? '');
        return buildWithdrawTx(ctx, { amount, recipient, managerId: selectedManagerId ?? '', coinType: quote.coinType });
      }}
      renderPreview={
        <Text dimColor>
          withdraws to {(values.recipient ?? '').trim() ? shortId((values.recipient ?? '').trim()) : 'sender'}
        </Text>
      }
    />
  );
};
