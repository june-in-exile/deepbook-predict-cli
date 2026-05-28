import { createContext, type Ctx } from '../client.js';
import { Lifecycle, type OracleState } from '../lib/oracle.js';
import { resolveOracle } from '../lib/oracle-pick.js';
import { resolveQuote, type Quote } from '../lib/quote.js';
import { decodeU64LittleEndian, devInspectReturnValues } from '../lib/view.js';
import { buildTradeAmountsPreviewTx } from '../ptb/mintBinary.js';
import { buildRangeTradeAmountsPreviewTx } from '../ptb/mintRange.js';
import { formatDecimal, hasFlag, parseDecimalAmount, readFlag, resolveSender } from './_cli.js';

const PRICE_DECIMALS = 9n;

type RangePair = Readonly<{ lower: bigint; higher: bigint }>;

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  if (hasFlag(argv, '--help') || argv.length === 0) {
    printHelp();
    return;
  }

  const ctx = await createContext();
  const quote = await resolveQuote(ctx, readFlag(argv, '--quote'));
  const sender = await resolveSender(ctx, argv);
  const oracles = await resolveOracles(ctx, argv);
  for (const o of oracles) {
    if (o.lifecycle !== Lifecycle.Active) {
      throw new Error(`oracle ${o.id} is ${o.lifecycle}; preview requires Active.`);
    }
  }

  const strikes = parseStrikes(argv);
  const ranges = parseRanges(argv);
  if (strikes.length === 0 && ranges.length === 0) {
    throw new Error('pass at least one of --strikes <K1,K2,...> or --ranges <L1-H1,L2-H2,...>');
  }
  const qty = parseDecimalAmount(readFlag(argv, '--qty') ?? '1', Number(quote.decimals));

  for (const oracle of oracles) {
    printHeader(oracle, qty, quote);

    if (strikes.length > 0) {
      process.stdout.write(`\n=== binary preview ===\n`);
      process.stdout.write(
        `\nstrike      |   UP ask   UP bid  |  DOWN ask  DOWN bid  |  ask sum   spread (1-sum)\n`,
      );
      process.stdout.write(`${'-'.repeat(85)}\n`);
      for (const strike of strikes) {
        await previewBinaryRow(ctx, sender, oracle, strike, qty);
      }
    }

    if (ranges.length > 0) {
      process.stdout.write(`\n=== range preview ===\n`);
      process.stdout.write(`\nlower       higher      width   |    ask         bid\n`);
      process.stdout.write(`${'-'.repeat(60)}\n`);
      for (const r of ranges) {
        await previewRangeRow(ctx, sender, oracle, r, qty);
      }
    }
  }
};

const resolveOracles = async (
  ctx: Ctx,
  argv: ReadonlyArray<string>,
): Promise<readonly OracleState[]> => {
  const multi = readFlag(argv, '--oracles');
  if (multi) {
    const ids = multi.split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) {
      throw new Error('--oracles is empty; pass at least one oracle id, e.g. --oracles 0xabc,0xdef');
    }
    return Promise.all(ids.map((id) => resolveOracle(ctx, id)));
  }
  return [await resolveOracle(ctx, readFlag(argv, '--oracle'))];
};

