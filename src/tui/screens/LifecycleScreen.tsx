import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

import type { ScreenProps } from '../App.js';
import { useApp } from '../state/AppContext.js';
import { ActionRow } from '../components/Field.js';
import { ConfirmModal } from '../components/ConfirmModal.js';
import { formatDecimal, sign } from '../../scripts/_cli.js';
import { shortId, formatUtc, PRICE_DECIMALS } from '../format.js';
import { getManager, getPositionQty, getRangePositionQty } from '../../lib/manager.js';
import { getOracle, Lifecycle } from '../../lib/oracle.js';
import { findActiveOracles, listOracles } from '../../lib/server.js';
import { buildDepositTx } from '../../ptb/deposit.js';
import { buildMintBinaryTx } from '../../ptb/mintBinary.js';
import { buildMintRangeTx } from '../../ptb/mintRange.js';
import { buildRedeemTx } from '../../ptb/redeem.js';
import { buildRedeemRangeTx } from '../../ptb/redeemRange.js';
import { buildLpSupplyTx } from '../../ptb/lpSupply.js';
import { buildLpWithdrawTx } from '../../ptb/lpWithdraw.js';

const PARAMS = {
  depositRaw: 25_000_000n,
  mintQtyRaw: 1_000_000n,
  rangeWidthE9: 1_000_000_000_000n,
  lpSupplyRaw: 5_000_000n,
};

const roundStrike = (priceE9: bigint): bigint => {
  const tick = 500_000_000_000n;
  return ((priceE9 + tick / 2n) / tick) * tick;
};

type Step = Readonly<{ name: string; ok: boolean; note: string }>;
type Phase = 'idle' | 'confirm' | 'running' | 'done';

