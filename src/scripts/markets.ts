import { createContext } from '../client.js';
import {
  findActiveOracles,
  listOracles,
  type OracleEntry,
} from '../lib/server.js';

const wantsJson = process.argv.includes('--json');
const args = process.argv.slice(2);
const filterAsset = readFlag(args, '--asset');
const limitFlag = readFlag(args, '--limit');
const activeOnly = args.includes('--active');
const noInteractive = args.includes('--no-interactive');
const startAsc = args.includes('--asc');
const explicitLimit = limitFlag !== undefined ? Number(limitFlag) : Infinity;
const PAGE_STEP = 20;
const HEADERS = ['oracle_id', 'asset', 'expiry (UTC)', 'in', 'status'] as const;

const main = async (): Promise<void> => {
  const ctx = await createContext();
  const oracles = await listOracles(ctx);
  const now = Date.now();
  const visible = activeOnly
    ? findActiveOracles(oracles, filterAsset ? { now, underlyingAsset: filterAsset } : { now })
    : (filterAsset ? oracles.filter((o) => o.underlying_asset === filterAsset) : oracles);
  const sorted = [...visible].sort((a, b) =>
    startAsc ? a.expiry - b.expiry : b.expiry - a.expiry,
  );

  if (wantsJson) {
    process.stdout.write(JSON.stringify(sorted, null, 2) + '\n');
    return;
  }

  const title = `${visible.length} ${activeOnly ? 'active' : 'total'} oracles${filterAsset ? ` (${filterAsset})` : ''}`;
  const interactive =
    !noInteractive &&
    process.stdin.isTTY &&
    process.stdout.isTTY &&
    sorted.length > PAGE_STEP;

  if (interactive) {
    await renderInteractive(sorted, now, title, !startAsc);
    return;
  }

  const limited = sorted.slice(0, explicitLimit);
  const showingNote = Number.isFinite(explicitLimit) ? ` (showing up to ${explicitLimit})` : '';
  process.stdout.write(`\n${title}${showingNote}:\n\n`);
  printTable(limited, now);
};

const printTable = (oracles: readonly OracleEntry[], now: number): void => {
  if (oracles.length === 0) {
    process.stdout.write('  (none)\n');
    return;
  }
  const rows = oracles.map((o) => formatRow(o, now));
  const widths = computeWidths(rows);
  process.stdout.write(formatLine([...HEADERS], widths) + '\n');
  process.stdout.write(formatLine(widths.map((w) => '-'.repeat(w)), widths) + '\n');
  for (const r of rows) {
    process.stdout.write(formatLine(r, widths) + '\n');
  }
};

const renderInteractive = (
  oracles: readonly OracleEntry[],
  now: number,
  title: string,
  initialDesc: boolean,
): Promise<void> => {
  const stdin = process.stdin;
  const stdout = process.stdout;
  let formatted = oracles.map((o) => formatRow(o, now));
  const widths = computeWidths(formatted);
  const headerLine = formatLine([...HEADERS], widths);
  const sepLine = formatLine(widths.map((w) => '-'.repeat(w)), widths);

  let offset = 0;
  let desc = initialDesc;
  const total = formatted.length;
  const RESERVED_LINES = 6;

  const pageSize = (): number => Math.max(5, (stdout.rows ?? 30) - RESERVED_LINES);
  const maxOffset = (): number => Math.max(0, total - pageSize());

  const render = (): void => {
    if (offset > maxOffset()) offset = maxOffset();
    if (offset < 0) offset = 0;
    const size = pageSize();
    stdout.write('\x1b[H\x1b[2J');
    stdout.write(`${title}\n\n`);
    stdout.write(headerLine + '\n');
    stdout.write(sepLine + '\n');
    for (const row of formatted.slice(offset, offset + size)) {
      stdout.write(formatLine(row, widths) + '\n');
    }
    const start = total === 0 ? 0 : offset + 1;
    const end = Math.min(offset + size, total);
    const arrow = desc ? '↓' : '↑';
    stdout.write(
      `\n${start}-${end} of ${total} · expiry ${arrow}  [↑/↓ j/k · Space/b ±${PAGE_STEP} · g/G top/bottom · r reverse · q quit]\n`,
    );
  };

  return new Promise<void>((resolve) => {
    let cleanedUp = false;
    const cleanup = (): void => {
      if (cleanedUp) return;
      cleanedUp = true;
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stdout.off('resize', render);
      stdout.write('\x1b[?25h\x1b[?1049l');
    };

    const onData = (chunk: string): void => {
      const key = chunk;
      const step = pageSize();
      if (key === 'q' || key === '\x03' || key === '\x1b') {
        cleanup();
        resolve();
        return;
      }
      if (key === '\x1b[A' || key === 'k') offset -= 1;
      else if (key === '\x1b[B' || key === 'j') offset += 1;
      else if (key === '\x1b[5~') offset -= step;
      else if (key === '\x1b[6~') offset += step;
      else if (key === ' ') offset += PAGE_STEP;
      // kitty keyboard protocol: shift+space = "32:2u"
      else if (key === '\x1b[32;2u' || key === 'b') offset -= PAGE_STEP;
      else if (key === 'g' || key === '\x1b[H') offset = 0;
      else if (key === 'G' || key === '\x1b[F') offset = total;
      else if (key === 'r') {
        desc = !desc;
        formatted = formatted.slice().reverse();
        offset = 0;
      } else return;
      render();
    };

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    stdout.write('\x1b[?1049h\x1b[?25l');
    process.once('exit', cleanup);
    stdout.on('resize', render);
    stdin.on('data', onData);
    render();
  });
};

const formatRow = (o: OracleEntry, now: number): readonly [string, string, string, string, string] => {
  const diffHours = (o.expiry - now) / 1000 / 3600;
  const diff = diffHours >= 0 ? `${diffHours.toFixed(1)}h` : `${(-diffHours).toFixed(1)}h ago`;
  return [
    o.oracle_id,
    o.underlying_asset,
    new Date(o.expiry).toISOString().replace('.000Z', 'Z'),
    diff,
    o.settlement_price !== null ? 'settled' : o.status,
  ];
};

const computeWidths = (rows: ReadonlyArray<readonly string[]>): readonly number[] =>
  HEADERS.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));

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
