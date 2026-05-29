# DeepBook Predict TUI — Design

Date: 2026-05-29
Status: Approved

## Goal

Add a full-screen interactive TUI that covers **all** existing CLI functionality
(the 13 subcommands), while keeping the non-interactive CLI subcommands intact for
scripting, CI, and `--json` output. Both front-ends share the same `lib/` + `ptb/`
core; neither core layer changes.

## Decisions (from brainstorming)

- **Keep both systems.** TUI becomes the default human-facing interface; CLI
  subcommands stay for automation / pipes / `--json` / `e2e` in CI.
- **Rendering: Ink (React for CLI).** Component model fits the multi-screen forms
  (mint/redeem). Adds `ink` + `react` runtime deps; `ink-testing-library` for tests.
- **Navigation: sidebar sections + persistent status header.** Top bar always shows
  wallet / manager / oracle (+ READ-ONLY badge). Left sidebar switches sections;
  right pane is content.
- **Global selected oracle.** Picking an oracle in Markets sets a global selection
  shown in the header and pre-filled into Preview/Trade/Redeem forms (overridable).
- **Manual refresh.** `r` re-fetches chain data; successful actions auto-refresh the
  relevant data. No background polling.

## Architecture

TUI is a new front-end layer only. It reuses, unchanged:

- `client.ts` (`createContext`, `requireKeypair`), `config.ts`
- all of `lib/*` (manager, oracle, oracle-pick, predict, quote, server, view, coins)
- all of `ptb/*` (build*Tx, build*PreviewTx)
- I/O-free helpers from `scripts/_cli.ts`: `parseDecimalAmount`, `formatDecimal`,
  `dryRun`, `sign`, `ExecuteOutcome`. (The interactive `resolveSender` /
  `resolveManagerId` / `printOutcome` are stdout/readline-based and are NOT used by
  the TUI — the TUI does its own resolution and renders outcomes as components.)

### New files

```
src/tui.ts                       entry: resolve ctx/quote/sender, render <App/>
src/tui/
  format.ts                      pure display helpers (PRICE_DECIMALS, expiry text, status)
  hooks/useAsync.ts              generic async-with-refresh hook
  state/AppContext.tsx           ctx, quote, sender, canSign, selectedOracleId,
                                 selectedManagerId, refreshNonce, refresh()
  components/
    TextInput.tsx                minimal controlled text field (useInput)
    Select.tsx                   keyboard list selector
    StatusBar.tsx                top status header + READ-ONLY badge
    Sidebar.tsx                  section nav
    Footer.tsx                   keybinding hints
    Outcome.tsx                  dry-run / digest / balance-changes / explorer link
    ConfirmModal.tsx             y/N confirmation before signing
    Async.tsx                    loading/error wrapper for useAsync results
  screens/
    AccountScreen.tsx            setup + inspect + deposit + withdraw + create-manager
    MarketsScreen.tsx            markets list, sort/reverse, enter = set global oracle
    PreviewScreen.tsx            binary + range ask/bid tables
    TradeScreen.tsx              sub-tabs: mint-binary / mint-range / redeem / redeem-range
    LpScreen.tsx                 lp-supply / lp-withdraw
    LifecycleScreen.tsx          e2e, step-by-step
```

### Build / entry wiring

- `tsconfig.json` / `tsconfig.build.json`: add `"jsx": "react-jsx"` and include
  `src/**/*.tsx` (build) / `test/**/*.tsx`.
- `cli.ts`: add `tui` to the dispatcher; with no subcommand on a TTY, launch the TUI
  (still prints help when stdout is not a TTY, so pipe-detection is preserved).
- `package.json`: add `"tui": "tsx src/tui.ts"` script and the new deps.

## Section → command coverage

| Section   | Commands covered                                   |
|-----------|----------------------------------------------------|
| Account   | `setup` (+create-manager), `inspect`, `deposit`, `withdraw` |
| Markets   | `markets`                                          |
| Preview   | `preview`                                          |
| Trade     | `mint-binary`, `mint-range`, `redeem`, `redeem-range` |
| LP        | `lp-supply`, `lp-withdraw`                         |
| Lifecycle | `e2e`                                              |

## Write-action flow (mirrors CLI safety)

Form → `devInspect` dry-run → show gas/preview → `ConfirmModal` → `sign()` →
`Outcome` (digest, balance changes, suiscan link). Equivalent to the CLI's
"dry-run default + `--execute` + y/N confirm", with the confirm as a modal.
Pre-flight checks are preserved (oracle Active for mint, manager balance ≥ cost,
position owned ≥ qty for redeem, LP available-to-withdraw).

## Read-only mode

If `.env` has no `PRIVATE_KEY`, the TUI prompts for a watch address (used as the
devInspect sender) and shows a `READ-ONLY` badge. Account-read / Markets / Preview
work; every Execute action is disabled with a "set PRIVATE_KEY to sign" hint.

## Shared state

`AppContext` holds `ctx`, `quote`, `sender`, `canSign`, `selectedOracleId`,
`selectedManagerId`, `refreshNonce`, `refresh()`.
- selected oracle: set in Markets, shown in StatusBar, pre-fills Preview/Trade.
- selected manager: resolved at startup via `findOwnedManagers`; if multiple, picked
  in Account.
- refresh: `r` bumps `refreshNonce`; `useAsync` consumers re-fetch; write-actions
  call `refresh()` on success.

## Testing

- `lib/` + `ptb/` tests unchanged.
- `format.ts` unit tests (pure).
- `ink-testing-library` smoke tests: App renders, sidebar navigation switches
  screens, a form's dry-run path renders preview without signing (mocked `Ctx`).

## Out of scope (YAGNI)

- Background polling / live spot ticking.
- Quote picker UI: quote auto-resolves; if multiple accepted quotes, the entry
  honors `--quote` / `QUOTE` env (same as CLI) and otherwise errors with guidance.
- Mouse support.
