# Day 2 — Sui CLI manual dry-run

**Date:** 2026-05-12
**Branch pin:** `predict-testnet-4-16`

> Plan deliverable: one successful `deposit` tx via `sui client call`, digest
> recorded. **Status: partially met.** `create_manager` succeeded; `deposit`
> blocked on DUSDC supply (see §3 below).

---

## 1. Environment confirmed

| Item | Value |
|---|---|
| `sui --version` | `sui 1.68.0-homebrew` |
| Active env | `testnet` (`https://fullnode.testnet.sui.io:443`) |
| Active address | `0xdbbd9f28e35f510bd9d86b4787ed53e09cd49695ac98f4210af77284e63d7266` |
| SUI gas | ~7.33 SUI across two coins (already funded; no faucet call needed) |
| DUSDC balance | **0** (the blocker — see §3) |

---

## 2. PredictManager created — Day 2's real deliverable

Command:

```bash
sui client call \
  --package 0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138 \
  --module predict \
  --function create_manager \
  --gas-budget 50000000
```

**Tx digest:** `Cmnd6GvUaV19Zsz199CXJ93PqLYrMhTziupjJymLjMt2`
**Explorer:** https://suiscan.xyz/testnet/tx/Cmnd6GvUaV19Zsz199CXJ93PqLYrMhTziupjJymLjMt2

Created objects:

| Object | Owner | Notes |
|---|---|---|
| **`PredictManager`** `0xe55ea85bcf29d5cbea28e29cfaf6c3ecc58f461053aa06b4436b950e98608a3d` | `Shared(initial_shared_version=859413380)` | This is the **`MANAGER_OBJECT_ID`** for `.env`. |
| `BalanceManager` (wrapped) `0x5050866bf0e1666e241d46b5765a8b205aedaf3ff1de0aa7c81ccdd85166615a` | inside PredictManager | DeepBook v3 account — see §4. |
| `DepositCap` / `WithdrawCap` | inside PredictManager | Caps for the wrapped BalanceManager. |

Storage cost: 5,510,000 MIST. Computation: 1,000,000 MIST. Net cost
~5.5 milli-SUI — no surprises.