export const LifecycleScreen = ({ focus, onExit }: ScreenProps): React.ReactElement => {
  const app = useApp();
  const { ctx, quote, sender, canSign, selectedManagerId, refresh } = app;
  const [steps, setSteps] = useState<readonly Step[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');

  const ready = canSign && sender !== null && selectedManagerId !== null;
  const reason = !canSign ? 'read-only — set PRIVATE_KEY' : !selectedManagerId ? 'select a manager in Account' : '';

  useInput(
    (_input, key) => {
      if (key.escape) onExit();
      else if (key.return && phase === 'idle' && ready) setPhase('confirm');
    },
    { isActive: focus && phase !== 'confirm' },
  );

  const run = async (): Promise<void> => {
    setPhase('running');
    const results: Step[] = [];
    const push = (s: Step): void => {
      results.push(s);
      setSteps([...results]);
    };
    const addr = sender ?? '';
    const managerId = selectedManagerId ?? '';

    const signStep = async (name: string, build: () => Promise<import('@mysten/sui/transactions').Transaction>): Promise<boolean> => {
      try {
        const tx = await build();
        tx.setSender(addr);
        const outcome = await sign(ctx, tx);
        if (outcome.mode === 'execute' && outcome.success) {
          push({ name, ok: true, note: outcome.digest });
          return true;
        }
        push({ name, ok: false, note: ('error' in outcome ? outcome.error : '') ?? 'signing failed' });
        return false;
      } catch (e) {
        push({ name, ok: false, note: e instanceof Error ? e.message : String(e) });
        return false;
      }
    };

    try {
      // 1. preflight
      const manager = await getManager(ctx, managerId);
      if (manager.owner.toLowerCase() !== addr.toLowerCase()) {
        push({ name: '1. preflight', ok: false, note: `manager owner ${shortId(manager.owner)} != sender` });
        return setPhase('done');
      }
      const walletBal = BigInt((await ctx.client.getBalance({ owner: addr, coinType: quote.coinType })).totalBalance);
      if (walletBal < PARAMS.depositRaw) {
        push({ name: '1. preflight', ok: false, note: `wallet ${formatDecimal(walletBal, quote.decimals)} < ${formatDecimal(PARAMS.depositRaw, quote.decimals)}` });
        return setPhase('done');
      }
      push({ name: '1. preflight', ok: true, note: 'manager + wallet ready' });

      // 2. pick oracle
      const active = findActiveOracles(await listOracles(ctx), { underlyingAsset: 'BTC' });
      const longest = [...active].sort((a, b) => b.expiry - a.expiry)[0];
      if (!longest) {
        push({ name: '2. oracle pick', ok: false, note: 'no active BTC oracle' });
        return setPhase('done');
      }
      const oracle = await getOracle(ctx, longest.oracle_id);
      if (oracle.lifecycle !== Lifecycle.Active) {
        push({ name: '2. oracle pick', ok: false, note: `chain says ${oracle.lifecycle}` });
        return setPhase('done');
      }
      const strike = roundStrike(oracle.spot);
      const half = PARAMS.rangeWidthE9 / 2n;
      const lower = roundStrike(oracle.spot - half);
      const higher = roundStrike(oracle.spot + half);
      push({ name: '2. oracle pick', ok: true, note: `${shortId(longest.oracle_id)} strike=${formatDecimal(strike, PRICE_DECIMALS)} exp ${formatUtc(longest.expiry)}` });

      const c = quote.coinType;
      if (!(await signStep('3. deposit', async () => buildDepositTx(ctx, { amount: PARAMS.depositRaw, sender: addr, managerId, coinType: c })))) return setPhase('done');
      if (!(await signStep('4a. mint UP', async () => buildMintBinaryTx(ctx, { managerId, oracleId: oracle.id, expiryMs: oracle.expiryMs, strike, isUp: true, quantity: PARAMS.mintQtyRaw, coinType: c })))) return setPhase('done');
      if (!(await signStep('4b. mint DOWN', async () => buildMintBinaryTx(ctx, { managerId, oracleId: oracle.id, expiryMs: oracle.expiryMs, strike, isUp: false, quantity: PARAMS.mintQtyRaw, coinType: c })))) return setPhase('done');
      if (!(await signStep('4c. mint range', async () => buildMintRangeTx(ctx, { managerId, oracleId: oracle.id, expiryMs: oracle.expiryMs, lower, higher, quantity: PARAMS.mintQtyRaw, coinType: c })))) return setPhase('done');

      // 5. verify
      const [up, down, rng] = await Promise.all([
        getPositionQty(ctx, manager, { oracleId: oracle.id, expiryMs: oracle.expiryMs, strike, isUp: true }),
        getPositionQty(ctx, manager, { oracleId: oracle.id, expiryMs: oracle.expiryMs, strike, isUp: false }),
        getRangePositionQty(ctx, manager, { oracleId: oracle.id, expiryMs: oracle.expiryMs, lower, higher }),
      ]);
      const okVerify = up === PARAMS.mintQtyRaw && down === PARAMS.mintQtyRaw && rng === PARAMS.mintQtyRaw;
      push({ name: '5. verify positions', ok: okVerify, note: `UP=${up} DOWN=${down} RANGE=${rng}` });
      if (!okVerify) return setPhase('done');

      if (!(await signStep('6a. redeem UP', async () => buildRedeemTx(ctx, { managerId, oracleId: oracle.id, expiryMs: oracle.expiryMs, strike, isUp: true, quantity: PARAMS.mintQtyRaw, coinType: c })))) return setPhase('done');
      if (!(await signStep('6b. redeem DOWN', async () => buildRedeemTx(ctx, { managerId, oracleId: oracle.id, expiryMs: oracle.expiryMs, strike, isUp: false, quantity: PARAMS.mintQtyRaw, coinType: c })))) return setPhase('done');
      if (!(await signStep('6c. redeem range', async () => buildRedeemRangeTx(ctx, { managerId, oracleId: oracle.id, expiryMs: oracle.expiryMs, lower, higher, quantity: PARAMS.mintQtyRaw, coinType: c })))) return setPhase('done');

      if (!(await signStep('7a. lp-supply', async () => buildLpSupplyTx(ctx, { amount: PARAMS.lpSupplyRaw, sender: addr, coinType: c })))) return setPhase('done');
      const plp = BigInt((await ctx.client.getBalance({ owner: addr, coinType: `${ctx.config.PACKAGE_ID}::plp::PLP` })).totalBalance);
      const half2 = plp / 2n;
      await signStep('7b. lp-withdraw half', async () => buildLpWithdrawTx(ctx, { shares: half2, sender: addr, coinType: c }));
    } finally {
      refresh();
      setPhase('done');
    }
  };

  return (
    <Box flexDirection="column">
      <Text>Runs the full lifecycle: preflight → pick oracle → deposit → mint UP/DOWN/range → verify → redeem ×3 → lp supply/withdraw.</Text>
      <Text dimColor>each step is signed and submitted; the chain halts on first failure.</Text>
      <Box marginTop={1}>
        <ActionRow label={phase === 'running' ? 'running…' : 'run e2e'} focus={focus && phase === 'idle'} disabled={!ready} {...(ready ? {} : { note: reason })} />
      </Box>
      {phase === 'confirm' ? (
        <Box marginTop={1}>
          <ConfirmModal message="Sign and submit the full e2e lifecycle (multiple real transactions)?" focus={focus} onConfirm={() => void run()} onCancel={() => setPhase('idle')} />
        </Box>
      ) : null}
      {steps.length > 0 ? (
        <Box marginTop={1} flexDirection="column">
          {steps.map((s, i) => (
            <Text key={i}>
              <Text color={s.ok ? 'green' : 'red'}>{s.ok ? '✓' : '✗'}</Text> {s.name.padEnd(20)} <Text dimColor>{s.note}</Text>
            </Text>
          ))}
          {phase === 'done' ? (
            <Text color={steps.every((s) => s.ok) ? 'green' : 'red'}>
              {steps.every((s) => s.ok) ? 'ALL STEPS PASSED' : `${steps.filter((s) => !s.ok).length} step(s) failed`}
            </Text>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
};
