# DeFa — Ignyte Smart Commerce Infrastructure Challenge

> On-chain credit operating infrastructure for SME trade finance. Deployed on **Polygon Amoy testnet**. Submission for the [Ignyte Smart Commerce Infrastructure Challenge](https://challenges.ignyte.ae/) hosted by **Polygon Labs**.

## What is DeFa

DeFa is a factory-cloned credit-pool protocol. Liquidity Providers deposit USDC into risk-tiered pools, PSPs and SMEs draw against verified receivables, and KAM → CAD → CRO → Legal approvals gate every facility before an on-chain admin signs pool deployment. Repayment waterfalls are automated on-chain; defaults settle from a treasury reserve.

## Live demo

- **App**: https://defa-polygon-hackathon.invoicemate.net *(deployment in progress — Jul 11)*
- **Access code**: `123456`
- **Chain**: Polygon Amoy (chain id `80002`)

## How to test the live demo (all 6 roles, with credentials)

Every role in the DeFa lifecycle has a live account seeded on the demo stack. Use two browsers (or one browser + incognito) so you can be logged in as two roles at once.

### One-time wallet setup (needed for LP + Onchain Admin roles)

Import this private key into MetaMask (`Import Account → Private Key`):

```
0x692fb6f9b2c22e3d2ad4e0434f22f41617fb65ce1ac89146da2ae21b58443ce9
```

The wallet is address `0x0b9dDfcdB31aEf5Cde26d0E6DbAc6917B6849f05`, already on the on-chain admin allowlist and pre-funded with **1M MockUSD** on Amoy. Add Polygon Amoy to MetaMask (chain id `80002`, RPC `https://rpc-amoy.polygon.technology`) if not already there.

### 1. PSP / Borrower

| | |
|---|---|
| **URL** | https://defa-polygon-hackathon-admin.invoicemate.net/login |
| **Login** | `psp@demo.invoicemate.net` / `demo123` |
| **Pre-seeded state** | Mercury Cross-Border Payments · $1,000,000 approved credit line · KYR score 82/100 (AA) · UAE DIFC Cat 3C |

**What to test:**
1. Land on the PSP dashboard — see the Liquidity Facility Overview widget with real numbers.
2. Navigate to **My Facilities** (`/psp/borrow/facilities`) — one facility ("Demo Cross-Border Facility") already exists.
3. Click **"Request New Facility"** to add another. Fill credit line + tenor → submit. Facility moves to `KAM_REVIEW`.
4. After the KAM/CAD/CRO chain approves (below), come back and click into the facility → see the "+ Drawdown" button → click → the **Pick an Order** modal lists 6 real external orders (Al-Karim Trading, Meridian Textiles, etc.) — pick one to draw against.
5. Click into any drawdown record → see the **Validation Pipeline** widget expand to show all 5 checks passed.

### 2. KAM (Key Account Manager)

| | |
|---|---|
| **URL** | same admin URL |
| **Login** | `kam@maildrop.cc` / `admin123` |

**What to test:**
1. Log in → land on **Facility Queue** — any facility in `KAM_REVIEW` status appears here.
2. Click into the facility → see requested terms (credit line, tenor) + PSP company name + KYR score.
3. Click **Approve → CAD** → status flips to `CAD_REVIEW`. Or click **Reject** to bounce it back to the PSP with a note.

### 3. CAD (Credit & Documentation)

| | |
|---|---|
| **URL** | same admin URL |
| **Login** | `cad@maildrop.cc` / `admin123` |

**What to test:**
1. Log in → Facility Queue — facilities in `CAD_REVIEW` show here.
2. Click into the facility → CAD's job is to confirm the credit exposure fits portfolio limits.
3. Click **Approve → CRO** → status flips to `CRO_REVIEW`.

### 4. CRO (Chief Risk Officer)

| | |
|---|---|
| **URL** | same admin URL |
| **Login** | `cro@maildrop.cc` / `admin123` |
| **Extra** | Upload a credit-memo PDF via the "Upload memo" affordance (this is what surfaces as the "KYI Report" link on the LP's PoolDetails page). |

**What to test:**
1. Log in → Facility Queue → click the pending facility.
2. **This is where risk params get filled**: Util rate, Commit rate, Penalty rate, Grace/Penalty days, Max drawdown. Anything left blank falls back to envelope defaults.
3. Click **Approve** → status flips to `AWAITING_POOL_INIT`. Facility is now ready for the onchain admin.

### 5. Onchain Admin

| | |
|---|---|
| **URL** | https://defa-polygon-hackathon-admin.invoicemate.net/onchain-admin/login |
| **Login** | Connect Wallet → MetaMask → select the burner (`0x0b9d…f05`) → sign SIWE message |

**What to test:**
1. Click **Connect Wallet** — the RainbowKit modal appears. Pick MetaMask. Sign the SIWE prompt. Land on `/onchain-admin/facilities`.
2. Navigate to **Initialize Queue** — the facility (approved by CRO above) appears here.
3. Click **"Approve PSP + Initialize Pool"** → MetaMask prompts twice:
   - `factory.approvePsp(pspWallet)` — signs the PSP allowlist tx (~0.002 POL)
   - `factory.createPool(...)` — deploys a new pool clone (~0.010 POL)
4. Both tx hashes appear as toasts, verifiable on Polygonscan. The evmIndexer picks up the `PoolCreated` event within ~90s and mirrors the pool onto Mongo — refresh to see it disappear from the queue.
5. Once the pool is live and LPs have deposited past softCap, come back to the facility detail page → click **"Execute"** (moves pool from FUNDING → ACTIVE).

### 6. LP / Lender

| | |
|---|---|
| **URL** | https://defa-polygon-hackathon.invoicemate.net/ |
| **Access code** | `123456` (single-use per wallet — safe to re-run since we reset it post-demo) |
| **Wallet** | same burner as the onchain admin — RainbowKit accepts the same MetaMask account |

**What to test:**
1. Land on the DeFa landing page → click **"Now live on-chain"** hero → then the access-code entry flow.
2. Paste `123456` → fill name + email → **Connect Wallet** → sign SIWE. Redirects to `/wellcome` (dashboard hero) with live counters pulled from `/api/pools`.
3. Navigate to **Pools** — see 4 pool cards (Wise Pay Partners, EFI Remitt, TransferGo Capital, Skrill Cross-Border) with real APR, tenor, days-left computed from onchain state.
4. Click a pool card → PoolDetails page. Enter e.g. `1000` in the deposit form → click **Deposit** → MetaMask signs twice (approve USDC + deposit). Real onchain txs, verifiable on Polygonscan.
5. Scroll to **Business Overview** → click the **KYI Report** tile → downloads the credit memo PDF the CRO uploaded.
6. Navigate to **Dashboard** → see updated wallet balance + your position card.
7. After the PSP executes a drawdown and later repays, come back to the pool → click **Redeem** to claim yield + principal (two signs).

## Deployed contracts (verifiable on-chain)

| Contract | Address | Explorer |
|---|---|---|
| PoolFactory | `0xE02D8d3B14746E42c5D41a2CA805798D5A6E0F78` | [Polygonscan](https://amoy.polygonscan.com/address/0xE02D8d3B14746E42c5D41a2CA805798D5A6E0F78) |
| MockUSD | `0x4e39880B43f9a83586a2aC75a01dff779Eb958c0` | [Polygonscan](https://amoy.polygonscan.com/address/0x4e39880B43f9a83586a2aC75a01dff779Eb958c0) |
| TreasuryReserve | `0x03D21aFF05a94E2B87d1F55b2deE8F6f3fd9D9f8` | [Polygonscan](https://amoy.polygonscan.com/address/0x03D21aFF05a94E2B87d1F55b2deE8F6f3fd9D9f8) |

Three demo facilities live on-chain: **Mercury Settlements USDC Facility** (12% APR, Medium risk), **Aurum Cross-Border Corridor** (6% APR, Low risk), **Meridian FX Working Capital** (14% APR, Medium risk).

## The full lifecycle in one flow

```
1.  PSP signs up             → creates KYB submission
2.  PSP requests facility    → status: KAM_REVIEW
3.  KAM approves             → status: CAD_REVIEW
4.  CAD approves             → status: CRO_REVIEW
5.  CRO approves + terms     → status: AWAITING_POOL_INIT
6.  On-chain admin signs     → factory.approvePsp + factory.createPool
7.  evmIndexer picks up      → pool visible on /pools within 90s
8.  LP deposits              → approve + deposit txs (2-step)
9.  PSP draws                → server signs as AGENT2, USDC to receiver
10. PSP repays               → principal + util fee + penalty split
11. LP redeems               → claimYield + claimPrincipal (2-step)
```

## Repository structure

```
├── client/           v2 lender UI (React 19 + Vite + Tailwind v4 + wagmi + RainbowKit)
├── client-legacy/    PSP + admin portals (KAM/CAD/CRO/Legal/onchain-admin)
├── server/           Node/Express + Mongoose + ethers v6
│   ├── routes/       18 route files — auth, facility, poolTx, admin, faucet, etc.
│   ├── services/     poolServiceEvm (ethers client), walletAuthEvm (SIWE)
│   ├── workers/      evmIndexer (polls PoolCreated + DrawdownExecuted + Repaid)
│   └── test/         38-test suite (e2eFlows + lifecycleFlows + onchainFlows)
├── contracts/        Foundry payfi_v1 (7 Solidity sources, ~17K LOC test coverage)
└── docs/             ARCHITECTURE.md, LOCAL_E2E.md, DEPLOYMENT.md
```

## Test coverage — 38 integration tests, all passing on real Polygon Amoy

| Suite | Result |
|---|---|
| `e2eFlows.test.js` — auth, marketplace, deposit build-tx, faucet, gates, stubs | 18/18 |
| `lifecycleFlows.test.js` — PSP → KAM → CAD → CRO → onchain admin gating | 13/13 |
| `onchainFlows.test.js` — real approvePsp + createPool + faucet mint + BE state read | 7/7 |

Same suite runs green on Arc Testnet (see sibling repo).

## Contract security posture

The `payfi_v1` contract set (in `contracts/`) uses:

- **~17K LOC of Foundry test coverage** across 26 test files — invariant, adversarial (4 rounds), differential, fuzz, gas-profile, view-mutation consistency, security-focused.
- **OpenZeppelin v5.x** primitives (`AccessControl`, `ReentrancyGuard`, `Clones`, `SafeERC20`).
- **EIP-1167 minimal proxies** for facility clones — cheap gas per facility, ~0.02 POL to deploy a new pool on Amoy.
- **`_disableInitializers` guard** on the implementation contract (only clones via the factory can be initialized).
- **WAD fixed-point math** with property-based invariant tests.

## Run locally

Full step-by-step in [`docs/LOCAL_E2E.md`](docs/LOCAL_E2E.md). Short version:

```bash
# 1. Boot Mongo + Anvil
brew services start mongodb-community
anvil --chain-id 31337

# 2. Deploy contracts to Anvil
cd contracts
forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

# 3. Server
cd server && cp .env.example .env && npm install && npm run dev

# 4. Lender UI (port 5173)
cd client && cp .env.example .env && npm install && npm run dev

# 5. Admin UI (port 5175)
cd client-legacy && cp .env.example .env && npm install && npm run dev

# 6. Access code 123456 to sign up
```

## Deploy to your own testnet

See [`DEPLOYMENT.md`](DEPLOYMENT.md) — Vercel + Railway walkthrough, or [`docker-compose.alt.yml`](docker-compose.alt.yml) for a single-VM deploy.

## Team

Two-person submission — Ibrahim Ansari (CEO, product + workflow spec) and Hamza Anjum (CTO, full-stack build).

## Docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — 3 Mermaid diagrams (top-level, lifecycle sequence, contract class)
- [`docs/LOCAL_E2E.md`](docs/LOCAL_E2E.md) — Full local dev setup
- [`server/TESTING.md`](server/TESTING.md) — Test suite documentation
- [`DEPLOYMENT.md`](DEPLOYMENT.md) — Production deploy runbook

## License

MIT.
