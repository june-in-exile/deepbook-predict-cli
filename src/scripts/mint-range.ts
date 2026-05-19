import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { createContext, type Ctx } from '../client.js';
import { getManager, getQuoteBalance, type ManagerState } from '../lib/manager.js';
import { Lifecycle, type OracleState } from '../lib/oracle.js';
import { resolveOracle } from '../lib/oracle-pick.js';
import { resolveQuote, type Quote } from '../lib/quote.js';
import { decodeU64LittleEndian, devInspectReturnValues } from '../lib/view.js';
import {
  buildMintRangeTx,
  buildRangeTradeAmountsPreviewTx,
  type MintRangeArgs,
} from '../ptb/mintRange.js';
import {
  formatDecimal,
  hasFlag,
  parseDecimalAmount,
  printOutcome,
  readFlag,
  resolveSender,
  sign,
} from './_cli.js';

const PRICE_DECIMALS = 9n;

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  if (hasFlag(argv, '--help') || argv.length === 0) {
    printHelp();
    return;
  }

  const ctx = createContext();
  const quote = await resolveQuote(ctx, readFlag(argv, '--quote'));
  const args = parseArgs(argv, quote);
  const sender = await resolveSender(ctx, argv);

  const [manager, oracle] = await Promise.all([
    getManager(ctx),
    resolveOracle(ctx, args.oracleId),
  ]);
  assertOracleTradable(oracle);

  const mintArgs: MintRangeArgs = {
    oracleId: oracle.id,
    expiryMs: oracle.expiryMs,
    lower: args.lower,
    higher: args.higher,
    quantity: args.quantity,
    coinType: quote.coinType,
  };

  printSummary(oracle, manager, sender, mintArgs, quote);

  const [mintCost, redeemPayout] = await previewTradeAmounts(ctx, sender, mintArgs);
  printPreview(mintCost, redeemPayout, mintArgs.quantity, quote);

  const balance = await getQuoteBalance(ctx, manager, quote.coinType);
  process.stdout.write(`  manager balance:    ${formatDecimal(balance, quote.decimals)} ${quote.symbol} (raw ${balance})\n`);
  if (balance < mintCost) {
    process.stdout.write(
      `\n  ABORT: insufficient manager balance — need ${mintCost}, have ${balance}.\n` +
        `         Run \`deepbook-predict deposit --amount <enough> --execute\` first.\n`,
    );
    return;
  }

  const tx = buildMintRangeTx(ctx, mintArgs);
  tx.setSender(sender);

  const dry = await ctx.client.devInspectTransactionBlock({
    transactionBlock: tx,
    sender,
  });
  if (dry.effects.status.status !== 'success') {
    process.stdout.write(`\n  DEVINSPECT FAILED: ${dry.effects.status.error ?? 'unknown'}\n`);
    return;
  }
  process.stdout.write(`\n  dry-run: OK (gas estimate ${JSON.stringify(dry.effects.gasUsed)})\n`);

  if (!hasFlag(argv, '--execute')) {
    process.stdout.write('\n  (add --execute to actually sign and submit)\n');
    return;
  }

  if (!hasFlag(argv, '--yes')) {
    const ok = await confirm(`Sign and submit this mint for ${formatDecimal(mintCost, quote.decimals)} ${quote.symbol}?`);
    if (!ok) {
      process.stdout.write('  aborted by user.\n');
      return;
    }
  }

  const outcome = await sign(ctx, tx);
  printOutcome(outcome);
};

const assertOracleTradable = (oracle: OracleState): void => {
  if (oracle.lifecycle !== Lifecycle.Active) {
    throw new Error(
      `oracle ${oracle.id} is ${oracle.lifecycle}; mint requires Active. Pick a fresh oracle (deepbook-predict markets).`,
    );
  }
};

const previewTradeAmounts = async (
  ctx: Ctx,
  sender: string,
  args: MintRangeArgs,
): Promise<readonly [bigint, bigint]> => {
  const tx = buildRangeTradeAmountsPreviewTx(ctx, args);
  const [cost, payout] = await devInspectReturnValues(ctx, tx, sender);
  if (!cost || !payout) {
    throw new Error('predict::get_range_trade_amounts returned fewer than 2 values');
  }
  return [decodeU64LittleEndian(cost), decodeU64LittleEndian(payout)];
};

