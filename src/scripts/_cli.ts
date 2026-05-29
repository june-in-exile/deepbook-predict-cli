import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import type { Transaction } from '@mysten/sui/transactions';

import type { Ctx } from '../client.js';
import { requireKeypair } from '../client.js';
import { findOwnedManagers } from '../lib/manager.js';

export type Argv = ReadonlyArray<string>;

export const readFlag = (argv: Argv, name: string): string | undefined => {
  const i = argv.indexOf(name);
  if (i < 0 || i === argv.length - 1) return undefined;
  return argv[i + 1];
};

export const hasFlag = (argv: Argv, name: string): boolean => argv.includes(name);

/**
 * Parse a decimal-formatted human amount (e.g. "100", "100.5", "0.001")
 * into raw on-chain units, given the coin's decimal count.
 */
export const parseDecimalAmount = (human: string, decimals: number): bigint => {
  if (!/^\d+(\.\d+)?$/.test(human)) {
    throw new Error(`amount must be a decimal number like "100" or "0.5"; got "${human}"`);
  }
  const [whole, frac = ''] = human.split('.');
  const padded = frac.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(whole ?? '0') * 10n ** BigInt(decimals) + BigInt(padded || '0');
};

export const formatDecimal = (
  raw: bigint,
  decimals: bigint,
  opts: { groupThousands?: boolean } = {},
): string => {
  const sign = raw < 0n ? '-' : '';
  const abs = raw < 0n ? -raw : raw;
  const divisor = 10n ** decimals;
  const whole = abs / divisor;
  const frac = abs % divisor;
  const wholeStr = opts.groupThousands ? insertThousands(whole.toString()) : whole.toString();
  if (frac === 0n) return `${sign}${wholeStr}`;
  return `${sign}${wholeStr}.${frac.toString().padStart(Number(decimals), '0').replace(/0+$/, '')}`;
};

const insertThousands = (s: string): string => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * Resolve the sender address using, in order:
 *   1. --sender CLI flag
 *   2. PRIVATE_KEY in .env (derived address)
 *
 * Throws when neither is present — the manager id is auto-resolved from
 * the sender's owned objects, so we need the sender first.
 */
export const resolveSender = async (ctx: Ctx, argv: Argv): Promise<string> => {
  const flag = readFlag(argv, '--sender');
  if (flag) return flag;
  if (ctx.config.PRIVATE_KEY) {
    return requireKeypair(ctx.config).getPublicKey().toSuiAddress();
  }
  throw new Error(
    'no sender available — set PRIVATE_KEY in .env (sui keytool export) or pass --sender <addr>.',
  );
};

/**
 * Resolve the PredictManager id, in order:
 *   1. --manager <id> CLI flag (explicit override)
 *   2. The single PredictManager owned by `sender`
 *   3. Interactive prompt when sender owns multiple
 *
 * Non-TTY callers with multiple managers must pass --manager explicitly;
 * we refuse to silently pick one. Callers with zero managers get pointed
 * at `setup --create-manager`.
 */
export const resolveManagerId = async (
  ctx: Ctx,
  sender: string,
  argv: Argv,
): Promise<string> => {
  const flag = readFlag(argv, '--manager');
  if (flag) return flag;

  const ids = await findOwnedManagers(ctx, sender);
  if (ids.length === 0) {
    throw new Error(
      `no PredictManager owned by ${sender}. Run \`deepbook-predict setup --create-manager\` first.`,
    );
  }
  const [only] = ids;
  if (ids.length === 1 && only) return only;

  if (!stdin.isTTY) {
    throw new Error(
      `sender ${sender} owns ${ids.length} PredictManagers; pass --manager <id> to pick one explicitly.\n` +
        ids.map((id) => `  - ${id}`).join('\n'),
    );
  }
  return pickManagerInteractively(ids);
};

const pickManagerInteractively = async (ids: readonly string[]): Promise<string> => {
  process.stdout.write(`\n  Sender owns ${ids.length} PredictManagers. Pick one:\n`);
  ids.forEach((id, i) => process.stdout.write(`    [${i + 1}] ${id}\n`));
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    while (true) {
      const answer = (await rl.question(`  Select [1-${ids.length}]: `)).trim();
      const n = Number(answer);
      if (Number.isInteger(n) && n >= 1 && n <= ids.length) {
        const picked = ids[n - 1];
        if (picked) return picked;
      }
      process.stdout.write(`  invalid selection "${answer}"; expected an integer in [1, ${ids.length}].\n`);
    }
  } finally {
    rl.close();
  }
};

