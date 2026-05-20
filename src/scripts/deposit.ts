import { createContext } from '../client.js';
import { resolveQuote } from '../lib/quote.js';
import { buildDepositTx } from '../ptb/deposit.js';
import {
  dryRun,
  hasFlag,
  parseDecimalAmount,
  printOutcome,
  readFlag,
  resolveManagerId,
  resolveSender,
  sign,
} from './_cli.js';

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  if (hasFlag(argv, '--help') || argv.length === 0) {
    printHelp();
    return;
  }
  const human = readFlag(argv, '--amount');
  if (!human) throw new Error('missing --amount; example: --amount 100');

  const ctx = await createContext();
  const quote = await resolveQuote(ctx, readFlag(argv, '--quote'));
  const amount = parseDecimalAmount(human, Number(quote.decimals));

  const sender = await resolveSender(ctx, argv);
  const managerId = await resolveManagerId(ctx, sender, argv);
  const tx = await buildDepositTx(ctx, { amount, sender, managerId, coinType: quote.coinType });
  tx.setSender(sender);

  process.stdout.write(`deposit ${human} ${quote.symbol} (= ${amount} raw)\n`);
  process.stdout.write(`  sender:  ${sender}\n`);
  process.stdout.write(`  manager: ${managerId}\n`);

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
  deepbook-predict deposit --amount <human> [--quote <symbol|type>] [--sender <addr>] [--manager <id>] [--execute]

Defaults:
  coin type: auto-resolved from chain accepted_quotes (override with --quote)
  manager:   auto-resolved from sender's owned PredictManagers (prompt if multiple; override with --manager)
  sender:    keypair-derived if PRIVATE_KEY set, else pass --sender <addr>

Examples:
  deepbook-predict deposit --amount 100             # dry-run only (devInspect)
  deepbook-predict deposit --amount 100 --execute   # sign + submit
`,
  );
};

main().catch((err: unknown) => {
  process.stderr.write(`deposit failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
