import { createContext } from '../client.js';
import { buildDepositTx } from '../ptb/deposit.js';
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
  if (!human) throw new Error('missing --amount; example: --amount 100');
  const amount = parseDecimalAmount(human, QUOTE_DECIMALS);

  const ctx = createContext();
  const sender = await resolveSender(ctx, argv);
  const tx = await buildDepositTx(ctx, { amount, sender });
  tx.setSender(sender);

  process.stdout.write(`deposit ${human} DUSDC (= ${amount} raw)\n`);
  process.stdout.write(`  sender:  ${sender}\n`);
  process.stdout.write(`  manager: ${ctx.config.MANAGER_OBJECT_ID}\n`);

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
  npm run deposit -- --amount <human> [--sender <addr>] [--execute]

Defaults:
  coin type: \${QUOTE_COIN_TYPE} from .env
  manager:   \${MANAGER_OBJECT_ID} from .env
  sender:    keypair-derived if PRIVATE_KEY set, else manager.owner from chain

Examples:
  npm run deposit -- --amount 100             # dry-run only (devInspect)
  npm run deposit -- --amount 100 --execute   # sign + submit
`,
  );
};

main().catch((err: unknown) => {
  process.stderr.write(`deposit failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
