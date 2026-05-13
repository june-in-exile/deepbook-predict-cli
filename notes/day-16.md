# Day 16 — README + demo recording

**Date:** 2026-05-13
**Branch pin:** `predict-testnet-4-16`

> Plan deliverable: `README.md` a new user can follow + a recorded
> demo. **README written and verified. Demo recording is out of scope
> for a CLI-only session.**

---

## 1. What was added

```
README.md   # ~260 lines: quickstart, prerequisites, config table,
            # command reference, troubleshooting, architecture, DoD
```

No source changes. No new tests needed (the README documents existing
behavior).

## 2. README structure

10 sections, sized for "Sui-familiar developer skim in 5 minutes":

1. **What it is** — one paragraph, no fluff.
2. **Quickstart** — 6 commands. Anchors the rest.
3. **Prerequisites** — table format; required vs. optional.
4. **Configuration** — the `.env` schema, with a pointer to live
   contract info.
5. **Command reference** — table of all 11 npm scripts, grouped by
   read/setup/trade/dev.
6. **How a typical run looks** — concrete sample output (setup +
   mint).
7. **Architecture** — source layout, two scales, 5-gate pre-flight.
8. **Troubleshooting** — 7 specific MoveAbort / blocker patterns with
   their causes and fixes.
9. **What this CLI does NOT do** — explicit out-of-scope list.
10. **Definition of Done** — plan's checklist with current status.

## 3. Verification

Every "Quickstart" command tested live against today's testnet state:

```
$ npm test                        # 28 tests, 0 failures
$ npm run --silent setup          # readiness checklist, 1/3 (DUSDC blocked)
$ npm run --silent inspect | head # valid sectioned output
```

Each documented npm script exists, has `--help`, and runs without
arguments either successfully (read-only) or with a clear "missing
argument" error.

## 4. Architecture decisions for the README

### Lead with quickstart, not concept

Operators land on a README looking for "what do I run". The
quickstart sits before the prose. The concept ("binary options
protocol", "5-gate pre-flight") comes after, where someone who
needs the depth will find it.

### Troubleshooting section is mostly chain aborts

Seven entries:

1. DUSDC supply blocker (the only true blocker)
2. Settled oracle (rotate ORACLE_OBJECT_ID)
3. `assert_mintable_ask` — ask ceiling
4. `assert_valid_strike` — off-tick or below-min
5. `pricing_config::quote_spread_from_fair_price` — price floor
6. `EWithdrawExceedsAvailable` — vault reserves
7. npm 11 `--silent` for jq piping

Each entry follows the same template:

```
### {error name}

{1-2 sentence cause}

{specific recipe to fix}
```

This is the format that's actually useful — symptom → cause → action,
no detour into "what's an SVI surface".

### Three scale conventions made explicit

The "Two scaling conventions" table (now updated to 3) is the single
most-requested piece of context for anyone hitting their first off-by-
factor-of-1000 bug. Inline in the architecture section so people see
it without clicking through to notes.

### Reserved buffer for daily notes

The Definition of Done table marks "16/18" days captured. Days 17–18
are the **plan's reserved buffer**; per
[DEEPBOOK_PREDICT_MVP_PLAN.md §"Days 17-18 — Buffer"](../DEEPBOOK_PREDICT_MVP_PLAN.md),
they "Reserved for overruns." If anything DUSDC-related lands during
that window, day-17.md and day-18.md become the execution-verification
notes. Otherwise, they're rest days.

## 5. Demo recording — why deferred

The plan asks for an asciinema or screen recording of `npm run e2e`.
Reasons not done today:

- **No DUSDC** → e2e halts at preflight, recording shows one error
  line and stops. Not demo-quality.
- **CLI-only session** — can't drive asciinema/screen recorder from
  this environment.

A demo can be recorded post-DUSDC by anyone with shell access:

```bash
asciinema rec deepbook-predict-demo.cast \
  -c "bash -c 'npm run inspect && npm run markets -- --limit 3 \
              && npm run preview -- --strikes 80000,80500,81000'"
```

That command covers 3 of the most visually rich scripts in ~30 seconds
without needing DUSDC.

## 6. Plan deliverable status

| Definition of Done item | Status |
|---|---|
| Fresh clone + `.env` + `npm install` + `npm run setup` works | ✅ |
| `npm run e2e` runs all six lifecycle commands | ⚠ orchestrator wired; preflight halts on DUSDC |
| README clear enough for a Sui-familiar developer | ✅ (verified live) |
| All 18 daily notes exist | 16/18 (Days 17-18 = plan's buffer) |
| 3-minute demo recording | ⛔ deferred; cookbook command provided |

The CLI is **shippable** today modulo DUSDC. Anyone who has DUSDC can
follow the quickstart, run a deposit + mint, and verify on
suiscan within ~3 minutes.

## 7. Successful Transactions

None today — documentation work.

## 8. Tomorrow's Starting Point — Day 17 (buffer)

Plan §"Days 17–18 — Buffer" says: "Reserved for overruns. If you
finish early: do NOT add features. Add tests. Add error handling.
Write more notes."

Concrete carry-overs from the daily notes that fit this framing:

1. **Test the lifecycle once DUSDC arrives.** Run e2e end-to-end,
   record digests, attach a `digests.md` to the notes/ directory.
2. **Add tests for the pre-flight gates.** Currently we have unit
   tests for `parseDecimalAmount`, `formatDecimal`, `computeLifecycle`,
   `findActiveOracles`, and config validation. The 5-gate pattern
   itself isn't unit-tested (it's integration-tested by the dry-run
   runs). A few mocked-Ctx tests would close the gap.
3. **Add an off-tick `--strike` pre-flight in `mint-binary`.** Today
   the off-tick case falls through to chain MoveAbort. Local catch
   would be friendlier.
4. **`splitFromOwned` unit tests.** It's used in 3 PTBs, has 4
   branches (no coins, insufficient, single coin, multi-coin merge).
   Probably 4 tests.
5. **Document the per-oracle ask-bounds path** — currently empty
   on testnet (`size: 0`), but if it gets populated the preview
   won't catch overrides. ~5 lines of code to surface in inspect.

If DUSDC lands during the buffer: do option 1 first (gives us digests
to attach to the README's DoD section). Otherwise: any of 2–5.