export type ExecuteOutcome =
  | { mode: 'devInspect'; success: boolean; error?: string; gasUsed?: string }
  | { mode: 'execute'; digest: string; success: boolean; error?: string; balanceChanges?: ReadonlyArray<{ coinType: string; amount: string }> };

export const dryRun = async (
  ctx: Ctx,
  tx: Transaction,
  sender: string,
): Promise<ExecuteOutcome> => {
  const res = await ctx.client.devInspectTransactionBlock({
    transactionBlock: tx,
    sender,
  });
  const status = res.effects.status;
  return {
    mode: 'devInspect',
    success: status.status === 'success',
    ...(status.error ? { error: status.error } : {}),
    gasUsed: JSON.stringify(res.effects.gasUsed),
  };
};

export const sign = async (
  ctx: Ctx,
  tx: Transaction,
): Promise<ExecuteOutcome> => {
  const keypair = requireKeypair(ctx.config);
  const signerAddress = keypair.toSuiAddress();
  const res = await ctx.client.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    options: { showEffects: true, showBalanceChanges: true },
  });
  const status = res.effects?.status;
  // signAndExecuteTransaction returns once executed, but the full node we query
  // next for positions/balances may not have indexed this checkpoint yet. Wait
  // so any immediate read-after-write (e.g. the TUI's post-trade refresh) sees
  // the new state instead of stale data. Only meaningful on success.
  if (status?.status === 'success') {
    await ctx.client.waitForTransaction({ digest: res.digest });
  }
  return {
    mode: 'execute',
    digest: res.digest,
    success: status?.status === 'success',
    ...(status?.error ? { error: status.error } : {}),
    // Only the signer's own wallet changes — drops recipient deltas on a
    // withdraw-to-other so the post-trade balance wait targets the right wallet.
    balanceChanges: (res.balanceChanges ?? [])
      .filter((c) => typeof c.owner === 'object' && 'AddressOwner' in c.owner && c.owner.AddressOwner === signerAddress)
      .map((c) => ({ coinType: c.coinType, amount: c.amount })),
  };
};

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const BALANCE_SYNC_TIMEOUT_MS = 8000;
const BALANCE_SYNC_POLL_MS = 500;

/**
 * Poll `suix_getBalance` until each coin type reaches its expected post-trade
 * value. The coin index lags the object store on public RPC, so a read issued
 * immediately after a write can still report the pre-trade balance even though
 * the transaction is final. Resolves as soon as every coin matches; gives up
 * after the timeout so a stuck index never blocks the UI indefinitely.
 */
export const waitForBalances = async (
  ctx: Ctx,
  owner: string,
  expected: ReadonlyMap<string, bigint>,
  opts: { timeoutMs?: number; pollMs?: number } = {},
): Promise<void> => {
  const deadline = Date.now() + (opts.timeoutMs ?? BALANCE_SYNC_TIMEOUT_MS);
  const pollMs = opts.pollMs ?? BALANCE_SYNC_POLL_MS;
  const pending = new Set(expected.keys());
  while (pending.size > 0 && Date.now() < deadline) {
    await Promise.all(
      [...pending].map(async (coinType) => {
        const { totalBalance } = await ctx.client.getBalance({ owner, coinType });
        if (BigInt(totalBalance) === expected.get(coinType)) pending.delete(coinType);
      }),
    );
    if (pending.size > 0) await delay(pollMs);
  }
};

export const printOutcome = (outcome: ExecuteOutcome): void => {
  process.stdout.write(`\n=== ${outcome.mode === 'execute' ? 'execution' : 'dry-run (devInspect)'} ===\n`);
  process.stdout.write(`  success: ${outcome.success}\n`);
  if ('digest' in outcome) {
    process.stdout.write(`  digest:  ${outcome.digest}\n`);
    process.stdout.write(`  explorer: https://suiscan.xyz/testnet/tx/${outcome.digest}\n`);
  }
  if (outcome.error) {
    process.stdout.write(`  error:   ${outcome.error}\n`);
  }
  if ('gasUsed' in outcome && outcome.gasUsed) {
    process.stdout.write(`  gas used (estimate): ${outcome.gasUsed}\n`);
  }
  if ('balanceChanges' in outcome && outcome.balanceChanges && outcome.balanceChanges.length > 0) {
    process.stdout.write(`  balance changes:\n`);
    for (const c of outcome.balanceChanges) {
      const short = c.coinType.length > 50 ? `${c.coinType.slice(0, 30)}…${c.coinType.slice(-15)}` : c.coinType;
      process.stdout.write(`    ${c.amount.padStart(20)}  ${short}\n`);
    }
  }
};
