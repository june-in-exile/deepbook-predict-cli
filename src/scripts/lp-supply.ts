import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { createContext } from '../client.js';
import { getPredict, type PredictState } from '../lib/predict.js';
import { buildLpSupplyTx } from '../ptb/lpSupply.js';
import {
  formatDecimal,
  hasFlag,
  parseDecimalAmount,
  printOutcome,
  readFlag,
  resolveSender,
  sign,
} from './_cli.js';

const QUOTE_DECIMALS = 6n;

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  if (hasFlag(argv, '--help') || argv.length === 0) {
    printHelp();
    return;
  }
  const human = readFlag(argv, '--amount');
  if (!human) throw new Error('missing --amount; example: --amount 100');
  const amount = parseDecimalAmount(human, 6);

  const ctx = createContext();
  const sender = await resolveSender(ctx, argv);
  const predict = await getPredict(ctx);
  const previewShares = computeSharesMinted(amount, predict);

  printSummary(human, amount, sender, predict, previewShares);

  const tx = await buildLpSupplyTx(ctx, { amount, sender });
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
      `Supply ${human} DUSDC for ~${formatDecimal(previewShares, QUOTE_DECIMALS)} PLP?`,
    );
    if (!ok) {
      process.stdout.write('  aborted by user.\n');
      return;
    }
  }
  const outcome = await sign(ctx, tx);
  printOutcome(outcome);
};

/**
 * Mirrors predict::supply's share math:
 *   if total_supply == 0: shares = amount      (first supplier, 1:1)
 *   else:                 shares = (amount * total_supply) / vault_value
 *
 * Numerically equivalent within rounding (the chain uses
 * mul_div_round_down).
 */
const computeSharesMinted = (amount: bigint, predict: PredictState): bigint => {
  if (predict.plpTotalSupply === 0n) return amount;
  if (predict.vaultValue === 0n) {
    throw new Error('vault_value is 0 — supply would abort with EZeroVaultValue');
  }
  return (amount * predict.plpTotalSupply) / predict.vaultValue;
};

const printSummary = (
  human: string,
  amount: bigint,
  sender: string,
  predict: PredictState,
  shares: bigint,
): void => {
  process.stdout.write(`\n=== LP supply ===\n`);
  process.stdout.write(`  supply amount:      ${human} DUSDC (raw ${amount})\n`);
  process.stdout.write(`  sender:             ${sender}\n`);
  process.stdout.write(`  predict:            ${predict.id}\n`);
  process.stdout.write(`  vault balance:      ${formatDecimal(predict.vaultBalance, QUOTE_DECIMALS, { groupThousands: true })} DUSDC\n`);
  process.stdout.write(`  vault MTM:          ${formatDecimal(predict.vaultMtm, QUOTE_DECIMALS, { groupThousands: true })} DUSDC\n`);
  process.stdout.write(`  vault value:        ${formatDecimal(predict.vaultValue, QUOTE_DECIMALS, { groupThousands: true })} DUSDC (= balance - MTM)\n`);
  process.stdout.write(`  PLP total supply:   ${formatDecimal(predict.plpTotalSupply, QUOTE_DECIMALS, { groupThousands: true })} PLP\n`);
  process.stdout.write(`  preview shares:     ${formatDecimal(shares, QUOTE_DECIMALS, { groupThousands: true })} PLP (raw ${shares})\n`);
  if (predict.plpTotalSupply === 0n) {
    process.stdout.write(`  (first supplier — 1:1 ratio)\n`);
  } else {
    // Display the ratio to 6 decimal places — the trailing digits of a 9-decimal
    // fixed-point are noise relative to the per-LP rounding error.
    const ratioE6 = (predict.plpTotalSupply * 1_000_000n) / predict.vaultValue;
    process.stdout.write(`  share/value ratio:  ${formatDecimal(ratioE6, 6n)} PLP per 1 DUSDC of vault_value\n`);
  }
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
  npm run lp-supply -- --amount <human> [--execute] [--yes]

  Supplies DUSDC to the vault in exchange for PLP shares. The returned
  Coin<PLP> is transferred to the sender automatically.

Share math (mirrors predict::supply):
  first supplier:    shares = amount  (1:1)
  subsequent:        shares = (amount * total_supply) / vault_value

  vault_value = vault.balance - vault.total_mtm

Examples:
  npm run lp-supply -- --amount 100               # dry-run only
  npm run lp-supply -- --amount 100 --execute     # sign + submit
`,
  );
};

main().catch((err: unknown) => {
  process.stderr.write(`lp-supply failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
