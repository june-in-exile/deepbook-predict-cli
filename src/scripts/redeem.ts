import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { createContext, type Ctx } from '../client.js';
import { getManager, getPositionQty, listBinaryPositions, type ManagerState } from '../lib/manager.js';
import { getOracle, Lifecycle, type OracleState } from '../lib/oracle.js';
import { pickPositionOracle } from '../lib/oracle-pick.js';
import { resolveQuote, type Quote } from '../lib/quote.js';
import { decodeU64LittleEndian, devInspectReturnValues } from '../lib/view.js';
import { buildRedeemTx, type RedeemArgs } from '../ptb/redeem.js';
import { buildTradeAmountsPreviewTx } from '../ptb/mintBinary.js';
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

  const manager = await getManager(ctx);
  const oracle = await resolveRedeemOracle(ctx, manager, args);
  assertQuoteable(oracle);

  const redeemArgs: RedeemArgs = {
    oracleId: oracle.id,
    expiryMs: oracle.expiryMs,
    strike: args.strike,
    isUp: args.isUp,
    quantity: args.quantity,
    coinType: quote.coinType,
  };

  printSummary(oracle, manager, sender, redeemArgs, quote);

  const owned = await getPositionQty(ctx, manager, redeemArgs);
  process.stdout.write(`  position owned:     ${owned} (raw)\n`);
  if (owned < args.quantity) {
    process.stdout.write(
      `\n  ABORT: position too small — owned ${owned}, asking to redeem ${args.quantity}.\n`,
    );
    return;
  }

  const previewedPayout = await previewPayout(ctx, sender, redeemArgs);
  process.stdout.write(
    `  preview payout:     ${formatDecimal(previewedPayout, quote.decimals)} ${quote.symbol} (raw ${previewedPayout})\n`,
  );
  if (oracle.lifecycle === Lifecycle.Settled) {
    process.stdout.write(`  (oracle Settled — payout fixed at settlement-price bid)\n`);
  } else {
    process.stdout.write(`  (oracle Active — payout is current SVI bid, may move before execution)\n`);
  }

  const tx = buildRedeemTx(ctx, redeemArgs);
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
    const ok = await confirm(`Sign and submit redeem for ~${formatDecimal(previewedPayout, quote.decimals)} ${quote.symbol}?`);
    if (!ok) {
      process.stdout.write('  aborted by user.\n');
      return;
    }
  }

  const outcome = await sign(ctx, tx);
  printOutcome(outcome);
};

/**
 * Explicit `--oracle <id>` wins. Otherwise derive the oracle from the manager's
 * binary positions by matching (strike, direction). The position records its
 * source oracle id directly, so this avoids any indexer round-trip and works
 * even when the underlying oracle is already Settled.
 */
const resolveRedeemOracle = async (
  ctx: Ctx,
  manager: ManagerState,
  args: ParsedArgs,
): Promise<OracleState> => {
  if (args.oracleId) return getOracle(ctx, args.oracleId);
  const positions = await listBinaryPositions(ctx, manager);
  const match = pickPositionOracle(positions, args.strike, args.isUp);
  return getOracle(ctx, match.oracleId);
};

const assertQuoteable = (oracle: OracleState): void => {
  if (oracle.lifecycle === Lifecycle.Settled) return;
  if (oracle.lifecycle === Lifecycle.Active) return;
  throw new Error(
    `oracle ${oracle.id} is ${oracle.lifecycle}; redeem requires Active or Settled. ` +
      `Pending-Settlement is the dead zone; wait for the post-expiry price push.`,
  );
};

const previewPayout = async (
  ctx: Ctx,
  sender: string,
  args: RedeemArgs,
): Promise<bigint> => {
  const tx = buildTradeAmountsPreviewTx(ctx, args);
  const [, payout] = await devInspectReturnValues(ctx, tx, sender);
  if (!payout) throw new Error('predict::get_trade_amounts returned no payout value');
  return decodeU64LittleEndian(payout);
};

const printSummary = (
  oracle: OracleState,
  manager: ManagerState,
  sender: string,
  args: RedeemArgs,
  quote: Quote,
): void => {
  process.stdout.write(`\n=== redeem binary ${args.isUp ? 'UP' : 'DOWN'} ===\n`);
  process.stdout.write(`  oracle:             ${oracle.id}\n`);
  process.stdout.write(`  underlying:         ${oracle.underlyingAsset}\n`);
  process.stdout.write(`  lifecycle:          ${oracle.lifecycle}\n`);
  process.stdout.write(`  expiry (UTC):       ${new Date(Number(oracle.expiryMs)).toISOString()}\n`);
  if (oracle.lifecycle === Lifecycle.Settled && oracle.settlementPrice !== null) {
    process.stdout.write(`  settlement price:   ${formatDecimal(oracle.settlementPrice, PRICE_DECIMALS)}\n`);
  } else {
    process.stdout.write(`  spot:               ${formatDecimal(oracle.spot, PRICE_DECIMALS)}\n`);
  }
  process.stdout.write(`  strike:             ${formatDecimal(args.strike, PRICE_DECIMALS)}\n`);
  process.stdout.write(`  direction:          ${args.isUp ? 'UP' : 'DOWN'}\n`);
  process.stdout.write(`  redeem quantity:    ${formatDecimal(args.quantity, quote.decimals)} ${quote.symbol} (raw ${args.quantity})\n`);
  process.stdout.write(`  manager:            ${manager.id}\n`);
  process.stdout.write(`  sender:             ${sender}\n`);
};

type ParsedArgs = Readonly<{
  oracleId?: string;
  strike: bigint;
  isUp: boolean;
  quantity: bigint;
}>;

const parseArgs = (argv: ReadonlyArray<string>, quote: Quote): ParsedArgs => {
  const oracleId = readFlag(argv, '--oracle');
  const strikeRaw = readFlag(argv, '--strike');
  const qtyRaw = readFlag(argv, '--qty');
  const direction = readFlag(argv, '--direction');
  if (!strikeRaw) throw new Error('missing --strike (e.g. --strike 80000)');
  if (!qtyRaw) throw new Error('missing --qty (e.g. --qty 5)');
  if (direction !== 'up' && direction !== 'down') {
    throw new Error(`--direction must be "up" or "down"; got "${direction ?? '(none)'}"`);
  }
  return {
    ...(oracleId ? { oracleId } : {}),
    strike: parseDecimalAmount(strikeRaw, 9),
    isUp: direction === 'up',
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
  npm run redeem -- --strike <human> --qty <human> --direction <up|down> [--oracle <id>] [--execute] [--yes]

Defaults:
  --oracle auto-derived from your manager's matching position (strike, direction).
           Pass --oracle <id> explicitly when multiple positions share the same
           strike/direction at different expiries, or to override the match.

Pre-flight gates:
  1. Oracle is Active or Settled (NOT Pending or Inactive)
  2. Manager owns >= --qty of the position
  3. get_trade_amounts preview returns a payout
  4. devInspect of the actual redeem succeeds
  5. Interactive confirmation (skip with --yes)

Examples:
  npm run redeem -- --strike 80500 --qty 5 --direction up                # dry-run
  npm run redeem -- --strike 80500 --qty 5 --direction up --execute      # sign
  npm run redeem -- --strike 80500 --qty 5 --direction up --execute --yes
`,
  );
};

main().catch((err: unknown) => {
  process.stderr.write(`redeem failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
