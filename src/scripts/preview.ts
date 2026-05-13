import { createContext, type Ctx } from '../client.js';
import { getOracle, Lifecycle, type OracleState } from '../lib/oracle.js';
import { decodeU64LittleEndian, devInspectReturnValues } from '../lib/view.js';
import { buildTradeAmountsPreviewTx } from '../ptb/mintBinary.js';
import { formatDecimal, hasFlag, parseDecimalAmount, readFlag, resolveSender } from './_cli.js';

const QUOTE_DECIMALS = 6n;
const PRICE_DECIMALS = 9n;

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  if (hasFlag(argv, '--help') || argv.length === 0) {
    printHelp();
    return;
  }

  const ctx = createContext();
  const sender = await resolveSender(ctx, argv);
  const oracleId = readFlag(argv, '--oracle') ?? ctx.config.ORACLE_OBJECT_ID;
  const oracle = await getOracle(ctx, oracleId);
  if (oracle.lifecycle !== Lifecycle.Active) {
    throw new Error(`oracle ${oracle.id} is ${oracle.lifecycle}; preview requires Active.`);
  }

  const strikes = parseStrikes(argv);
  const qty = parseDecimalAmount(readFlag(argv, '--qty') ?? '1', 6);

  printHeader(oracle, qty);

  process.stdout.write(
    `\nstrike      |   UP ask   UP bid  |  DOWN ask  DOWN bid  |  ask sum   spread (1-sum)\n`,
  );
  process.stdout.write(`${'-'.repeat(85)}\n`);

  for (const strike of strikes) {
    await previewRow(ctx, sender, oracle, strike, qty);
  }
};

const previewRow = async (
  ctx: Ctx,
  sender: string,
  oracle: OracleState,
  strike: bigint,
  qty: bigint,
): Promise<void> => {
  const [up, down] = await Promise.all([
    previewSafe(ctx, sender, oracle, strike, qty, true),
    previewSafe(ctx, sender, oracle, strike, qty, false),
  ]);
  const upAsk = up ? perUnit(up[0], qty) : null;
  const upBid = up ? perUnit(up[1], qty) : null;
  const downAsk = down ? perUnit(down[0], qty) : null;
  const downBid = down ? perUnit(down[1], qty) : null;
  const askSum = upAsk !== null && downAsk !== null ? upAsk + downAsk : null;
  const spreadE9 = askSum !== null ? 1_000_000_000n - askSum : null;

  const fmt = (v: bigint | null): string =>
    v === null ? '   —    ' : formatDecimal(v, PRICE_DECIMALS).padStart(8);

  process.stdout.write(
    `${formatDecimal(strike, PRICE_DECIMALS).padStart(8)}    |  ${fmt(upAsk)}  ${fmt(upBid)}   |  ${fmt(downAsk)}  ${fmt(downBid)}   |  ${fmt(askSum)}   ${fmt(spreadE9)}\n`,
  );
};

const previewSafe = async (
  ctx: Ctx,
  sender: string,
  oracle: OracleState,
  strike: bigint,
  qty: bigint,
  isUp: boolean,
): Promise<readonly [bigint, bigint] | null> => {
  try {
    const tx = buildTradeAmountsPreviewTx(ctx, {
      oracleId: oracle.id,
      expiryMs: oracle.expiryMs,
      strike,
      isUp,
      quantity: qty,
    });
    const [cost, payout] = await devInspectReturnValues(ctx, tx, sender);
    if (!cost || !payout) return null;
    return [decodeU64LittleEndian(cost), decodeU64LittleEndian(payout)];
  } catch {
    return null;
  }
};

/** Convert a 1e6-scaled cost back into a 1e9-scaled per-unit price. */
const perUnit = (costE6: bigint, qtyE6: bigint): bigint => (costE6 * 1_000_000_000n) / qtyE6;

const printHeader = (oracle: OracleState, qty: bigint): void => {
  process.stdout.write(`\n=== preview pairs ===\n`);
  process.stdout.write(`  oracle:     ${oracle.id}\n`);
  process.stdout.write(`  underlying: ${oracle.underlyingAsset}\n`);
  process.stdout.write(`  spot:       ${formatDecimal(oracle.spot, PRICE_DECIMALS)}\n`);
  process.stdout.write(`  forward:    ${formatDecimal(oracle.forward, PRICE_DECIMALS)}\n`);
  process.stdout.write(`  expiry:     ${new Date(Number(oracle.expiryMs)).toISOString()}\n`);
  process.stdout.write(`  qty:        ${formatDecimal(qty, QUOTE_DECIMALS)} (raw ${qty})\n`);
};

const parseStrikes = (argv: ReadonlyArray<string>): readonly bigint[] => {
  const explicit = readFlag(argv, '--strikes');
  if (explicit) {
    return explicit.split(',').map((s) => parseDecimalAmount(s.trim(), 9));
  }
  const single = readFlag(argv, '--strike');
  if (single) return [parseDecimalAmount(single, 9)];
  throw new Error('pass --strike <K> or --strikes <K1,K2,K3,...>');
};

const printHelp = (): void => {
  process.stdout.write(
    `Usage:
  npm run preview -- --strikes <K1,K2,...>  [--qty <human>] [--oracle <id>]
  npm run preview -- --strike  <K>          [--qty <human>] [--oracle <id>]

  Prints UP and DOWN previews side-by-side. Each row shows ask/bid for both
  directions (1e9-scaled, $/contract) and the put-call sum + protocol spread.

Defaults:
  --qty 1
  --oracle ORACLE_OBJECT_ID from .env

Examples:
  npm run preview -- --strikes 79000,80000,80500,81000,82000
  npm run preview -- --strike 80500
`,
  );
};

main().catch((err: unknown) => {
  process.stderr.write(`preview failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
