import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { createContext, type Ctx } from '../client.js';
import { getManager, getQuoteBalance, type ManagerState } from '../lib/manager.js';
import { getOracle, Lifecycle, type OracleState } from '../lib/oracle.js';
import { decodeU64LittleEndian, devInspectReturnValues } from '../lib/view.js';
import {
  buildMintBinaryTx,
  buildTradeAmountsPreviewTx,
  type MintBinaryArgs,
} from '../ptb/mintBinary.js';
import {
  formatDecimal,
  hasFlag,
  parseDecimalAmount,
  printOutcome,
  readFlag,
  resolveSender,
  sign,
} from './_cli.js';

const QUOTE_DECIMALS = 6n;
const PRICE_DECIMALS = 9n;

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  if (hasFlag(argv, '--help') || argv.length === 0) {
    printHelp();
    return;
  }

  const args = parseArgs(argv);
  const ctx = createContext();
  const sender = await resolveSender(ctx, argv);

  const [manager, oracle] = await Promise.all([
    getManager(ctx),
    getOracle(ctx, args.oracleId ?? ctx.config.ORACLE_OBJECT_ID),
  ]);
  assertOracleTradable(oracle);

  const mintArgs: MintBinaryArgs = {
    oracleId: oracle.id,
    expiryMs: oracle.expiryMs,
    strike: args.strike,
    isUp: args.isUp,
    quantity: args.quantity,
  };

  printSummary(oracle, manager, sender, mintArgs);

  const [mintCost, redeemPayout] = await previewTradeAmounts(ctx, sender, mintArgs);
  printPreview(mintCost, redeemPayout, mintArgs.quantity);

  const balance = await getQuoteBalance(ctx, manager, ctx.config.QUOTE_COIN_TYPE);
  process.stdout.write(`  manager balance:    ${formatDecimal(balance, QUOTE_DECIMALS)} DUSDC (raw ${balance})\n`);
  if (balance < mintCost) {
    process.stdout.write(
      `\n  ABORT: insufficient manager balance — need ${mintCost}, have ${balance}.\n` +
        `         Run \`npm run deposit -- --amount <enough> --execute\` first.\n`,
    );
    return;
  }

  const tx = buildMintBinaryTx(ctx, mintArgs);
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
    const ok = await confirm(`Sign and submit this mint for ${formatDecimal(mintCost, QUOTE_DECIMALS)} DUSDC?`);
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
      `oracle ${oracle.id} is ${oracle.lifecycle}; mint requires Active. Pick a fresh oracle (npm run markets).`,
    );
  }
};

const previewTradeAmounts = async (
  ctx: Ctx,
  sender: string,
  args: MintBinaryArgs,
): Promise<readonly [bigint, bigint]> => {
  const tx = buildTradeAmountsPreviewTx(ctx, args);
  const [cost, payout] = await devInspectReturnValues(ctx, tx, sender);
  if (!cost || !payout) {
    throw new Error('predict::get_trade_amounts returned fewer than 2 values');
  }
  return [decodeU64LittleEndian(cost), decodeU64LittleEndian(payout)];
};

const printSummary = (
  oracle: OracleState,
  manager: ManagerState,
  sender: string,
  args: MintBinaryArgs,
): void => {
  process.stdout.write(`\n=== mint binary ${args.isUp ? 'UP' : 'DOWN'} ===\n`);
  process.stdout.write(`  oracle:             ${oracle.id}\n`);
  process.stdout.write(`  underlying:         ${oracle.underlyingAsset}\n`);
  process.stdout.write(`  expiry (UTC):       ${new Date(Number(oracle.expiryMs)).toISOString()}\n`);
  process.stdout.write(`  spot:               ${formatDecimal(oracle.spot, PRICE_DECIMALS)}\n`);
  process.stdout.write(`  strike:             ${formatDecimal(args.strike, PRICE_DECIMALS)} (raw ${args.strike})\n`);
  process.stdout.write(`  direction:          ${args.isUp ? 'UP   (settle > strike pays $1)' : 'DOWN (settle <= strike pays $1)'}\n`);
  process.stdout.write(`  quantity:           ${formatDecimal(args.quantity, QUOTE_DECIMALS)} (raw ${args.quantity})\n`);
  process.stdout.write(`  manager:            ${manager.id}\n`);
  process.stdout.write(`  sender:             ${sender}\n`);
};

const printPreview = (mintCost: bigint, redeemPayout: bigint, quantity: bigint): void => {
  process.stdout.write(`\n  cost (ask × qty):   ${formatDecimal(mintCost, QUOTE_DECIMALS)} DUSDC (raw ${mintCost})\n`);
  process.stdout.write(`  bid (instant sell): ${formatDecimal(redeemPayout, QUOTE_DECIMALS)} DUSDC (raw ${redeemPayout})\n`);
  // ask in 1e9 = (mintCost * 1e9) / quantity, both 1e6-scaled → ask_1e9
  if (quantity > 0n) {
    const askE9 = (mintCost * 1_000_000_000n) / quantity;
    const bidE9 = (redeemPayout * 1_000_000_000n) / quantity;
    process.stdout.write(`  implied ask:        ${formatDecimal(askE9, PRICE_DECIMALS)} per $1 contract\n`);
    process.stdout.write(`  implied bid:        ${formatDecimal(bidE9, PRICE_DECIMALS)} per $1 contract\n`);
  }
};

type ParsedArgs = Readonly<{
  oracleId?: string;
  strike: bigint;
  isUp: boolean;
  quantity: bigint;
}>;

const parseArgs = (argv: ReadonlyArray<string>): ParsedArgs => {
  const oracleId = readFlag(argv, '--oracle');
  const strikeRaw = readFlag(argv, '--strike');
  const qtyRaw = readFlag(argv, '--qty');
  const direction = readFlag(argv, '--direction');
  if (!strikeRaw) throw new Error('missing --strike (e.g. --strike 80000)');
  if (!qtyRaw) throw new Error('missing --qty (e.g. --qty 10 for $10 max payout)');
  if (direction !== 'up' && direction !== 'down') {
    throw new Error(`--direction must be "up" or "down"; got "${direction ?? '(none)'}"`);
  }
  return {
    ...(oracleId ? { oracleId } : {}),
    strike: parseDecimalAmount(strikeRaw, 9),
    isUp: direction === 'up',
    quantity: parseDecimalAmount(qtyRaw, 6),
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
  npm run mint-binary -- --strike <human> --qty <human> --direction <up|down> [--oracle <id>] [--execute] [--yes]

Defaults:
  --oracle defaults to ORACLE_OBJECT_ID from .env

Scaling:
  --strike  human dollars (e.g. 80000 = \$80,000), scaled to 1e9 raw
  --qty     human dollars of max payout (e.g. 10 = \$10), scaled to 1e6 raw

Examples:
  npm run mint-binary -- --strike 80000 --qty 5 --direction up
  npm run mint-binary -- --strike 80000 --qty 5 --direction up --execute
  npm run mint-binary -- --strike 80000 --qty 5 --direction up --execute --yes  # skip confirm

Pre-flight checks:
  - oracle lifecycle must be Active
  - manager DUSDC balance must cover the previewed mint cost
  - devInspect must succeed before signing
`,
  );
};

main().catch((err: unknown) => {
  process.stderr.write(`mint-binary failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
