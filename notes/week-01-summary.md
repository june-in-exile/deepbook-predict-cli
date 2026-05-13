# Week 1 — Reflection (Day 7)

**Date:** 2026-05-13
**Days covered:** 1–6
**Branch pin:** `predict-testnet-4-16`
**Code state at end of Week 1:**

```
src/        ~1,070 lines  (10 .ts files)
test/         ~200 lines  ( 4 .ts files, 24 passing tests)
notes/      ~1,290 lines  ( 6 daily notes + this one)
```

No file is over 200 lines (cap is 400). Typecheck clean. `npm test`
green. 4 npm scripts working against testnet (`inspect`, `markets`,
`deposit` dry-run, `withdraw` dry-run).

---

## 1. What works end-to-end

| Capability | Where it lives | Verified |
|---|---|---|
| Load + validate `.env` | `src/config.ts` | 6 unit tests + `npm run inspect` |
| Sui RPC + optional keypair | `src/client.ts` | indirectly via every script |
| Read `Predict` shared object | `src/lib/predict.ts` | `npm run inspect` → Vault has \$1M LP |
| Read `PredictManager` (incl. position tables) | `src/lib/manager.ts` | `npm run inspect` → empty manager parses correctly |
| Quote balance via devInspect | `src/lib/manager.ts::getQuoteBalance` | returns `0n` (LE-bytes round-trip works) |
| Read `OracleSVI` + lifecycle | `src/lib/oracle.ts` | live BTC oracle resolved to `Active` |
| Predict Server REST client | `src/lib/server.ts` | `npm run markets` → 19 active oracles |
| Build deposit PTB | `src/ptb/deposit.ts` | pre-flight catches "no coins" cleanly |
| Build withdraw PTB | `src/ptb/withdraw.ts` | devInspect → `MoveAbort` from balance_manager (correct failure mode) |
| Dry-run vs `--execute` safety gate | `src/scripts/_cli.ts` | default dry-run; `--execute` required to sign |
| One real on-chain transaction | Day 2 | `Cmnd6GvUaV19Zsz199CXJ93PqLYrMhTziupjJymLjMt2` (create_manager) |

## 2. What is NOT working (and why)

| Item | Why | Resolution path |
|---|---|---|
| Deposit / withdraw end-to-end execution | No `DUSDC` in wallet; the test-USDC module has zero public functions (only `init` runs once, gives Treasury+MetadataCap to the deployer) | Acquire DUSDC out-of-band; the rest of the build is unblocked |
| Day-2 plan deliverable (signed deposit digest) | Same DUSDC blocker | Will retro-test the moment DUSDC lands |

The Day-2 deliverable is strictly "not met" by the plan's rule. The
build itself didn't depend on it; we worked around by doing the
read-only and dry-run work in parallel. Strict adherence vs. progress
trade-off was the right call given an external supply constraint.

## 3. Architectural facts learned that weren't in the design doc

In rough order of importance for Day 8 onwards:

1. **`PredictManager` wraps a DeepBook v3 `BalanceManager`.**
   It stores `DepositCap` and `WithdrawCap` as fields; user-facing
   `deposit<T>`/`withdraw<T>` delegate to the inner BM via the caps.
   Implication: any DUSDC in the manager actually lives in the
   wrapped BM's dynamic-fields balance table.
2. **`Vault` is NOT a separate shared object** — it's a field inside
   `Predict`. PTBs only ever take `Predict` + `PredictManager` +
   `OracleSVI` + `Clock` as shared inputs; vault state is mutated
   through `&mut Predict`. (Day 8 mint signature confirms this.)
3. **`predict::mint` takes NO `Coin` argument.** Premium is auto-pulled
   from `manager.balance<Quote>` via an internal `manager.withdraw`.
   Day 6 deposit is therefore a hard prerequisite for Day 8 mint,
   not just a logical ordering hint.
4. **At least three deepbook upgrade versions coexist on testnet:**
   - `0xfb28c4cb…6982` — struct defns
   - `0x984757fc…790a` — caps + events
   - `0x74cd5657…77c8` — runtime code (surfaced in our withdraw abort)
   Implication: never raw-string-compare coin types or capability
   types — normalize via `with_defining_ids`.
