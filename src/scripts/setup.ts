import { Transaction } from '@mysten/sui/transactions';

import { createContext, type Ctx } from '../client.js';
import { getManager, getQuoteBalance } from '../lib/manager.js';
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
  managerExists: boolean;
  managerOwnedBySender: boolean;
  walletDusdcRaw: bigint;
  managerDusdcRaw: bigint;
  managerId: string | null;
}>;

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  if (hasFlag(argv, '--help')) {
    printHelp();
    return;
  }

  const ctx = createContext();
  const quote = await resolveQuote(ctx, readFlag(argv, '--quote'));
  const sender = await resolveSender(ctx, argv);

  process.stdout.write(`\n=== setup ===\n`);
  process.stdout.write(`  sender:  ${sender}\n`);
  process.stdout.write(`  network: ${ctx.config.RPC_URL}\n\n`);

  const status = await checkStatus(ctx, sender, quote);
  printStatus(ctx, status, quote);

  if (!status.managerExists) {
    if (!hasFlag(argv, '--create-manager')) {
      process.stdout.write(
        `\n  Manager ${ctx.config.MANAGER_OBJECT_ID} is not reachable.\n` +
          `  Rerun with --create-manager to call predict::create_manager,\n` +
          `  then put the new id in .env as MANAGER_OBJECT_ID.\n`,
      );
      printNextSteps(status, quote);
      return;
    }
    await createManager(ctx);
    return;
  }

  if (!status.managerOwnedBySender) {
    process.stdout.write(
      `\n  ABORT: the configured manager exists, but its owner does NOT match the sender.\n` +
        `        Either point .env at a manager you own, or use --create-manager.\n`,
    );
    return;
  }

  printNextSteps(status, quote);
};

const checkStatus = async (ctx: Ctx, sender: string, quote: Quote): Promise<Status> => {
  // Manager existence + ownership.
  let managerExists = false;
  let managerOwnedBySender = false;
  let managerDusdcRaw = 0n;
  let managerId: string | null = null;
  try {
    const m = await getManager(ctx);
    managerExists = true;
    managerId = m.id;
    managerOwnedBySender = m.owner.toLowerCase() === sender.toLowerCase();
    if (managerOwnedBySender) {
      managerDusdcRaw = await getQuoteBalance(ctx, m, quote.coinType);
    }
  } catch {
    managerExists = false;
  }

  // Wallet quote balance.
  const walletRes = await ctx.client.getBalance({
    owner: sender,
    coinType: quote.coinType,
  });
  const walletDusdcRaw = BigInt(walletRes.totalBalance);

  return Object.freeze({
    managerExists,
    managerOwnedBySender,
    walletDusdcRaw,
    managerDusdcRaw,
    managerId,
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
    `\n  Manager created. Read the new id from the explorer link above (Created Objects: PredictManager) and put it in .env as MANAGER_OBJECT_ID.\n`,
  );
};

const printStatus = (ctx: Ctx, s: Status, quote: Quote): void => {
  process.stdout.write(`  configured manager: ${ctx.config.MANAGER_OBJECT_ID}\n`);
  process.stdout.write(`  manager exists:     ${ok(s.managerExists)}\n`);
  if (s.managerExists) {
    process.stdout.write(`  owner matches:      ${ok(s.managerOwnedBySender)}\n`);
  }
  process.stdout.write(`  wallet ${quote.symbol}:       ${formatDecimal(s.walletDusdcRaw, quote.decimals)} (raw ${s.walletDusdcRaw})\n`);
  if (s.managerExists && s.managerOwnedBySender) {
    process.stdout.write(`  manager ${quote.symbol}:      ${formatDecimal(s.managerDusdcRaw, quote.decimals)} (raw ${s.managerDusdcRaw})\n`);
  }
};

const printNextSteps = (s: Status, quote: Quote): void => {
  process.stdout.write(`\n  --- readiness ---\n`);
  const checks: Array<readonly [boolean, string]> = [
    [s.managerExists && s.managerOwnedBySender, 'PredictManager ready'],
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
  if (s.managerDusdcRaw < LOW_BALANCE_THRESHOLD_RAW) {
    process.stdout.write(
      `\n  Next: deposit some ${quote.symbol} so trading can begin:\n` +
        `       deepbook-predict deposit --amount 100 --execute\n`,
    );
    return;
  }
  process.stdout.write(
    `\n  Ready to trade. Examples:\n` +
      `       deepbook-predict preview     --strike 80500 --qty 5\n` +
      `       deepbook-predict mint-binary --strike 80500 --qty 5 --direction up --execute\n` +
      `       deepbook-predict lp-supply   --amount 100 --execute\n` +
      `       deepbook-predict inspect\n`,
  );
};

const ok = (b: boolean): string => (b ? 'yes' : 'no');

const printHelp = (): void => {
  process.stdout.write(
    `Usage:
  deepbook-predict setup                       # check status, print readiness + next steps
  deepbook-predict setup --create-manager   # call predict::create_manager (only if no manager)

Idempotent: running setup multiple times reports the same state and never
creates a second manager, never auto-deposits.
`,
  );
};

main().catch((err: unknown) => {
  process.stderr.write(`setup failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