The `PredictManagerCreated` event was emitted with the new `manager_id`
and `owner`, exactly as `predict_manager::new`
([source line ~106](https://github.com/MystenLabs/deepbookv3/blob/predict-testnet-4-16/packages/predict/sources/predict_manager.move#L88-L107))
defines.

---

## 3. DUSDC acquisition — **the Day 2 blocker**

### What I tried

1. **Predict Server faucet** — none. Probed
   `/faucet`, `/dusdc`, `/api/faucet`, `/api/v1/faucet`, … all 404.
   Only `/health`, `/status`, `/managers`, `/oracles` exist on the server
   (it's an event indexer with a thin REST layer, not a fund-dispenser).
2. **`dusdc.move` public functions** — zero. Confirmed by
   `sui_getNormalizedMoveModule` returning `exposedFunctions: []`.
3. **Reading the source on `predict-testnet-4-16`**
   ([packages/dusdc/sources/dusdc.move](https://github.com/MystenLabs/deepbookv3/blob/predict-testnet-4-16/packages/dusdc/sources/dusdc.move)):

   ```move
   module dusdc::dusdc;
   public struct DUSDC has drop {}

   fun init(witness: DUSDC, ctx: &mut TxContext) {
       let (builder, treasury_cap) = coin_registry::new_currency_with_otw(
           witness, 6, b"DUSDC".to_string(), b"DeepBook USDC".to_string(),
           b"DeepBook Test USDC".to_string(),
           b"https://cryptologos.cc/logos/usd-coin-usdc-logo.svg".to_string(),
           ctx,
       );
       let metadata_cap = builder.finalize(ctx);
       transfer::public_transfer(treasury_cap, ctx.sender());
       transfer::public_transfer(metadata_cap, ctx.sender());
   }
   ```

   **The module has only `init`.** It runs once at publish time and
   transfers `TreasuryCap<DUSDC>` to the deployer. There is no public
   mint, no faucet, no permissionless issuance. This is intentional —
   the testnet token is gated.

### Implication

The only way to get DUSDC is **out-of-band from the Mysten team** (or
from a peer who has some). Options for Day 3:

- Ask in the official DeepBook / Mysten Discord channel
- Reach out to the deployer of the DUSDC package (sender of the publish
  tx: trace `0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a`'s
  `previousTransaction`)
- Borrow from a known active trader (their addresses are visible in
  `/managers` — e.g.
  `0x73f4bdd60c82bd4e2cdadd20cc334114caf15c07cb2865ab0adc97b88d9d53c3`,
  who has ~$4.6k DUSDC)
- **Don't block the whole plan** — Days 3–5 build the TS scaffold and
  read-only paths, which need no DUSDC. Deposit/mint testing can wait
  until DUSDC is in the wallet.

### What we'd run once DUSDC is in the wallet

```bash
# After getting at least 100 DUSDC (= 100_000_000 raw units):
DUSDC_COIN=$(sui client objects --json | jq -r '.[] | select(.objectType | contains("dusdc::DUSDC")) | .objectId' | head -1)

# Split off 100 DUSDC (100_000_000 with 6 decimals)
sui client split-coin --coin-id $DUSDC_COIN --amounts 100000000 --gas-budget 10000000

# Deposit into the PredictManager
sui client call \
  --package 0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138 \
  --module predict_manager \
  --function deposit \
  --type-args 0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC \
  --args 0xe55ea85bcf29d5cbea28e29cfaf6c3ecc58f461053aa06b4436b950e98608a3d <NEW_100_DUSDC_COIN> \
  --gas-budget 50000000
```

The `0xe55ea85b…` argument is **the PredictManager — Sui CLI accepts
shared objects by ID and resolves them automatically**.

---

## 4. Architecture finding not in the design doc

**`PredictManager` wraps a DeepBook v3 `BalanceManager`.** Confirmed by
reading the live object via `sui_getObject` with `showContent: true`:

```
PredictManager (0xe55ea85b…)
├── owner: address
├── balance_manager: BalanceManager       ← from 0xfb28c4cb…6982
│   └── (where DUSDC will actually live)
├── deposit_cap: DepositCap               ← from 0x984757fc…790a
├── withdraw_cap: WithdrawCap             ←
├── positions: Table<MarketKey, u64>      ← binary positions
└── range_positions: Table<RangeKey, u64> ← range positions
```

[`predict_manager::deposit`](https://github.com/MystenLabs/deepbookv3/blob/predict-testnet-4-16/packages/predict/sources/predict_manager.move#L73-L77)
delegates straight to `balance_manager::deposit_with_cap` — so the
"manager's DUSDC balance" is really the wrapped BalanceManager's balance.

The public view to read it from TypeScript is:

```move
public fun balance<T>(self: &PredictManager): u64  // line 69
```

Day 4 should call this via `devInspectTransactionBlock` rather than
walking the BalanceManager's dynamic fields manually.

### Two BalanceManager-related package IDs seen

| Pkg | Role | Source of fact |
|---|---|---|
| `0xfb28c4cbc6865bd1c897d26aecbe1f8792d1509a20ffec692c800660cbec6982` | Type defn of `BalanceManager` | `objectType` of the wrapped object |
| `0x984757fc7c0e6dd5f15c2c66e881dd6e5aca98b725f3dbd83c445e057ebb790a` | Type defn of `DepositCap`/`WithdrawCap`; also emits `BalanceManagerEvent` | event package, cap package |

These are two upgrade-versions of the same `deepbook` package. **Always
use `with_defining_ids` when comparing types in TS** — the SDK has
`normalizeStructTag` for this. (Plan day 6 should note this.)

---

## 5. Bonus: live oracle and indexer endpoints already verified

While probing for a faucet I confirmed the Predict Server's real API
shape — useful for Days 4 and 5:

| Endpoint | Returns | Day-5 use |
|---|---|---|
| `GET /health` | `200` empty | liveness |
| `GET /status` | `{status, latest_onchain_checkpoint, pipelines:[…]}` | indexer lag check |
| `GET /managers` | list of `PredictManagerCreated` events | `?owner=<addr>` filter works |
| `GET /oracles` | list of oracle states (2132 entries today) | live-oracle discovery |

A live BTC oracle suitable for Day 8 (expires soon):

| Field | Value |
|---|---|
| `oracle_id` | `0x990e6e4ac4439590e20d818fb5daa8d3e61c4e64b0827f14e8f1d0a263d8e5ca` |
| `oracle_cap_id` | `0x09c3dfff1abb4cd648753805c18a05bcc03d2a4c8f9f7a04b928568aed59f9e3` |
| `underlying_asset` | `BTC` |
| `expiry` (ms) | `1778607000000` |
| `min_strike` | `50000000000000` |
| `tick_size` | `1000000000` |
| `status` | `active` |

**Strike scaling decoded:** `min_strike = 50_000_000_000_000` with
`tick_size = 1_000_000_000` → **strikes are scaled by `1e9`** (so the
BTC min_strike is **$50,000.00**). That confirms the open question from
[Day 1 §5 question 6](day-01.md). Expiry is in **ms since epoch** —
matches Sui Clock.

---

## 6. What to put in `.env.example` already

We don't write code yet (Day 3), but Day 3 will need these. Recording
now so I don't re-discover them:

```env
RPC_URL=https://fullnode.testnet.sui.io:443
SERVER_URL=https://predict-server.testnet.mystenlabs.com

PACKAGE_ID=0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138
PREDICT_OBJECT_ID=0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a
PREDICT_REGISTRY_ID=0x43af14fed5480c20ff77e2263d5f794c35b9fab7e2212903127062f4fe2a6e64

MANAGER_OBJECT_ID=0xe55ea85bcf29d5cbea28e29cfaf6c3ecc58f461053aa06b4436b950e98608a3d
BALANCE_MANAGER_ID=0x5050866bf0e1666e241d46b5765a8b205aedaf3ff1de0aa7c81ccdd85166615a

QUOTE_COIN_TYPE=0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC
DUSDC_CURRENCY_ID=0xf3000dff421833d4bb8ed58fac146d691a3aaba2785aa1989af65a7089ca3e9c

# Day 4 / Day 8:
ORACLE_OBJECT_ID=0x990e6e4ac4439590e20d818fb5daa8d3e61c4e64b0827f14e8f1d0a263d8e5ca

# To be filled when keypair set up:
PRIVATE_KEY=
```

---

## 7. Successful Transactions

| Action | Digest |
|---|---|
| `predict::create_manager` | `Cmnd6GvUaV19Zsz199CXJ93PqLYrMhTziupjJymLjMt2` |

---

## 8. Open questions / carry-overs

1. **DUSDC source** — user decision: ask in Discord, ping deployer,
   borrow, or postpone deposit testing. Days 3–5 can proceed in any case.
2. **`MetadataCap` exposure** — `dusdc.move`'s `init` transfers
   `MetadataCap` to `ctx.sender()`. Confirms the deployer holds full
   admin rights over DUSDC metadata. Not a CLI concern.
3. **`BalanceManager` upgrade versions** — two package IDs seen
   (`0xfb28…6982` for the type, `0x984757fc…790a` for events/caps). Day 6
   PTBs must use `with_defining_ids` when comparing coin/cap types,
   otherwise the comparison will fail across upgrade boundaries.

---

## 9. Tomorrow's Starting Point

Day 3 — TypeScript project bootstrap. First actions:

1. `npm init -y` in repo root; install `@mysten/sui`, `tsx`, `typescript`,
   `dotenv`, `commander`, `zod`.
2. `tsconfig.json` with `strict: true`, ESNext modules, NodeNext resolution.
3. Write `.env.example` with the variables in §6 above.
4. Write `.gitignore` covering `.env`, `node_modules`, `dist`.
5. Write `src/config.ts` (zod-validated env loader), `src/client.ts`
   (singleton `SuiClient` + `Ed25519Keypair`).
6. Write `src/lib/predict.ts` with `getPredict()` and
   `src/scripts/inspect.ts` that prints the Predict shared object's
   parsed content via `sui_getObject` + `showContent: true` (no SDK
   "object reader" — straight RPC like §4 above).
7. `npm run inspect` verification: should print non-empty fields including
   `vault`, `treasury_config`, `oracle_config`, `withdrawal_limiter`.