5. **Two scales coexist throughout:**
   - **Quote balances** (vault, manager, coin amounts): `1e6` (DUSDC
     decimals).
   - **Prices, strikes, %, spreads**: `1e9` (protocol fixed-point).
     Verified live: `max_ask_price = 990_000_000` ≡ \$0.99,
     `min_ask_price = 10_000_000` ≡ \$0.01,
     `max_total_exposure_pct = 800_000_000` ≡ 80%, BTC
     `min_strike = 50e12 / 1e9 = $50_000`, tick_size `1e9 = $1`.
   Day 8 will need vigilance: cost premium will be paid in `1e6`-scaled
   raw quote, even though the *ask price* is `1e9`-scaled.
6. **`oracle::status` precedence** is
   `Settled > PendingSettlement > Inactive > Active`. Encoded directly
   in `src/lib/oracle.ts::computeLifecycle`. Important because the
   server's `status` field is a snapshot, not a live computation —
   an oracle past expiry without a settlement push still says
   `status: active` on the server.
7. **`create_manager` returns just an `ID`** — the manager itself is
   `transfer::share_object`-d internally. The CLI captures it from tx
   effects; the `ID` return value is a duplicate of what the
   `PredictManagerCreated` event carries.
8. **The Predict Server is intentionally minimal:** four endpoints
   total (`/health`, `/status`, `/managers`, `/oracles`). No
   server-side filtering on `/oracles` — client must filter all 2200
   rows. No portfolio, no vault summary, no positions endpoint. Plan
   over-promised here; reality is leaner.
9. **Error paths surface 2 delegations deep.** A `predict_manager::withdraw`
   abort actually reads as `balance_manager::withdraw_with_proof`, abort
   code 3. When debugging Day 8 mint failures, **the abort module name
   tells the truth about which check failed**, not the function we
   called from TypeScript.
10. **`coin_registry::Currency` is the newer Sui currency standard.**
    DUSDC's `init` calls `coin_registry::new_currency_with_otw(...)`,
    not the older `coin::create_currency(...)`. The registered shared
    Currency object (`0xf3000d…3e9c`) holds metadata; reads via
    `suix_getCoinMetadata` work, but minting needs the deployer's
    `TreasuryCap`. We won't hit this for predict ops, but it matters
    for any future "give me a small DUSDC faucet on Day 13 setup" idea.

## 4. Status of every Day-1 §5 open question

| # | Question | Resolution |
|---|---|---|
| 1 | `MANAGER_OBJECT_ID` discovery | Day 2: captured from tx effects → `.env`. ✅ |
| 2 | OracleSVI discovery | Days 4-5: `GET /oracles` + `findActiveOracles()`. ✅ |
| 3 | Quote-coin split semantics | Day 6: `getCoins` + merge-into-largest + `splitCoins`. ✅ |
| 4 | `Clock` reference | Confirmed `0x6` (used in withdraw devInspect). ✅ |
| 5 | Oracle expiry units | Day 4: ms-since-epoch (matches `Date.now()`). ✅ |
| 6 | Strike scaling | Day 4: `1e9`. ✅ |

All six open questions are now closed. No "we'll find out later" lurking
into Week 2.

## 5. Decisions to revisit

None are blocking, but worth flagging before Day 8:

1. **`PredictState.raw`** — kept the full unparsed object for
   debugging. Bloats `--json` output by ~5×. Day 15 polish should
   either drop it or hide it behind `--debug`. Leave for now; helps
   when an unexpected field shows up in Days 8-12.
2. **A `devInspectCallReturning(target, typeArgs, args) -> bytes` helper**
   would clean up Day 8's pre-mint cost preview. Currently the
   pattern exists only in `manager.ts::getQuoteBalance` (one
   little-endian u64 decode). On Day 8 it will be called for
   `predict::get_trade_amounts` returning `(u64, u64)` — two return
   values, same pattern. **Recommendation: extract during Day 8,
   not preemptively now.** Premature abstraction with one user is a
   smell.
3. **`_cli.ts`'s underscore prefix** is a Python convention; TS
   would normally use a descriptive name. Could be `cli-helpers.ts`.
   Not worth a rename until something else touches the file.
