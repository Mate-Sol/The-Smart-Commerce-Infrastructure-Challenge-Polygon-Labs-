# Architecture

DeFa is three components glued by JWT and signed Solana transactions:

```
                      ┌────────────────────────────────────────┐
                      │             SOLANA DEVNET              │
                      │   paymate-pool-v2 (Anchor program)     │
                      │                                        │
                      │   Pool PDA   ◄── (psp_wallet, fac_id)  │
                      │   Drawdown PDA                          │
                      │   Vault (SPL ATA owned by Pool)         │
                      │   LP Mint                               │
                      └─▲───────────▲─────────────▲─────────────┘
                        │           │             │
                        │ signs     │ signs       │ events + state
                        │           │             │
        ┌───────────────┴┐    ┌─────┴──────┐  ┌───┴────────────────────┐
        │ Lender wallet  │    │ PSP wallet │  │ server/  (Express+Mongo)│
        │ (Phantom/Bp.)  │    │ (Phantom)  │  │                         │
        └───────┬────────┘    └─────┬──────┘  │ · Anchor client builds  │
                │                   │         │   tx → user signs →     │
                │ JWT (lender)      │ JWT     │   /relay/submit adds    │
                │ via SIWS          │ (PSP)   │   feePayer sig          │
                │                   │         │ · solanaIndexer mirrors │
                ▼                   ▼         │   PoolState/DrawdownState
        ┌───────────────────────────────────┐ │ · /facility/* approval  │
        │       client/ (Vite + React)      │ │   workflow              │
        │                                   │ │ · /access-code/*        │
        │  Public  : /  /apply-access /login│ │ · /pool/* build-tx +    │
        │  Lender  : /lender/*              │◄┤   read endpoints        │
        │  PSP     : /psp /psp/borrow/*     │ │                         │
        │  Admin   : /admin/* (KAM/CAD/CRO/ │ └─────────────────────────┘
        │            CFO/Legal/SuperAdmin)  │
        │  OnChain : /onchain-admin/*       │
        └───────────────────────────────────┘
```

---

## Identity model

Three identities live side by side:

| Identity | Storage | Issued by | Auth field |
|---|---|---|---|
| **PSP user** | sessionStorage | `/auth/login` (email + password) | `kind: 'user'` JWT, `role: 'PSP'` |
| **Admin user** | sessionStorage | `/auth/login` | `kind: 'user'` JWT, `role: 'KAM'/'CAD'/'CRO'/'CFO'/'LEGAL_ADMIN'/'SUPER_ADMIN'` |
| **Lender** | localStorage | `/auth/wallet/login` (SIWS) **or** `/access-code/redeem` | `kind: 'lender'` JWT, `lenderId`, `wallet` |
| **On-chain admin** | sessionStorage | `/auth/wallet/onchain-admin/login` (wallet must be in `ONCHAIN_ADMIN_WALLETS` env) | `kind: 'user'` JWT, `role: 'ONCHAIN_ADMIN'` (auto-created shadow User) |

`services/solana.js` `getToken()` picks storage based on URL path so a stale token from one portal never shadows another.

---

## Sequence: PSP first facility lifecycle

```
PSP                   Admin queue           CRO              On-chain admin     Lender(s)        Solana program
 │                      │                    │                     │                │                │
 │ /apply-limit, KYC … (existing onboarding flow)                  │                │                │
 │ ───────────────────► │  KAM → CAD → CRO → Legal → FINALIZED     │                │                │
 │                      │                    │                     │                │                │
 │ /facility/request    │                    │                     │                │                │
 │ {creditLine, tenor,  │                    │                     │                │                │
 │  rates, secondsPerDay│                    │                     │                │                │
 │  ?}                  │                    │                     │                │                │
 │                      │ Facility KAM_REVIEW│                     │                │                │
 │                      │                    │ /facility/:id/      │                │                │
 │                      │                    │  approve            │                │                │
 │                      │                    │ (terms editable)    │                │                │
 │                      │                    │ → AWAITING_POOL_INIT│                │                │
 │                      │                    │                     │ initialize_pool│                │
 │                      │                    │                     │ (admin signs)  │ ──────────────►│ Pool PDA created
 │                      │                    │                     │                │                │
 │                      │                    │                     │                │ deposit USDC   │
 │                      │                    │                     │                │ ──────────────►│ Vault filled, LP minted
 │                      │                    │                     │ execute_       │                │
 │                      │                    │                     │  facility      │ ──────────────►│ Active
 │                      │                    │                     │                │                │
 │ /quick-request-      │                    │                     │                │                │
 │  financing           │                    │                     │                │                │
 │ → AwaitingDrawdown   │                    │                     │                │                │
 │                      │                    │                     │                │                │
 │ request_drawdown     │                    │                     │                │                │
 │ (PSP signs)          │ ──────────────────────────────────────────────────────────────────────────►│ Drawdown PDA, USDC out
 │                      │                    │                     │                │                │
 │ … days later …       │                    │                     │                │                │
 │ repay (PSP signs)    │ ──────────────────────────────────────────────────────────────────────────►│ Principal + util + penalty
 │                      │                    │                     │                │                │
 │ settle_commit_fee    │ ──────────────────────────────────────────────────────────────────────────►│ Pool commit fee → 0
 │                      │                    │                     │                │                │
 │                      │                    │                     │                │ redeem_lp      │
 │                      │                    │                     │                │ ──────────────►│ Pro-rata USDC out
```

