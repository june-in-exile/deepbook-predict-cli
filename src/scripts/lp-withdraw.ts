import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { createContext, type Ctx } from '../client.js';
import { getPredict, type PredictState } from '../lib/predict.js';
import { resolveQuote, type Quote } from '../lib/quote.js';
import { buildLpWithdrawTx } from '../ptb/lpWithdraw.js';
import {
  formatDecimal,
  hasFlag,
  parseDecimalAmount,
  printOutcome,
  readFlag,
  resolveSender,
  sign,
} from './_cli.js';

/** PLP coin decimals are fixed by the protocol — always 6. */
const PLP_DECIMALS = 6n;

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  if (hasFlag(argv, '--help') || argv.length === 0) {
    printHelp();
    return;
  }
  const human = readFlag(argv, '--shares');
  if (!human) throw new Error('missing --shares; example: --shares 50');
  const shares = parseDecimalAmount(human, 6);

  const ctx = await createContext();
  const quote = await resolveQuote(ctx, readFlag(argv, '--quote'));
  const sender = await resolveSender(ctx, argv);
  const predict = await getPredict(ctx);

  const previewAmount = sharesToAmount(shares, predict);
  const availability = computeAvailability(predict);

  printSummary(human, shares, sender, predict, previewAmount, availability, quote);

  if (previewAmount > availability.available) {
    process.stdout.write(
      `\n  ABORT (pre-flight): would withdraw ${formatDecimal(previewAmount, quote.decimals)} ${quote.symbol}, ` +
        `but only ${formatDecimal(availability.available, quote.decimals)} is available.\n` +
        `  The vault must keep ${formatDecimal(predict.vaultTotalMaxPayout, quote.decimals)} in reserve ` +
        `to cover outstanding max-payout obligations.\n` +
        `  Try a smaller --shares, or wait for positions to settle/redeem.\n`,
    );
    return;
  }

  const tx = await buildLpWithdrawTx(ctx, { shares, sender, coinType: quote.coinType });
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
    const ok = await confirm(
      `Burn ${human} PLP for ~${formatDecimal(previewAmount, quote.decimals)} ${quote.symbol}?`,
    );
    if (!ok) {
      process.stdout.write('  aborted by user.\n');
      return;
    }
  }
  const outcome = await sign(ctx, tx);
  printOutcome(outcome);
};

type Availability = Readonly<{
  available: bigint;
  rateLimiterEnabled: boolean;
}>;

const computeAvailability = (predict: PredictState): Availability => {
  const available =
    predict.vaultBalance > predict.vaultTotalMaxPayout
      ? predict.vaultBalance - predict.vaultTotalMaxPayout
      : 0n;
  const rl = predict.withdrawalLimiter as Record<string, unknown>;
  return Object.freeze({
    available,
    rateLimiterEnabled: Boolean(rl.enabled),
  });
};

/**
 * Mirrors predict::shares_to_amount:
 *   if shares == 0 || total_supply == 0: return 0
 *   if total_supply == shares:           return vault_value  (last LP exits)
 *   else:                                 mul_div_round_down(shares, vault_value, total_supply)
 */
const sharesToAmount = (shares: bigint, predict: PredictState): bigint => {
  if (shares === 0n || predict.plpTotalSupply === 0n) return 0n;
  if (predict.plpTotalSupply === shares) return predict.vaultValue;
  return (shares * predict.vaultValue) / predict.plpTotalSupply;
};

const printSummary = (
  human: string,
  shares: bigint,
  sender: string,
  predict: PredictState,
  previewAmount: bigint,
  avail: Availability,
  quote: Quote,
): void => {
  process.stdout.write(`\n=== LP withdraw ===\n`);
  process.stdout.write(`  shares to burn:        ${human} PLP (raw ${shares})\n`);
  process.stdout.write(`  sender:                ${sender}\n`);
  process.stdout.write(`  predict:               ${predict.id}\n`);
  process.stdout.write(`  vault balance:         ${formatDecimal(predict.vaultBalance, quote.decimals)} ${quote.symbol}\n`);
  process.stdout.write(`  vault MTM:             ${formatDecimal(predict.vaultMtm, quote.decimals)} ${quote.symbol}\n`);
  process.stdout.write(`  vault value:           ${formatDecimal(predict.vaultValue, quote.decimals)} ${quote.symbol}\n`);
  process.stdout.write(`  total_max_payout:      ${formatDecimal(predict.vaultTotalMaxPayout, quote.decimals)} ${quote.symbol} (must keep in reserve)\n`);
  process.stdout.write(`  available to withdraw: ${formatDecimal(avail.available, quote.decimals)} ${quote.symbol} (= balance - max_payout)\n`);
  process.stdout.write(`  PLP total supply:      ${formatDecimal(predict.plpTotalSupply, PLP_DECIMALS)} PLP\n`);
  process.stdout.write(`  preview amount out:    ${formatDecimal(previewAmount, quote.decimals)} ${quote.symbol} (raw ${previewAmount})\n`);
  process.stdout.write(`  rate limiter:          ${avail.rateLimiterEnabled ? 'enabled — may further limit withdraws' : 'disabled'}\n`);
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
  deepbook-predict lp-withdraw --shares <human> [--execute] [--yes]

  Burns PLP shares for DUSDC. The returned Coin<Quote> is transferred
  to the sender automatically.

Pre-flight gates:
  1. shares > 0
  2. user owns >= --shares PLP
  3. previewed amount <= balance - total_max_payout (else EWithdrawExceedsAvailable)
  4. devInspect succeeds
  5. interactive confirm

Math (mirrors predict::shares_to_amount + EWithdrawExceedsAvailable):
  amount = shares * vault_value / total_supply
           (or vault_value exactly if shares == total_supply)
  must satisfy: amount <= balance - total_max_payout

Examples:
  deepbook-predict lp-withdraw --shares 50              # dry-run
  deepbook-predict lp-withdraw --shares 50 --execute    # sign + submit
`,
  );
};

main().catch((err: unknown) => {
  process.stderr.write(`lp-withdraw failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
