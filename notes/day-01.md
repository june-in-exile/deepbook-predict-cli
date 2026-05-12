# Day 1 — Read Design + Contract Information

**Date:** 2026-05-12
**Branch pin:** `predict-testnet-4-16`
**Sources:** Sui Predict design doc, Contract Information page, deepbookv3 source on `predict-testnet-4-16`.

> Hard rule reminder: when docs disagree with source, source wins. Every signature
> below is copied from the source file cited on the right.

---

## 1. Object Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                       Predict (shared)                          │
│                                                                 │
│   ┌──────────────┐  ┌──────────────┐  ┌────────────────┐        │
│   │ Vault        │  │ PricingCfg   │  │ TreasuryConfig │        │
│   │  (nested)    │  │  (nested)    │  │  (nested)      │        │
│   │              │  │              │  │  + Treasury    │        │
│   │  - balances  │  │              │  │    Cap<PLP>    │        │
│   │  - strike    │  └──────────────┘  └────────────────┘        │
│   │    matrix    │  ┌──────────────┐  ┌────────────────┐        │
│   │  - max_payout│  │ RiskConfig   │  │ OracleConfig   │        │
│   │  - liability │  │  (nested)    │  │  (nested)      │        │
│   └──────────────┘  └──────────────┘  └────────────────┘        │
│   ┌────────────────────────────────┐                            │
│   │ withdrawal_limiter: RateLimiter│                            │
│   └────────────────────────────────┘                            │
└─────────────────────────────────────────────────────────────────┘
              ▲                ▲                     ▲
              │ mint/redeem    │ supply/withdraw     │ read
              │                │                     │
┌─────────────────────┐    ┌───────────┐    ┌─────────────────────┐
│ PredictManager      │    │  Wallet   │    │ OracleSVI (shared)  │
│   (shared, owner=u) │    │  Coin<Q>  │    │  - spot, forward    │
│   - balances<Q>     │    │  Coin<PLP>│    │  - SVI params       │
│   - binary_positions│    └───────────┘    │  - expiry, ts       │
│   - range_positions │                     │  - status enum      │
└─────────────────────┘                     │  - settlement_price │
                                            └─────────────────────┘
```

Key fact: **`Vault` is NOT a separate shared object.** It is a field
inside `Predict` ([predict.move:172](https://github.com/MystenLabs/deepbookv3/blob/predict-testnet-4-16/packages/predict/sources/predict.move#L172)).
PTBs only ever take `Predict` as a top-level shared input; vault state is
mutated through `&mut Predict`.

`PLP` is a coin type minted from a `TreasuryCap<PLP>` held inside `Predict`.
LP shares are returned as `Coin<PLP>` (an owned wallet object), not entries
in a registry.

---

## 2. Identifiers from Contract Information

| Kind | Identifier | Notes |
|---|---|---|
| **Package** | `0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138` | Predict package on testnet |
| **Shared object — Predict registry** | `0x43af14fed5480c20ff77e2263d5f794c35b9fab7e2212903127062f4fe2a6e64` | Likely admin/registry surface |
| **Shared object — Predict (main)** | `0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a` | The `&mut Predict` argument |
| **Quote coin type** | `0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC` | 6 decimals; only accepted quote in MVP |
| **DUSDC currency object** | `0xf3000dff421833d4bb8ed58fac146d691a3aaba2785aa1989af65a7089ca3e9c` | For minting test DUSDC |
| **PLP coin type** | `0xf5ea...5138::plp::PLP` | Returned by `supply`, consumed by `withdraw` |
| **Server base URL** | `https://predict-server.testnet.mystenlabs.com` | Markets/portfolios/vault summaries |
| **Source branch** | `predict-testnet-4-16` | Pin everywhere — NOT `main` |

### Event types (for indexers / debugging)

| Event | Module | When |
|---|---|---|
| `oracle::OraclePricesUpdated` | oracle | Spot/forward push |
| `oracle::OracleSVIUpdated`    | oracle | SVI param push |
| `oracle::OracleSettled`       | oracle | Post-expiry first push freezes settlement |
| `oracle::OracleActivated`     | oracle | Inactive → Active transition |
| `predict::PositionMinted` / `PositionRedeemed` | predict | Binary trades |
| `predict::RangeMinted` / `RangeRedeemed` | predict | Vertical-range trades |
| `predict::Supplied` / `Withdrawn` | predict | LP flow |
| `predict_manager::PredictManagerCreated` | predict_manager | Per-user account created |

---

## 3. Source layout (predict-testnet-4-16)

`packages/predict/sources/`:

