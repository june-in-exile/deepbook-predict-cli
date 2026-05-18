import { createContext, type Ctx } from '../client.js';
import { getManager, getPositionQty, getRangePositionQty } from '../lib/manager.js';
import { resolveQuote } from '../lib/quote.js';
import { findActiveOracles, listOracles } from '../lib/server.js';
import { getOracle, Lifecycle } from '../lib/oracle.js';
import { buildDepositTx } from '../ptb/deposit.js';
import { buildLpSupplyTx } from '../ptb/lpSupply.js';
import { buildLpWithdrawTx } from '../ptb/lpWithdraw.js';
import { buildMintBinaryTx } from '../ptb/mintBinary.js';
import { buildMintRangeTx } from '../ptb/mintRange.js';
import { buildRedeemTx } from '../ptb/redeem.js';
import { buildRedeemRangeTx } from '../ptb/redeemRange.js';
import { formatDecimal, hasFlag, readFlag, resolveSender, sign } from './_cli.js';

const E2E_PARAMS = Object.freeze({
  depositRaw: 25_000_000n,        // $25 — funds binary UP + DOWN + range
  mintQtyRaw: 1_000_000n,         // $1 max payout per side
  rangeWidthE9: 1_000_000_000_000n, // $1,000 range width
  lpSupplyRaw: 5_000_000n,        // $5 of LP
  lpWithdrawFraction: 0.5,        // burn half the new PLP
});

