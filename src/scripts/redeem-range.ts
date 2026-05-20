import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { createContext, type Ctx } from '../client.js';
import {
  getManager,
  getRangePositionQty,
  listRangePositions,
  type ManagerState,
} from '../lib/manager.js';
import { getOracle, Lifecycle, type OracleState } from '../lib/oracle.js';
import { pickRangePositionOracle } from '../lib/oracle-pick.js';
import { resolveQuote, type Quote } from '../lib/quote.js';
import { decodeU64LittleEndian, devInspectReturnValues } from '../lib/view.js';
import { buildRangeTradeAmountsPreviewTx } from '../ptb/mintRange.js';
import { buildRedeemRangeTx, type RedeemRangeArgs } from '../ptb/redeemRange.js';
import {
  formatDecimal,
  hasFlag,
  parseDecimalAmount,
  printOutcome,
  readFlag,
  resolveManagerId,
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

  const ctx = await createContext();
  const quote = await resolveQuote(ctx, readFlag(argv, '--quote'));
  const args = parseArgs(argv, quote);
  const sender = await resolveSender(ctx, argv);
  const managerId = await resolveManagerId(ctx, sender, argv);

  const manager = await getManager(ctx, managerId);
  const oracle = await resolveRedeemOracle(ctx, manager, args);
  assertQuoteable(oracle);

  const redeemArgs: RedeemRangeArgs = {
    managerId,
    oracleId: oracle.id,
    expiryMs: oracle.expiryMs,
    lower: args.lower,
    higher: args.higher,
    quantity: args.quantity,
    coinType: quote.coinType,
  };

  printSummary(oracle, manager, sender, redeemArgs, quote);

  const owned = await getRangePositionQty(ctx, manager, redeemArgs);
  process.stdout.write(`  position owned:     ${owned} (raw)\n`);
  if (owned < args.quantity) {
    process.stdout.write(
      `\n  ABORT: position too small — owned ${owned}, asking to redeem ${args.quantity}.\n`,
    );
    return;
  }

  const previewedPayout = await previewPayout(ctx, sender, oracle, redeemArgs);
  process.stdout.write(
    `  preview payout:     ${formatDecimal(previewedPayout, quote.decimals)} ${quote.symbol} (raw ${previewedPayout})\n`,
  );
  if (oracle.lifecycle === Lifecycle.Settled) {
    const inRange =
      oracle.settlementPrice !== null &&
      oracle.settlementPrice >= args.lower &&
      oracle.settlementPrice <= args.higher;
    process.stdout.write(
      `  (oracle Settled — payout fixed: settlement ${inRange ? 'inside' : 'outside'} (lower, higher])\n`,
    );
  } else {
    process.stdout.write(`  (oracle Active — payout is current SVI bid, may move before execution)\n`);
  }

  const tx = buildRedeemRangeTx(ctx, redeemArgs);
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
 * range positions by matching (lower, higher). The position records its source
 * oracle id directly, so this avoids any indexer round-trip and works even when
 * the underlying oracle is already Settled.
 */
const resolveRedeemOracle = async (
  ctx: Ctx,
  manager: ManagerState,
  args: ParsedArgs,
): Promise<OracleState> => {
  if (args.oracleId) return getOracle(ctx, args.oracleId);
  const positions = await listRangePositions(ctx, manager);
  const match = pickRangePositionOracle(positions, args.lower, args.higher);
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

/**
 * Active oracles use the chain's get_range_trade_amounts. Settled oracles
 * compute payout client-side: (lower <= settlementPrice <= higher) ? qty : 0.
 * This matches the on-chain redeem-range behaviour for snapshotted prices.
 */
const previewPayout = async (
  ctx: Ctx,
  sender: string,
  oracle: OracleState,
  args: RedeemRangeArgs,
): Promise<bigint> => {
  if (oracle.lifecycle === Lifecycle.Settled) {
    if (oracle.settlementPrice === null) return 0n;
    return oracle.settlementPrice >= args.lower && oracle.settlementPrice <= args.higher
      ? args.quantity
      : 0n;
  }
  const tx = buildRangeTradeAmountsPreviewTx(ctx, args);
  const [, payout] = await devInspectReturnValues(ctx, tx, sender);
  if (!payout) throw new Error('predict::get_range_trade_amounts returned no payout value');
  return decodeU64LittleEndian(payout);
};

const printSummary = (
  oracle: OracleState,
  manager: ManagerState,
  sender: string,
  args: RedeemRangeArgs,
  quote: Quote,
): void => {
  const width = args.higher - args.lower;
  process.stdout.write(`\n=== redeem range ===\n`);
  process.stdout.write(`  oracle:             ${oracle.id}\n`);
  process.stdout.write(`  underlying:         ${oracle.underlyingAsset}\n`);
  process.stdout.write(`  lifecycle:          ${oracle.lifecycle}\n`);
  process.stdout.write(`  expiry (UTC):       ${new Date(Number(oracle.expiryMs)).toISOString()}\n`);
  if (oracle.lifecycle === Lifecycle.Settled && oracle.settlementPrice !== null) {
    process.stdout.write(`  settlement price:   ${formatDecimal(oracle.settlementPrice, PRICE_DECIMALS)}\n`);
  } else {
    process.stdout.write(`  spot:               ${formatDecimal(oracle.spot, PRICE_DECIMALS)}\n`);
  }
  process.stdout.write(`  lower:              ${formatDecimal(args.lower, PRICE_DECIMALS)} (raw ${args.lower})\n`);
  process.stdout.write(`  higher:             ${formatDecimal(args.higher, PRICE_DECIMALS)} (raw ${args.higher})\n`);
  process.stdout.write(`  width:              ${formatDecimal(width, PRICE_DECIMALS)}\n`);
  process.stdout.write(`  redeem quantity:    ${formatDecimal(args.quantity, quote.decimals)} ${quote.symbol} (raw ${args.quantity})\n`);
  process.stdout.write(`  manager:            ${manager.id}\n`);
  process.stdout.write(`  sender:             ${sender}\n`);
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
  if (!qtyRaw) throw new Error('missing --qty (e.g. --qty 5)');
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
  deepbook-predict redeem-range --lower <human> --higher <human> --qty <human> [--oracle <id>] [--execute] [--yes]

Defaults:
  --oracle auto-derived from your manager's matching range position (lower, higher).
           Pass --oracle <id> explicitly when multiple positions share the same
           (lower, higher) at different expiries, or to override the match.

Pre-flight gates:
  1. Oracle is Active or Settled (NOT Pending or Inactive)
  2. Manager owns >= --qty of the range position
  3. get_range_trade_amounts preview (Active) OR client-side settled payout calc
  4. devInspect of the actual redeem succeeds
  5. Interactive confirmation (skip with --yes)

Examples:
  deepbook-predict redeem-range --lower 80000 --higher 81000 --qty 5                # dry-run
  deepbook-predict redeem-range --lower 80000 --higher 81000 --qty 5 --execute      # sign
  deepbook-predict redeem-range --lower 80000 --higher 81000 --qty 5 --execute --yes
`,
  );
};

main().catch((err: unknown) => {
  process.stderr.write(`redeem-range failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
