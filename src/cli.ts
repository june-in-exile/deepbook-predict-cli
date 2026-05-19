#!/usr/bin/env node
// Subcommand dispatcher for the published binary.
// Local dev still uses `npm run <script>` (which calls tsx directly);
// this file is what `deepbook-predict <subcommand>` resolves to once installed.

const commands: Readonly<Record<string, () => Promise<unknown>>> = {
  setup: () => import('./scripts/setup.js'),
  inspect: () => import('./scripts/inspect.js'),
  markets: () => import('./scripts/markets.js'),
  preview: () => import('./scripts/preview.js'),
  deposit: () => import('./scripts/deposit.js'),
  withdraw: () => import('./scripts/withdraw.js'),
  'mint-binary': () => import('./scripts/mint-binary.js'),
  'mint-range': () => import('./scripts/mint-range.js'),
  redeem: () => import('./scripts/redeem.js'),
  'redeem-range': () => import('./scripts/redeem-range.js'),
  'lp-supply': () => import('./scripts/lp-supply.js'),
  'lp-withdraw': () => import('./scripts/lp-withdraw.js'),
  e2e: () => import('./scripts/e2e.js'),
};

const printHelp = (): void => {
  process.stdout.write(
    `Usage: deepbook-predict <command> [options]

Read-only:
  setup              Check readiness + manager status
  inspect            Dump Predict / Manager / Oracle / Wallet state
  markets            List active oracles
  preview            Side-by-side UP+DOWN ask/bid table

Trading (requires PRIVATE_KEY + DUSDC; dry-run unless --execute):
  deposit            Deposit DUSDC into the manager
  withdraw           Withdraw DUSDC from the manager
  mint-binary        Mint a binary position
  mint-range         Mint a vertical-range position
  redeem             Redeem a binary position
  redeem-range       Redeem a range position
  lp-supply          Supply DUSDC to the vault for PLP
  lp-withdraw        Burn PLP for DUSDC
  e2e                Run the full lifecycle in order

Pass --help to any subcommand for its flags.
`,
  );
};

const main = async (): Promise<void> => {
  const subcommand = process.argv[2];
  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    printHelp();
    process.exit(subcommand ? 0 : 1);
  }
  const loader = commands[subcommand];
  if (!loader) {
    process.stderr.write(`Unknown command: ${subcommand}\nRun 'deepbook-predict --help' for usage.\n`);
    process.exit(1);
  }
  // Strip the subcommand so the imported script's `process.argv.slice(2)` sees only its own flags.
  process.argv.splice(2, 1);
  await loader();
};

main().catch((err: unknown) => {
  process.stderr.write(`deepbook-predict failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