type StepResult = Readonly<{ name: string; digest?: string; ok: boolean; note: string }>;

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  if (hasFlag(argv, '--help')) {
    printHelp();
    return;
  }

  const ctx = createContext();
  const quote = await resolveQuote(ctx, readFlag(argv, '--quote'));
  const sender = await resolveSender(ctx, argv);
  const results: StepResult[] = [];

  process.stdout.write(`\n=== e2e lifecycle ===\n  sender: ${sender}\n  quote:  ${quote.symbol}\n\n`);

  // 1. Preflight — must be ready
  process.stdout.write(`[1/7] preflight (manager exists, has owner, wallet has ${quote.symbol})…\n`);
  const manager = await getManager(ctx);
  if (manager.owner.toLowerCase() !== sender.toLowerCase()) {
    fail(results, '1. preflight', `manager owner ${manager.owner} != sender ${sender}`);
    return finish(results);
  }
  const walletBalance = BigInt(
    (await ctx.client.getBalance({ owner: sender, coinType: quote.coinType }))
      .totalBalance,
  );
  if (walletBalance < E2E_PARAMS.depositRaw) {
    fail(
      results,
      '1. preflight',
      `wallet has ${formatDecimal(walletBalance, quote.decimals)} ${quote.symbol}, need at least ${formatDecimal(E2E_PARAMS.depositRaw, quote.decimals)}`,
    );
    return finish(results);
  }
  results.push({ name: '1. preflight', ok: true, note: 'manager + wallet ready' });

  // 2. Pick a long-expiry Active oracle from the server
  process.stdout.write(`[2/7] pick oracle…\n`);
  const oracles = await listOracles(ctx);
  const active = findActiveOracles(oracles, { underlyingAsset: 'BTC' });
  const longest = [...active].sort((a, b) => b.expiry - a.expiry)[0];
  if (!longest) {
    fail(results, '2. oracle pick', 'no Active BTC oracle returned by the server');
    return finish(results);
  }
  const oracle = await getOracle(ctx, longest.oracle_id);
  if (oracle.lifecycle !== Lifecycle.Active) {
    fail(results, '2. oracle pick', `chain says oracle is ${oracle.lifecycle} (server said active)`);
    return finish(results);
  }
  const strike = roundStrike(oracle.spot);
  const halfWidth = E2E_PARAMS.rangeWidthE9 / 2n;
  const lower = roundStrike(oracle.spot - halfWidth);
  const higher = roundStrike(oracle.spot + halfWidth);
  results.push({
    name: '2. oracle pick',
    ok: true,
    note: `${longest.oracle_id.slice(0, 12)}…  spot=${formatDecimal(oracle.spot, 9n)}  strike=${formatDecimal(strike, 9n)}  range=(${formatDecimal(lower, 9n)}, ${formatDecimal(higher, 9n)}]  expiry=${new Date(longest.expiry).toISOString()}`,
  });

  // 3. Deposit
  await runStep(ctx, results, '3. deposit', async () => {
    const tx = await buildDepositTx(ctx, {
      amount: E2E_PARAMS.depositRaw,
      sender,
      coinType: quote.coinType,
    });
    tx.setSender(sender);
    return tx;
  });
  if (lastFailed(results)) return finish(results);

  // 4. Mint UP and DOWN
  await runStep(ctx, results, '4a. mint UP', async () => {
    const tx = buildMintBinaryTx(ctx, {
      oracleId: oracle.id,
      expiryMs: oracle.expiryMs,
      strike,
      isUp: true,
      quantity: E2E_PARAMS.mintQtyRaw,
      coinType: quote.coinType,
    });
    tx.setSender(sender);
    return tx;
  });
  if (lastFailed(results)) return finish(results);

  await runStep(ctx, results, '4b. mint DOWN', async () => {
    const tx = buildMintBinaryTx(ctx, {
      oracleId: oracle.id,
      expiryMs: oracle.expiryMs,
      strike,
      isUp: false,
      quantity: E2E_PARAMS.mintQtyRaw,
      coinType: quote.coinType,
    });
    tx.setSender(sender);
    return tx;
  });
  if (lastFailed(results)) return finish(results);

  await runStep(ctx, results, '4c. mint range', async () => {
    const tx = buildMintRangeTx(ctx, {
      oracleId: oracle.id,
      expiryMs: oracle.expiryMs,
      lower,
      higher,
      quantity: E2E_PARAMS.mintQtyRaw,
      coinType: quote.coinType,
    });
    tx.setSender(sender);
    return tx;
  });
  if (lastFailed(results)) return finish(results);

  // 5. Inspect — verify three positions
  const upQty = await getPositionQty(ctx, manager, { oracleId: oracle.id, expiryMs: oracle.expiryMs, strike, isUp: true });
  const downQty = await getPositionQty(ctx, manager, { oracleId: oracle.id, expiryMs: oracle.expiryMs, strike, isUp: false });
  const rangeQty = await getRangePositionQty(ctx, manager, { oracleId: oracle.id, expiryMs: oracle.expiryMs, lower, higher });
  if (
    upQty !== E2E_PARAMS.mintQtyRaw ||
    downQty !== E2E_PARAMS.mintQtyRaw ||
    rangeQty !== E2E_PARAMS.mintQtyRaw
  ) {
    fail(
      results,
      '5. verify positions',
      `expected UP=DOWN=RANGE=${E2E_PARAMS.mintQtyRaw}, got UP=${upQty} DOWN=${downQty} RANGE=${rangeQty}`,
    );
    return finish(results);
  }
  results.push({ name: '5. verify positions', ok: true, note: `UP=${upQty} DOWN=${downQty} RANGE=${rangeQty}` });

  // 6. Redeem all three (early exit at live SVI bid)
  await runStep(ctx, results, '6a. redeem UP', async () => {
    const tx = buildRedeemTx(ctx, {
      oracleId: oracle.id,
      expiryMs: oracle.expiryMs,
      strike,
      isUp: true,
      quantity: E2E_PARAMS.mintQtyRaw,
      coinType: quote.coinType,
    });
    tx.setSender(sender);
    return tx;
  });
  if (lastFailed(results)) return finish(results);

  await runStep(ctx, results, '6b. redeem DOWN', async () => {
    const tx = buildRedeemTx(ctx, {
      oracleId: oracle.id,
      expiryMs: oracle.expiryMs,
      strike,
      isUp: false,
      quantity: E2E_PARAMS.mintQtyRaw,
      coinType: quote.coinType,
    });
    tx.setSender(sender);
    return tx;
  });
  if (lastFailed(results)) return finish(results);

  await runStep(ctx, results, '6c. redeem range', async () => {
    const tx = buildRedeemRangeTx(ctx, {
      oracleId: oracle.id,
      expiryMs: oracle.expiryMs,
      lower,
      higher,
      quantity: E2E_PARAMS.mintQtyRaw,
      coinType: quote.coinType,
    });
    tx.setSender(sender);
    return tx;
  });
  if (lastFailed(results)) return finish(results);

  // 7. LP supply + withdraw
  await runStep(ctx, results, '7a. lp-supply', async () => {
    const tx = await buildLpSupplyTx(ctx, {
      amount: E2E_PARAMS.lpSupplyRaw,
      sender,
      coinType: quote.coinType,
    });
    tx.setSender(sender);
    return tx;
  });
  if (lastFailed(results)) return finish(results);

  // Fetch the new PLP balance, withdraw half
  const plpBalance = BigInt(
    (
      await ctx.client.getBalance({
        owner: sender,
        coinType: `${ctx.config.PACKAGE_ID}::plp::PLP`,
      })
    ).totalBalance,
  );
  const halfPlp = (plpBalance * BigInt(Math.round(E2E_PARAMS.lpWithdrawFraction * 1_000_000))) / 1_000_000n;
  await runStep(ctx, results, '7b. lp-withdraw half', async () => {
    const tx = await buildLpWithdrawTx(ctx, { shares: halfPlp, sender, coinType: quote.coinType });
    tx.setSender(sender);
    return tx;
  });

  finish(results);
};

