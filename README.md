# DeFa — Ignyte Smart Commerce Infrastructure Challenge

> On-chain credit operating infrastructure for SME trade finance. Deployed on **Polygon Amoy testnet**. Submission for the [Ignyte Smart Commerce Infrastructure Challenge](https://challenges.ignyte.ae/) hosted by **Polygon Labs**.

## What is DeFa

DeFa is a factory-cloned credit-pool protocol. Liquidity Providers deposit USDC into risk-tiered pools, PSPs and SMEs draw against verified receivables, and KAM → CAD → CRO → Legal approvals gate every facility before an on-chain admin signs pool deployment. Repayment waterfalls are automated on-chain; defaults settle from a treasury reserve.

## Live demo

- **App**: https://defa-polygon-hackathon.invoicemate.net *(deployment in progress — Jul 11)*
- **Access code**: `123456`
- **Chain**: Polygon Amoy (chain id `80002`)

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
