import { createContext } from '../client.js';
import { buildWithdrawTx } from '../ptb/withdraw.js';
import {
  dryRun,
  hasFlag,
  parseDecimalAmount,
  printOutcome,
  readFlag,
  resolveSender,
  sign,
} from './_cli.js';

const QUOTE_DECIMALS = 6;

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  if (hasFlag(argv, '--help') || argv.length === 0) {
    printHelp();
    return;
  }
  const human = readFlag(argv, '--amount');
  if (!human) throw new Error('missing --amount; example: --amount 50');
  const amount = parseDecimalAmount(human, QUOTE_DECIMALS);

  const ctx = createContext();
  const sender = await resolveSender(ctx, argv);
  const recipient = readFlag(argv, '--recipient') ?? sender;
  const tx = buildWithdrawTx(ctx, { amount, recipient });
  tx.setSender(sender);

  process.stdout.write(`withdraw ${human} DUSDC (= ${amount} raw)\n`);
  process.stdout.write(`  sender:    ${sender}\n`);
  process.stdout.write(`  recipient: ${recipient}\n`);
  process.stdout.write(`  manager:   ${ctx.config.MANAGER_OBJECT_ID}\n`);

  const dry = await dryRun(ctx, tx, sender);
  printOutcome(dry);
  if (!dry.success) return;

  if (hasFlag(argv, '--execute')) {
    const outcome = await sign(ctx, tx);
    printOutcome(outcome);
  } else {
    process.stdout.write('\n  (add --execute to actually sign and submit)\n');
  }
};

const printHelp = (): void => {
  process.stdout.write(
    `Usage:
  npm run withdraw -- --amount <human> [--recipient <addr>] [--execute]

Defaults:
  coin type: \${QUOTE_COIN_TYPE} from .env
  manager:   \${MANAGER_OBJECT_ID} from .env
  sender:    keypair-derived if PRIVATE_KEY set, else manager.owner from chain
  recipient: same as sender

Examples:
  npm run withdraw -- --amount 50              # dry-run only
  npm run withdraw -- --amount 50 --execute    # sign + submit
`,
  );
};

main().catch((err: unknown) => {
  process.stderr.write(`withdraw failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
