import { createContext } from '../client.js';
import {
  findActiveOracles,
  listOracles,
  type OracleEntry,
} from '../lib/server.js';

const wantsJson = process.argv.includes('--json');
const args = process.argv.slice(2);
const filterAsset = readFlag(args, '--asset');
const explicitLimit = Number(readFlag(args, '--limit') ?? 20);
const showAll = args.includes('--all');

const main = async (): Promise<void> => {
  const ctx = createContext();
  const oracles = await listOracles(ctx);
  const now = Date.now();
  const visible = showAll
    ? oracles
    : findActiveOracles(oracles, filterAsset ? { now, underlyingAsset: filterAsset } : { now });
  const sorted = [...visible].sort((a, b) => a.expiry - b.expiry);

  if (wantsJson) {
    process.stdout.write(JSON.stringify(sorted, null, 2) + '\n');
    return;
  }

  process.stdout.write(
    `\n${visible.length} ${showAll ? 'total' : 'active'} oracles${filterAsset ? ` (${filterAsset})` : ''} (showing up to ${explicitLimit}):\n\n`,
  );
  printTable(sorted.slice(0, explicitLimit), now);
};

const printTable = (oracles: readonly OracleEntry[], now: number): void => {
  if (oracles.length === 0) {
    process.stdout.write('  (none)\n');
    return;
  }
  const rows = oracles.map((o) => formatRow(o, now));
  const widths = computeWidths(rows);
  process.stdout.write(formatLine(['oracle_id', 'asset', 'expiry (UTC)', 'in', 'status'], widths) + '\n');
  process.stdout.write(formatLine(widths.map((w) => '-'.repeat(w)), widths) + '\n');
  for (const r of rows) {
    process.stdout.write(formatLine(r, widths) + '\n');
  }
};

const formatRow = (o: OracleEntry, now: number): readonly [string, string, string, string, string] => {
  const diffHours = (o.expiry - now) / 1000 / 3600;
  const diff = diffHours >= 0 ? `${diffHours.toFixed(1)}h` : `${(-diffHours).toFixed(1)}h ago`;
  return [
    shortenId(o.oracle_id),
    o.underlying_asset,
    new Date(o.expiry).toISOString().replace('.000Z', 'Z'),
    diff,
    o.settlement_price !== null ? 'settled' : o.status,
  ];
};

const shortenId = (id: string): string => `${id.slice(0, 10)}…${id.slice(-6)}`;

const computeWidths = (rows: ReadonlyArray<readonly string[]>): readonly number[] => {
  const headers = ['oracle_id', 'asset', 'expiry (UTC)', 'in', 'status'];
  return headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
};

const formatLine = (cells: readonly string[], widths: readonly number[]): string =>
  cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join('  ');

function readFlag(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i < 0 || i === argv.length - 1) return undefined;
  return argv[i + 1];
}

main().catch((err: unknown) => {
  process.stderr.write(`markets failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