```
predict.move           — top-level entry module (mint, redeem, supply, withdraw, create_manager)
predict_manager.move   — per-user shared account (deposit, withdraw, balance, position reads)
oracle.move            — OracleSVI shared object, SVI params, lifecycle, reads
oracle_config.move     — strike grid, key validation, oracle-status assertions
registry.move          — package-level registry (admin)
market_key/
  ├── market_key.move  — MarketKey constructors: up(), down(), new(oracle_id,expiry,strike,is_up)
  └── range_key.move   — RangeKey for vertical ranges (lower, higher)
vault/
  ├── vault.move       — nested inside Predict: balances, strike matrix, max_payout, liability
  └── plp.move         — PLP coin type
helper/
  ├── constants.move
  ├── i64.move         — signed 64-bit (used by SVI rho, m)
  ├── math.move        — fixed-point mul/div
  ├── rate_limiter.move — backs LP withdrawal limiter
  └── strike_matrix.move — dense → compact representation of vault exposure
config/
  ├── pricing_config.move
  ├── risk_config.move  — exposes max_total_exposure_pct
  └── treasury_config.move — quote-asset allowlist, TreasuryCap<PLP>
```

---

## 4. Entry Functions, Grouped by User Flow

All signatures copied verbatim from
[predict.move](https://github.com/MystenLabs/deepbookv3/blob/predict-testnet-4-16/packages/predict/sources/predict.move)
and [predict_manager.move](https://github.com/MystenLabs/deepbookv3/blob/predict-testnet-4-16/packages/predict/sources/predict_manager.move).

### 4.1 Setup — Create PredictManager

```move
// predict.move:192
public fun create_manager(ctx: &mut TxContext): ID
```

**Notes:**
- Returns the new manager's `ID`. `predict_manager::new` internally calls
  `transfer::share_object` ([predict_manager.move:106](https://github.com/MystenLabs/deepbookv3/blob/predict-testnet-4-16/packages/predict/sources/predict_manager.move#L106)).
- The CLI must capture the created object from tx effects; the `ID` returned
  by the call is also emitted in the `PredictManagerCreated` event.
- No `Predict` argument required.

### 4.2 Deposit / Withdraw quote into PredictManager

```move
// predict_manager.move:74
public fun deposit<T>(self: &mut PredictManager, coin: Coin<T>, ctx: &TxContext)

// predict_manager.move:80
public fun withdraw<T>(self: &mut PredictManager, amount: u64, ctx: &mut TxContext): Coin<T>
```

**Notes:**
- Only **`PredictManager`** (shared) — does NOT touch `Predict`. Good: deposit
  doesn't need both shared objects.
- Quote coin must be obtained off-tx and passed in; the CLI script splits an
  owned DUSDC coin to the exact amount before this call.
- For `--amount 100` of DUSDC (6 decimals), on-chain `amount` = `100_000_000`.
- `withdraw` returns `Coin<T>` — must be transferred or used downstream.

### 4.3 Mint binary position

```move
// predict.move:219
public fun mint<Quote>(
    predict: &mut Predict,
    manager: &mut PredictManager,
    oracle: &OracleSVI,
    key: MarketKey,
    quantity: u64,
    clock: &Clock,
    ctx: &mut TxContext,
)
```

**MarketKey constructors** (use `up`/`down` for readability):
```move
// market_key.move:30
public fun up(oracle_id: ID, expiry: u64, strike: u64): MarketKey
// market_key.move:35
public fun down(oracle_id: ID, expiry: u64, strike: u64): MarketKey
// market_key.move:40
public fun new(oracle_id: ID, expiry: u64, strike: u64, is_up: bool): MarketKey
```

**Critical observations from the source body**
([predict.move:228-264](https://github.com/MystenLabs/deepbookv3/blob/predict-testnet-4-16/packages/predict/sources/predict.move#L228-L264)):
- **`mint` does NOT take a `Coin` argument.** Premium is auto-pulled with
  `manager.withdraw<Quote>(cost, ctx)`. The user must deposit DUSDC into the
  manager first.
- Order of assertions: sender == manager.owner → not paused → quantity > 0
  → quote asset enabled → key matches oracle → oracle is live → ask <= bound.
- Mint **inserts the liability first**, then prices against post-trade state.
  This is why premiums depend on existing exposure.
- `Clock` is the special `0x6` shared object.

### 4.4 Redeem binary position

Two variants. Choose `redeem` (owner) for normal flow; `redeem_permissionless`
is for indexers/keepers to settle anyone's position post-expiry.

```move
// predict.move:285  (owner; live or settled)
public fun redeem<Quote>(
    predict: &mut Predict,
    manager: &mut PredictManager,
    oracle: &OracleSVI,
    key: MarketKey,
    quantity: u64,
    clock: &Clock,
    ctx: &mut TxContext,
)

// predict.move:300  (anyone; settled only; routed to permissionless balance)
public fun redeem_permissionless<Quote>(
    predict: &mut Predict,
    manager: &mut PredictManager,
    oracle: &OracleSVI,
    key: MarketKey,
    quantity: u64,
    clock: &Clock,
    ctx: &mut TxContext,
)
```

**Notes:**
- `quantity` is explicit — partial redeem is supported.
- Payout is deposited back into the manager's balance automatically; no
  `Coin<Quote>` return value.

### 4.5 Mint range / redeem range  *(deferred to v2 per plan)*

```move
// predict.move:331
public fun mint_range<Quote>(
    predict: &mut Predict, manager: &mut PredictManager,
    oracle: &OracleSVI, key: RangeKey, quantity: u64,
    clock: &Clock, ctx: &mut TxContext,
)

// predict.move:380
public fun redeem_range<Quote>(...)  // same shape
```

MVP plan says skip; recording for completeness.

### 4.6 LP supply

```move
// predict.move:437
public fun supply<Quote>(
    predict: &mut Predict,
    coin: Coin<Quote>,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<PLP>
```

**Notes:**
- Returns `Coin<PLP>` — script must `transfer::public_transfer` it to the
  sender, otherwise the PTB will fail with an unused value error.
- First supplier: `shares = amount` (1:1).
- Subsequent: `shares = mul_div_round_down(amount, total_supply, vault_value)`.
  Confirms the plan's Day 11 expectation.

### 4.7 LP withdraw

```move
// predict.move:474
public fun withdraw<Quote>(
    predict: &mut Predict,
    lp_coin: Coin<PLP>,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<Quote>
```

**Notes:**
- Takes the PLP coin (not a share amount). Whole coin is burned; partial
  withdraw requires splitting the PLP coin first.
- Reverts with `EWithdrawExceedsAvailable` when
  `amount > balance - total_max_payout`. The plan's Day 12 "withdrawal limiter"
  is the `RateLimiter` consume, but the hard-revert check above happens
  earlier — both can block.
- Returns `Coin<Quote>` — must be transferred to sender.

### 4.8 Read-only helpers worth wiring

```move
// predict.move:199 — preview cost / payout for a binary
public fun get_trade_amounts(predict, oracle, key, quantity, clock): (u64, u64)
// predict.move:317 — same for a range
public fun get_range_trade_amounts(...): (u64, u64)
// predict.move:212 — ask bound for an oracle
public fun ask_bounds(predict, oracle_id): (u64, u64)
// predict.move:697 — pre-flight an LP withdraw
public fun available_withdrawal(predict, clock): u64
```

`get_trade_amounts` is the function to call in `devInspectTransactionBlock`
to surface the premium before mint (Day 8 plan).

---

## 5. Open Questions for Day 2

1. **`MANAGER_OBJECT_ID` discovery** — the plan stores it in `.env`, but
   `create_manager` returns the ID via tx effects. Day 2 must capture this
   from the CLI run and write it to `.env`. Worth confirming the explorer
   shows the manager as a shared object owned by no one (vs `address`).
2. **OracleSVI discovery** — Contract Information lists no concrete oracle
   IDs. Day 4/5 must hit the Predict Server to list live oracles
   (`predict-server.testnet.mystenlabs.com`). Recording one in `.env`
   manually is the Day 4 fallback.
3. **Quote-coin split semantics** — DUSDC is not SUI, so `tx.splitCoins(tx.gas, …)`
   is wrong (plan flagged this). Need to fetch user's DUSDC coins via
   `getOwnedObjects`, merge to one, then `splitCoins(theCoin, [amount])`.
4. **`Clock` reference** — confirmed: shared object `0x6`, passed as
   `tx.object('0x6')`.
5. **Oracle expiry units** — `expiry: u64` in the key. Is it ms-since-epoch
   like Sui Clock, or seconds? Day 4 must read a live oracle and check
   against its `timestamp()` to confirm.
6. **Strike scaling** — strikes are `u64`. The matrix math will reveal the
   decimals (probably 9, matching the rest of the protocol's fixed-point
   in `math.move`). Day 4 must verify by reading a live oracle and comparing
   to the human-readable strike in the UI/server.

---

## 6. Successful Transactions

None today — Day 1 is reading only. Day 2's manual `sui client call` is the
first place a digest gets recorded.

---

## 7. Tomorrow's Starting Point

Day 2 — Sui CLI manual dry-run. First actions:

1. `sui client switch --env testnet` (install Sui CLI if missing).
2. Faucet the active address.
3. Mint test DUSDC using currency object
   `0xf3000dff421833d4bb8ed58fac146d691a3aaba2785aa1989af65a7089ca3e9c`
   (signature TBD — investigate the DUSDC module on testnet, or hit the
   Predict Server for a faucet endpoint).
4. `sui client call --package 0xf5ea…5138 --module predict --function create_manager`
   — capture the resulting shared object ID into `.env` as
   `MANAGER_OBJECT_ID`.
5. Deposit a small DUSDC amount via `predict_manager::deposit` and record the
   digest here in `notes/day-02.md`.