const printSummary = (
  oracle: OracleState,
  manager: ManagerState,
  sender: string,
  args: MintRangeArgs,
  quote: Quote,
): void => {
  const width = args.higher - args.lower;
  process.stdout.write(`\n=== mint range ===\n`);
  process.stdout.write(`  oracle:             ${oracle.id}\n`);
  process.stdout.write(`  underlying:         ${oracle.underlyingAsset}\n`);
  process.stdout.write(`  expiry (UTC):       ${new Date(Number(oracle.expiryMs)).toISOString()}\n`);
  process.stdout.write(`  spot:               ${formatDecimal(oracle.spot, PRICE_DECIMALS)}\n`);
  process.stdout.write(`  lower:              ${formatDecimal(args.lower, PRICE_DECIMALS)} (raw ${args.lower})\n`);
  process.stdout.write(`  higher:             ${formatDecimal(args.higher, PRICE_DECIMALS)} (raw ${args.higher})\n`);
  process.stdout.write(`  width:              ${formatDecimal(width, PRICE_DECIMALS)}\n`);
  process.stdout.write(`  quantity:           ${formatDecimal(args.quantity, quote.decimals)} ${quote.symbol} (raw ${args.quantity})\n`);
  process.stdout.write(`  manager:            ${manager.id}\n`);
  process.stdout.write(`  sender:             ${sender}\n`);
};

const printPreview = (mintCost: bigint, redeemPayout: bigint, quantity: bigint, quote: Quote): void => {
  process.stdout.write(`\n  cost (ask × qty):   ${formatDecimal(mintCost, quote.decimals)} ${quote.symbol} (raw ${mintCost})\n`);
  process.stdout.write(`  bid (instant sell): ${formatDecimal(redeemPayout, quote.decimals)} ${quote.symbol} (raw ${redeemPayout})\n`);
  if (quantity > 0n) {
    const askE9 = (mintCost * 1_000_000_000n) / quantity;
    const bidE9 = (redeemPayout * 1_000_000_000n) / quantity;
    process.stdout.write(`  implied ask:        ${formatDecimal(askE9, PRICE_DECIMALS)} per $1 contract\n`);
    process.stdout.write(`  implied bid:        ${formatDecimal(bidE9, PRICE_DECIMALS)} per $1 contract\n`);
  }
};

type ParsedArgs = Readonly<{
  oracleId?: string;
  lower: bigint;
  higher: bigint;
  quantity: bigint;
}>;

const parseArgs = (argv: ReadonlyArray<string>, quote: Quote): ParsedArgs => {
  const oracleId = readFlag(argv, '--oracle');
  const lowerRaw = readFlag(argv, '--lower');
  const higherRaw = readFlag(argv, '--higher');
  const qtyRaw = readFlag(argv, '--qty');
  if (!lowerRaw) throw new Error('missing --lower (e.g. --lower 80000)');
  if (!higherRaw) throw new Error('missing --higher (e.g. --higher 81000)');
  if (!qtyRaw) throw new Error('missing --qty (e.g. --qty 5 for $5 max payout)');
  const lower = parseDecimalAmount(lowerRaw, 9);
  const higher = parseDecimalAmount(higherRaw, 9);
  if (higher <= lower) {
    throw new Error(`--higher must be > --lower; got lower=${lowerRaw} higher=${higherRaw}`);
  }
  return {
    ...(oracleId ? { oracleId } : {}),
    lower,
    higher,
    quantity: parseDecimalAmount(qtyRaw, Number(quote.decimals)),
  };
};

const confirm = async (question: string): Promise<boolean> => {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(`\n  ${question} [y/N]: `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
};

const printHelp = (): void => {
  process.stdout.write(
    `Usage:
  deepbook-predict mint-range --lower <human> --higher <human> --qty <human> [--oracle <id>] [--execute] [--yes]

Defaults:
  --oracle auto-picked from indexer's active oracle (next to settle).
           Fails fast if the indexer is unreachable or has no active oracle —
           pass --oracle <id> to override.

Scaling:
  --lower / --higher   human dollars (e.g. 80000 = \$80,000), scaled to 1e9 raw
  --qty                human dollars of max payout (e.g. 5 = \$5), scaled to 1e6 raw

Examples:
  deepbook-predict mint-range --lower 80000 --higher 81000 --qty 5
  deepbook-predict mint-range --lower 80000 --higher 81000 --qty 5 --execute
  deepbook-predict mint-range --lower 80000 --higher 81000 --qty 5 --execute --yes  # skip confirm

Pre-flight checks:
  - oracle lifecycle must be Active
  - lower < higher (positive width)
  - manager DUSDC balance must cover the previewed mint cost
  - devInspect must succeed before signing
`,
  );
};

main().catch((err: unknown) => {
  process.stderr.write(`mint-range failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