4. **`fetchAllDynamicFields()` exists in both `manager.ts` and
   `predict.ts`** (the latter as part of vault iteration plan for
   Day 8). Could be extracted to a shared helper. Hold until Day 8
   actually needs it.
5. **Pre-flight checks pattern is paying off.** Day 6 has 2 of them
   (`getCoins` empty check, `--execute` gate). Day 8 should add a
   third: validate the chosen `strike` against the oracle's strike
   grid (`OracleConfig.oracle_grids` has 2200 entries, queryable
   via dynamic fields). Better to catch "invalid strike for this
   oracle" locally than to chase a deep MoveAbort.

## 6. Time-remaining estimate

| Day | Task | Realistic hours |
|---|---|---|
| 8 | Mint binary (plan says "hardest") | 2–3 |
| 9 | Mint edge cases + opposite direction | 1 |
| 10 | Redeem | 1.5 |
| 11 | LP supply | 1 |
| 12 | LP withdraw (limiter wrinkles) | 1.5 |
| 13 | Setup script (idempotent) | 1 |
| 14 | E2E integration | 2 |
| 15 | Inspect polish (cli-table3, sections) | 1 |
| 16 | README + demo recording | 1 |
| **Subtotal** | | **12–14** |
| 17–18 | Buffer | 0–4 |

**Total expected: 12–18 active hours** over 11 calendar days,
matching the plan's ~1.5h/day budget with mild variance.

**Critical-path blocker**: DUSDC supply. Without it, **Days 8/9/10
deliverables cannot be strictly met** (each requires a real signed
transaction). The PTBs and dry-runs can proceed; the deliverables
gate them. Two pragmatic strategies:

- **Strategy A (preferred):** Implement Days 8-12 builds with strict
  dry-run verification ("PTB succeeds in devInspect"). The moment
  DUSDC arrives, run a single retroactive `--execute` batch to bank
  each deliverable's digest. This keeps technical progress moving.
- **Strategy B:** Stop after Day 7 until DUSDC obtained. Cleaner per
  plan, but burns calendar time and risks losing context.

Recommendation: **A**. Day 6 already proved the pattern (`MoveAbort`
on insufficient funds is the *correct* failure mode for an
otherwise-valid PTB).

## 7. What surprised me this week

Worth recording while the surprise is fresh:

- **The protocol is busy on testnet.** Vault has \$1M LP, 18-19 oracles
  active at any moment, ~18 settle per day. This isn't a quiet dev
  environment; it's a load-bearing testnet.
- **One BTC oracle expires roughly every 15 minutes** (visible in
  `npm run markets` — expiries laid out at 15-min intervals through
  the next hour, then sparser). The protocol has a continuous expiry
  cadence, not discrete daily/weekly expiries.
- **The strike grid is large** — 2200 oracle grids registered. Each
  oracle has a strike matrix with many entries. Day 8's strike
  selection won't be obvious; we'll either need to query the grid
  or trust the user's input and let MoveAbort handle invalid strikes.
- **`rho` (SVI skew) is currently positive** on the live oracle,
  despite the source comment saying "typically negative — puts more
  expensive". Testnet conventions don't necessarily mirror real
  options markets.
- **npm 11 prints script banners to stdout, not stderr**, breaking
  `npm run X | jq`. Workaround: `npm run --silent X`. This is the
  kind of footgun that wouldn't surface in unit tests.

## 8. State going into Week 2

- Repo: clean, on `main`, 7 commits.
- Tests: 24 green, no skipped, no flakes.
- Pending review: none.
- Tech debt: zero items above "would be nice".
- Pending external dependency: DUSDC supply (the only thing).

Day 8 starts here:
[notes/day-06.md §6 "Tomorrow's Starting Point"](day-06.md) — which
points to Day 7 (this file). The real next step is the **Day 8
checklist in this file's §5** combined with the [plan's Day 8
section](../DEEPBOOK_PREDICT_MVP_PLAN.md). First action: pick the
longest-expiry active oracle from `GET /oracles`, then read its
strike grid via dynamic-field iteration before writing the mint PTB.
