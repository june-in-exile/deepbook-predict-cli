import { createContext } from '../client.js';
import { getPredict, type PredictState } from '../lib/predict.js';

const wantsJson = process.argv.includes('--json');

const main = async (): Promise<void> => {
  const ctx = createContext();
  const predict = await getPredict(ctx);
  if (wantsJson) {
    process.stdout.write(JSON.stringify(predict, jsonReplacer, 2) + '\n');
    return;
  }
  render(predict);
};

const render = (p: PredictState): void => {
  section('Predict', [
    ['id', p.id],
    ['trading_paused', String(p.tradingPaused)],
  ]);

  section('TreasuryConfig — accepted quotes', p.acceptedQuotes.map((q, i) => [`#${i + 1}`, q]));

  section('PricingConfig', flatten(p.pricingConfig));
  section('RiskConfig', flatten(p.riskConfig));
  section('OracleConfig', flatten(p.oracleConfig));
  section('Vault', flatten(p.vault));
  section('WithdrawalLimiter', flatten(p.withdrawalLimiter));
};

const section = (title: string, rows: ReadonlyArray<readonly [string, string]>): void => {
  process.stdout.write(`\n=== ${title} ===\n`);
  if (rows.length === 0) {
    process.stdout.write('  (empty)\n');
    return;
  }
  const width = Math.max(...rows.map(([k]) => k.length));
  for (const [k, v] of rows) {
    process.stdout.write(`  ${k.padEnd(width)}  ${v}\n`);
  }
};

const flatten = (
  obj: Record<string, unknown>,
  prefix = '',
): ReadonlyArray<readonly [string, string]> => {
  const out: Array<readonly [string, string]> = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && 'fields' in v) {
      out.push(...flatten((v as { fields: Record<string, unknown> }).fields, key));
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...flatten(v as Record<string, unknown>, key));
    } else if (Array.isArray(v)) {
      out.push([key, `[${v.length}]`]);
    } else {
      out.push([key, String(v)]);
    }
  }
  return out;
};

const jsonReplacer = (_key: string, value: unknown): unknown =>
  typeof value === 'bigint' ? value.toString() : value;

main().catch((err: unknown) => {
  process.stderr.write(`inspect failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
