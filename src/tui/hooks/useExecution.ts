import { useState } from 'react';
import type { Transaction } from '@mysten/sui/transactions';

import { dryRun, sign, waitForBalances, type ExecuteOutcome } from '../../scripts/_cli.js';
import type { useApp } from '../state/AppContext.js';

export type ExecPhase = 'idle' | 'working' | 'confirm' | 'done' | 'error';

export type Execution = Readonly<{
  phase: ExecPhase;
  dryOutcome: ExecuteOutcome | null;
  execOutcome: ExecuteOutcome | null;
  error: string | null;
  /** Build + devInspect. On success with signing available, advances to 'confirm';
   *  otherwise stops at 'done' showing the dry-run only. */
  start: (buildTx: () => Promise<Transaction>) => Promise<void>;
  /** Sign + submit the previously-built tx, then refresh app data. */
  confirm: () => Promise<void>;
  /** Abandon a pending confirmation, keeping the dry-run visible. */
  cancel: () => void;
  reset: () => void;
}>;

/**
 * Drives the shared write-action lifecycle. A single Transaction is built once
 * and reused for both the devInspect dry-run and the eventual signing — matching
 * the CLI scripts' behaviour.
 */
export const useExecution = (app: ReturnType<typeof useApp>): Execution => {
  const { ctx, sender, canSign, refresh } = app;
  const [phase, setPhase] = useState<ExecPhase>('idle');
  const [dryOutcome, setDry] = useState<ExecuteOutcome | null>(null);
  const [execOutcome, setExec] = useState<ExecuteOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tx, setTx] = useState<Transaction | null>(null);

  const start = async (buildTx: () => Promise<Transaction>): Promise<void> => {
    if (!sender) {
      setError('no sender available');
      setPhase('error');
      return;
    }
    setPhase('working');
    setError(null);
    setExec(null);
    setDry(null);
    try {
      const built = await buildTx();
      built.setSender(sender);
      const outcome = await dryRun(ctx, built, sender);
      setDry(outcome);
      setTx(built);
      if (outcome.success && canSign) setPhase('confirm');
      else setPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  };

  const confirm = async (): Promise<void> => {
    if (!tx || !sender) return;
    setPhase('working');
    try {
      // Snapshot wallet balances before signing so we know the exact post-trade
      // target for each affected coin, then wait for the lagging coin index to
      // report it — otherwise the refresh below reads stale wallet balances.
      const before = await ctx.client.getAllBalances({ owner: sender });
      const baseline = new Map(before.map((b) => [b.coinType, BigInt(b.totalBalance)]));
      const outcome = await sign(ctx, tx);
      if (outcome.success && outcome.mode === 'execute' && outcome.balanceChanges) {
        const expected = new Map(
          outcome.balanceChanges.map((c) => [c.coinType, (baseline.get(c.coinType) ?? 0n) + BigInt(c.amount)]),
        );
        await waitForBalances(ctx, sender, expected);
      }
      setExec(outcome);
      setPhase('done');
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  };

  const cancel = (): void => {
    setPhase('done');
  };

  const reset = (): void => {
    setPhase('idle');
    setDry(null);
    setExec(null);
    setError(null);
    setTx(null);
  };

  return { phase, dryOutcome, execOutcome, error, start, confirm, cancel, reset };
};
