import { Transaction } from '@mysten/sui/transactions';

import { createContext, type Ctx } from '../client.js';
import { findOwnedManagers, getManager, getQuoteBalance } from '../lib/manager.js';
import { resolveQuote, type Quote } from '../lib/quote.js';
import {
  formatDecimal,
  hasFlag,
  printOutcome,
  readFlag,
  resolveSender,
  sign,
} from './_cli.js';

const LOW_BALANCE_THRESHOLD_RAW = 10_000_000n; // $10

type Status = Readonly<{
  managerIds: readonly string[];
  walletDusdcRaw: bigint;
  managerDusdcRaw: bigint;
  pickedManagerId: string | null;
}>;

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  if (hasFlag(argv, '--help')) {
    printHelp();
    return;
  }

  const ctx = await createContext();
  const quote = await resolveQuote(ctx, readFlag(argv, '--quote'));
  const sender = await resolveSender(ctx, argv);

  process.stdout.write(`\n=== setup ===\n`);
  process.stdout.write(`  sender:  ${sender}\n`);
  process.stdout.write(`  network: ${ctx.config.RPC_URL}\n\n`);

  const status = await checkStatus(ctx, sender, quote);
  printStatus(status, quote);

  if (status.managerIds.length === 0) {
    if (!hasFlag(argv, '--create-manager')) {
      process.stdout.write(
        `\n  No PredictManager found for ${sender}.\n` +
          `  Rerun with --create-manager to call predict::create_manager.\n`,
      );
      printNextSteps(status, quote);
      return;
    }
    await createManager(ctx);
    return;
  }

  if (status.managerIds.length > 1) {
    process.stdout.write(
      `\n  NOTE: sender owns ${status.managerIds.length} PredictManagers. Trading commands will\n` +
        `        prompt to pick one, or pass --manager <id> to skip the prompt.\n`,
    );
  }

  printNextSteps(status, quote);
};

const checkStatus = async (ctx: Ctx, sender: string, quote: Quote): Promise<Status> => {
  const managerIds = await findOwnedManagers(ctx, sender);
  let managerDusdcRaw = 0n;
  let pickedManagerId: string | null = null;
  const [first] = managerIds;
  if (managerIds.length === 1 && first) {
    pickedManagerId = first;
    const m = await getManager(ctx, first);
    managerDusdcRaw = await getQuoteBalance(ctx, m, quote.coinType);
  }

  const walletRes = await ctx.client.getBalance({
    owner: sender,
    coinType: quote.coinType,
  });
  const walletDusdcRaw = BigInt(walletRes.totalBalance);

  return Object.freeze({
    managerIds,
    walletDusdcRaw,
    managerDusdcRaw,
    pickedManagerId,
  });
};

const createManager = async (ctx: Ctx): Promise<void> => {
  const tx = new Transaction();
  tx.moveCall({
    target: `${ctx.config.PACKAGE_ID}::predict::create_manager`,
    arguments: [],
  });
  process.stdout.write(`\n  Signing predict::create_manager…\n`);
  const outcome = await sign(ctx, tx);
  printOutcome(outcome);
  if (outcome.mode !== 'execute' || !outcome.success) return;
  process.stdout.write(
    `\n  Manager created. Subsequent commands will auto-detect it from your wallet.\n`,
  );
};

const printStatus = (s: Status, quote: Quote): void => {
  process.stdout.write(`  managers owned:     ${s.managerIds.length}\n`);
  s.managerIds.forEach((id, i) => {
    process.stdout.write(`    [${i + 1}] ${id}\n`);
  });
  process.stdout.write(`  wallet ${quote.symbol}:       ${formatDecimal(s.walletDusdcRaw, quote.decimals)} (raw ${s.walletDusdcRaw})\n`);
  if (s.pickedManagerId) {
    process.stdout.write(`  manager ${quote.symbol}:      ${formatDecimal(s.managerDusdcRaw, quote.decimals)} (raw ${s.managerDusdcRaw})\n`);
  }
};

const printNextSteps = (s: Status, quote: Quote): void => {
  process.stdout.write(`\n  --- readiness ---\n`);
  const checks: Array<readonly [boolean, string]> = [
    [s.managerIds.length > 0, 'PredictManager exists'],
    [s.walletDusdcRaw > 0n, `Wallet holds ${quote.symbol}`],
    [s.managerDusdcRaw >= LOW_BALANCE_THRESHOLD_RAW, 'Manager funded above $10'],
  ];
  for (const [pass, label] of checks) {
    process.stdout.write(`  ${pass ? '✓' : '✗'} ${label}\n`);
  }

  if (!s.walletDusdcRaw) {
    process.stdout.write(
      `\n  Need ${quote.symbol}: testnet has no faucet for ${quote.symbol}.\n` +
        `  Only the Mysten team can mint it. Options:\n` +
        `   - ask in the official DeepBook / Mysten Discord\n` +
        `   - request from the dusdc::dusdc deployer (see notes/day-02.md §3)\n` +
        `   - obtain from an active testnet trader (see /managers indexer)\n`,
    );
    return;
  }
  if (s.managerIds.length > 0 && s.managerDusdcRaw < LOW_BALANCE_THRESHOLD_RAW) {
    process.stdout.write(
      `\n  Next: deposit some ${quote.symbol} so trading can begin:\n` +
        `       deepbook-predict deposit --amount 100 --execute\n`,
    );
    return;
  }
  if (s.managerIds.length === 0) return;
  process.stdout.write(
    `\n  Ready to trade. Examples:\n` +
      `       deepbook-predict preview     --strike 80500 --qty 5\n` +
      `       deepbook-predict mint-binary --strike 80500 --qty 5 --direction up --execute\n` +
      `       deepbook-predict lp-supply   --amount 100 --execute\n` +
      `       deepbook-predict inspect\n`,
  );
};

const printHelp = (): void => {
  process.stdout.write(
    `Usage:
  deepbook-predict setup                    # check status, print readiness + next steps
  deepbook-predict setup --create-manager   # call predict::create_manager (only if no manager)

Idempotent: running setup multiple times reports the same state and never
creates a second manager, never auto-deposits. The PredictManager id is
auto-discovered from the sender's owned objects — no env var needed.
`,
  );
};

main().catch((err: unknown) => {
  process.stderr.write(`setup failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