const runStep = async (
  ctx: Ctx,
  results: StepResult[],
  name: string,
  build: () => Promise<import('@mysten/sui/transactions').Transaction>,
): Promise<void> => {
  process.stdout.write(`[${name}]…\n`);
  try {
    const tx = await build();
    const outcome = await sign(ctx, tx);
    if (outcome.mode === 'execute' && outcome.success) {
      results.push({ name, ok: true, note: outcome.digest, digest: outcome.digest });
    } else {
      const err = ('error' in outcome ? outcome.error : '') ?? 'unknown';
      results.push({ name, ok: false, note: `signing failed: ${err}` });
    }
  } catch (e) {
    results.push({ name, ok: false, note: e instanceof Error ? e.message : String(e) });
  }
};

const fail = (results: StepResult[], name: string, note: string): void => {
  results.push({ name, ok: false, note });
};

const lastFailed = (results: ReadonlyArray<StepResult>): boolean => !results[results.length - 1]?.ok;

const finish = (results: ReadonlyArray<StepResult>): void => {
  process.stdout.write(`\n=== e2e summary ===\n`);
  for (const r of results) {
    process.stdout.write(`  ${r.ok ? '✓' : '✗'} ${r.name.padEnd(22)} ${r.note}\n`);
  }
  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) {
    process.stdout.write(`\n  ALL STEPS PASSED.\n`);
  } else {
    process.stdout.write(`\n  ${failed.length} step(s) failed. First failure: "${failed[0]?.name}".\n`);
  }
};

/** Round a 1e9-scaled price to the nearest \$500 tick. */
const roundStrike = (priceE9: bigint): bigint => {
  const tickE9 = 500_000_000_000n; // $500
  return ((priceE9 + tickE9 / 2n) / tickE9) * tickE9;
};

const printHelp = (): void => {
  process.stdout.write(
    `Usage:
  npm run e2e

  Orchestrates the full lifecycle:
    preflight → pick oracle → deposit → mint UP+DOWN+RANGE → verify positions
    → redeem all three → lp-supply → lp-withdraw half → summary

  Reuses the existing PTB builders directly. Each signed step uses
  signAndExecuteTransaction; failures halt the chain.

  Requires:
    - PRIVATE_KEY in .env (signing)
    - DUSDC in wallet (\$25 minimum)
    - PredictManager created (run 'npm run setup' first)
`,
  );
};

main().catch((err: unknown) => {
  process.stderr.write(`e2e failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
