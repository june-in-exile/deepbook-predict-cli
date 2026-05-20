import { createContext, type Ctx } from '../client.js';
import { formatDecimal, readFlag, resolveManagerId, resolveSender } from './_cli.js';
import {
  getManager,
  getQuoteBalance,
  listBinaryPositions,
  listRangePositions,
  type ManagerState,
  type Position,
  type RangePosition,
} from '../lib/manager.js';
import {
  type OracleState,
} from '../lib/oracle.js';
import { resolveOracle } from '../lib/oracle-pick.js';
import { getPredict, type PredictState } from '../lib/predict.js';
import { resolveQuote, type Quote } from '../lib/quote.js';

const wantsJson = process.argv.includes('--json');

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  const ctx = await createContext();
  const quote = await resolveQuote(ctx, readFlag(argv, '--quote'));
  const sender = await resolveSender(ctx, argv);
  const managerId = await resolveManagerId(ctx, sender, argv);
  const predict = await getPredict(ctx);
  const manager = await getManager(ctx, managerId);
  const [quoteBalance, binaryPositions, rangePositions, oracle, walletQuote, walletPlp, walletSui] = await Promise.all([
    getQuoteBalance(ctx, manager, quote.coinType),
    listBinaryPositions(ctx, manager),
    listRangePositions(ctx, manager),
    resolveOracle(ctx),
    walletCoinBalance(ctx, manager.owner, quote.coinType),
    walletCoinBalance(ctx, manager.owner, plpCoinType(ctx)),
    walletCoinBalance(ctx, manager.owner, '0x2::sui::SUI'),
  ]);

  if (wantsJson) {
    const payload = {
      predict,
      manager: { ...manager, quoteBalance, binaryPositions, rangePositions },
      oracle,
      wallet: {
        owner: manager.owner,
        quote: { symbol: quote.symbol, coinType: quote.coinType, amount: walletQuote.toString() },
        plp: walletPlp.toString(),
        sui: walletSui.toString(),
      },
    };
    process.stdout.write(JSON.stringify(payload, jsonReplacer, 2) + '\n');
    return;
  }

  renderPredict(predict);
  renderManager(manager, quoteBalance, binaryPositions, rangePositions, quote);
  renderOracle(oracle);
  renderWallet(manager.owner, walletQuote, walletPlp, walletSui, quote);
};

const walletCoinBalance = async (ctx: Ctx, owner: string, coinType: string): Promise<bigint> => {
  const res = await ctx.client.getBalance({ owner, coinType });
  return BigInt(res.totalBalance);
};

const plpCoinType = (ctx: Ctx): string => `${ctx.config.PACKAGE_ID}::plp::PLP`;

const renderWallet = (owner: string, quoteAmt: bigint, plp: bigint, sui: bigint, quote: Quote): void => {
  section('Wallet (manager owner)', [
    ['address', owner],
    ['SUI (gas)', formatDecimal(sui, 9n, { groupThousands: true })],
    [quote.symbol, formatDecimal(quoteAmt, quote.decimals, { groupThousands: true })],
    ['PLP', formatDecimal(plp, 6n, { groupThousands: true })],
  ]);
};

const renderPredict = (p: PredictState): void => {
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

const renderManager = (
  m: ManagerState,
  balance: bigint,
  bin: readonly Position[],
  rng: readonly RangePosition[],
  quote: Quote,
): void => {
  section('PredictManager', [
    ['id', m.id],
    ['owner', m.owner],
    ['balance_manager_id', m.balanceManagerId],
    ['quote_balance (raw)', balance.toString()],
    [`quote_balance (${quote.symbol})`, formatDecimal(balance, quote.decimals, { groupThousands: true })],
    ['binary_positions', String(bin.length)],
    ['range_positions', String(rng.length)],
  ]);
  if (bin.length > 0) {
    section(
      'PredictManager — binary positions',
      bin.map((p, i) => [
        `#${i + 1}`,
        `${p.isUp ? 'UP  ' : 'DOWN'} strike=${formatDecimal(p.strike, 9n)} expiry=${p.expiryMs} (${new Date(Number(p.expiryMs)).toISOString()}) qty=${p.quantity}`,
      ]),
    );
  }
  if (rng.length > 0) {
    section(
      'PredictManager — range positions',
      rng.map((p, i) => [
        `#${i + 1}`,
        `(${formatDecimal(p.lowerStrike, 9n)} .. ${formatDecimal(p.higherStrike, 9n)}] expiry=${p.expiryMs} (${new Date(Number(p.expiryMs)).toISOString()}) qty=${p.quantity}`,
      ]),
    );
  }
};

const renderOracle = (o: OracleState): void => {
  section('OracleSVI', [
    ['id', o.id],
    ['underlying_asset', o.underlyingAsset],
    ['lifecycle', o.lifecycle],
    ['active (flag)', String(o.active)],
    ['expiry_ms', o.expiryMs.toString()],
    ['expiry (UTC)', new Date(Number(o.expiryMs)).toISOString()],
    ['timestamp_ms', o.timestampMs.toString()],
    ['spot (price)', formatDecimal(o.spot, 9n, { groupThousands: true })],
    ['forward (price)', formatDecimal(o.forward, 9n, { groupThousands: true })],
    ['settlement_price', o.settlementPrice === null ? '(none)' : formatDecimal(o.settlementPrice, 9n, { groupThousands: true })],
    ['authorized_caps', String(o.authorizedCaps.length)],
  ]);
  section('OracleSVI — SVI params (all 1e9-scaled)', [
    ['a', o.svi.a.toString()],
    ['b', o.svi.b.toString()],
    ['rho', o.svi.rho.toString()],
    ['m', o.svi.m.toString()],
    ['sigma', o.svi.sigma.toString()],
  ]);
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