const previewBinaryRow = async (
  ctx: Ctx,
  sender: string,
  oracle: OracleState,
  strike: bigint,
  qty: bigint,
): Promise<void> => {
  const [up, down] = await Promise.all([
    previewBinarySafe(ctx, sender, oracle, strike, qty, true),
    previewBinarySafe(ctx, sender, oracle, strike, qty, false),
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

const previewBinarySafe = async (
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

const previewRangeRow = async (
  ctx: Ctx,
  sender: string,
  oracle: OracleState,
  r: RangePair,
  qty: bigint,
): Promise<void> => {
  const result = await previewRangeSafe(ctx, sender, oracle, r, qty);
  const ask = result ? perUnit(result[0], qty) : null;
  const bid = result ? perUnit(result[1], qty) : null;
  const width = r.higher - r.lower;

  const fmt = (v: bigint | null): string =>
    v === null ? '   —    ' : formatDecimal(v, PRICE_DECIMALS).padStart(8);

  process.stdout.write(
    `${formatDecimal(r.lower, PRICE_DECIMALS).padStart(8)}    ${formatDecimal(r.higher, PRICE_DECIMALS).padStart(8)}    ${formatDecimal(width, PRICE_DECIMALS).padStart(6)}  |  ${fmt(ask)}    ${fmt(bid)}\n`,
  );
};

const previewRangeSafe = async (
  ctx: Ctx,
  sender: string,
  oracle: OracleState,
  r: RangePair,
  qty: bigint,
): Promise<readonly [bigint, bigint] | null> => {
  try {
    const tx = buildRangeTradeAmountsPreviewTx(ctx, {
      oracleId: oracle.id,
      expiryMs: oracle.expiryMs,
      lower: r.lower,
      higher: r.higher,
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

const printHeader = (oracle: OracleState, qty: bigint, quote: Quote): void => {
  process.stdout.write(`\n=== preview ===\n`);
  process.stdout.write(`  oracle:     ${oracle.id}\n`);
  process.stdout.write(`  underlying: ${oracle.underlyingAsset}\n`);
  process.stdout.write(`  spot:       ${formatDecimal(oracle.spot, PRICE_DECIMALS)}\n`);
  process.stdout.write(`  forward:    ${formatDecimal(oracle.forward, PRICE_DECIMALS)}\n`);
  process.stdout.write(`  expiry:     ${new Date(Number(oracle.expiryMs)).toISOString()}\n`);
  process.stdout.write(`  qty:        ${formatDecimal(qty, quote.decimals)} ${quote.symbol} (raw ${qty})\n`);
};

const parseStrikes = (argv: ReadonlyArray<string>): readonly bigint[] => {
  const explicit = readFlag(argv, '--strikes');
  if (explicit) {
    return explicit.split(',').map((s) => parseDecimalAmount(s.trim(), 9));
  }
  const single = readFlag(argv, '--strike');
  if (single) return [parseDecimalAmount(single, 9)];
  return [];
};

const parseRanges = (argv: ReadonlyArray<string>): readonly RangePair[] => {
  const raw = readFlag(argv, '--ranges');
  if (!raw) return [];
  return raw.split(',').map((pair, i) => {
    const parts = pair.trim().split('-');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error(
        `--ranges entry ${i + 1} ("${pair}") must be "<lower>-<higher>", e.g. "80000-81000"`,
      );
    }
    const lower = parseDecimalAmount(parts[0], 9);
    const higher = parseDecimalAmount(parts[1], 9);
    if (higher <= lower) {
      throw new Error(`--ranges entry ${i + 1} ("${pair}") must have higher > lower`);
    }
    return Object.freeze({ lower, higher });
  });
};

const printHelp = (): void => {
  process.stdout.write(
    `Usage:
  deepbook-predict preview -- [--strikes <K1,K2,...>] [--ranges <L1-H1,L2-H2,...>]
                     [--qty <human>] [--oracle <id> | --oracles <id1,id2,...>]

  At least one of --strikes / --ranges is required. Both can be supplied;
  outputs two \`===\`-separated blocks (binary first, then range).

  Binary block: UP and DOWN ask/bid (1e9-scaled, \$/contract) plus
                put-call sum and protocol spread.
  Range block:  ask/bid per range (1e9-scaled, \$/contract) plus width.

Defaults:
  --qty 1
  --oracle  auto-picked from indexer's active oracle (next to settle).
            Fails fast if the indexer is unreachable or has no active oracle —
            pass --oracle <id> to override.
  --oracles compare multiple oracles in one run; emits one preview block per
            oracle id. Takes precedence over --oracle. All ids must be Active.
            Use \`npm run markets\` (or \`--active\` / \`--asc\`) to list candidate oracle ids.

Examples:
  deepbook-predict preview --strikes 79000,80000,80500,81000,82000
  deepbook-predict preview --ranges 79500-80500,80500-81500
  deepbook-predict preview --strikes 80000,80500 --ranges 79500-80500,80500-81500
  deepbook-predict preview --strikes 80000 --oracles 0xabc...,0xdef...
`,
  );
};

main().catch((err: unknown) => {
  process.stderr.write(`preview failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