Subsequent facilities skip KAM + CAD and go straight to CRO.

---

## Lender access codes

```
On-chain admin                   Server                        Prospective lender
      │                            │                                    │
      │ POST /access-code/create   │                                    │
      │ {count, label}             │                                    │
      │ ─────────────────────────► │                                    │
      │ ◄────────── codes[]        │                                    │
      │                            │                                    │
      │ shares code out-of-band ──►│                                    │
      │                            │                                    │
      │                            │ POST /access-code/check {code}     │
      │                            │ ◄───────────────────────────────── │
      │                            │ {valid: true} ───────────────────► │
      │                            │                                    │
      │                            │ POST /access-code/redeem           │
      │                            │ {code, name, email, wallet,        │
      │                            │  nonce, signature}                 │
      │                            │ ◄───────────────────────────────── │
      │                            │ atomic: claim code → upsert Lender │
      │                            │  → issue lender JWT                │
      │                            │ {token, lender} ─────────────────► │
      │                            │                                    │
      │                            │ subsequent visits                  │
      │                            │ POST /auth/wallet/login            │
      │                            │ ◄───────────────────────────────── │
      │                            │ (no code needed; wallet bound)     │
```

---

## Off-chain ↔ on-chain consistency

The on-chain program is the **single source of truth** for fees and state. Off-chain code:

1. **Indexer** (`workers/solanaIndexer.js`) — polls every 15s, mirrors Pool + Drawdown account state into Mongo, ingests `repaid: false → true` transitions as `RepaymentRecord` rows.
2. **Daily-activity replay** (`/pool/:pool/daily-activity`) — fetches all program signatures, decodes events, replays day-by-day to produce a P&L breakdown. Uses the **same** per-drawdown formulas the on-chain `repay` uses (sum of active principals × bps, not peak-based) so totals match exactly.
3. **Per-drawdown amortization** (`/pool/:pool/drawdown/:id/amortization`) — uses the literal on-chain `min(days_active, tenor + grace)` / `max(0, days_active − tenor − grace)` formulas.

If the chain says one thing and the dashboard says another, the chain wins; the dashboard is rebuilt from chain events.

---

## Time-warp testing

Every Pool stores `seconds_per_day` (60..86_400). `300` means 5 real minutes = 1 chain day. The on-chain `day_index_for(now, seconds_per_day)` helper is used everywhere a timestamp gets bucketed into days. Off-chain endpoints read `pool.secondsPerDay` from the chain account so they bucket events the same way.

The on-chain admin's facility detail page renders a live `FacilityClock` widget that updates every second, showing day-of-tenor, days remaining, and a countdown to the next on-chain day boundary. Useful for visually confirming warp-mode behavior during demos.

---

## File-level pointers

- Contract: [`solana/code/paymate-pool-v2/programs/paymate-pool-v2/src/lib.rs`](../solana/code/paymate-pool-v2/programs/paymate-pool-v2/src/lib.rs)
- Anchor client: [`server/services/poolService.js`](../server/services/poolService.js)
- Build-tx + read endpoints: [`server/routes/poolTx.js`](../server/routes/poolTx.js)
- Facility lifecycle: [`server/routes/facility.js`](../server/routes/facility.js)
- Access codes: [`server/routes/accessCode.js`](../server/routes/accessCode.js)
- Indexer: [`server/workers/solanaIndexer.js`](../server/workers/solanaIndexer.js)
- Wallet auth: [`server/routes/walletAuth.js`](../server/routes/walletAuth.js), [`server/services/walletAuth.js`](../server/services/walletAuth.js)
- Frontend wallet helpers: [`client/src/services/solana.js`](../client/src/services/solana.js)
- Live FacilityClock: in [`client/src/pages/onchain-admin/FacilityDetail.jsx`](../client/src/pages/onchain-admin/FacilityDetail.jsx)
