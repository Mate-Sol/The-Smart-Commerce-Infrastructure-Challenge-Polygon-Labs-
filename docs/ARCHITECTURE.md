# DeFa — System Architecture

*Ignyte Smart Commerce Infrastructure Challenge submission — deployed on Polygon Amoy testnet.*

DeFa is on-chain credit operating infrastructure for SME trade finance. LPs deposit stablecoins, PSPs / SMEs draw against verified receivables, KAM → CAD → CRO → Legal approvals gate every facility, on-chain admin signs pool deployment. Automated repayment waterfalls, tiered risk pools, and cleaner on-chain accounting than legacy trade-credit rails.

## Top-level architecture

```mermaid
graph TB
  subgraph browser["👥 USER-FACING PORTALS"]
    lender[🔵 Lender UI<br/>defa_v2 React + wagmi<br/>Vercel]
    psp_admin[🟠 PSP + Admin UI<br/>Colosseum client + wagmi<br/>Vercel]
    wallet["🦊 MetaMask / RainbowKit<br/>signs SIWE + txs"]
    lender -.wallet.-> wallet
    psp_admin -.wallet.-> wallet
  end

  subgraph backend["⚙️ BACKEND"]
    api["📡 Node/Express API<br/>Railway"]
    mongo[("💾 MongoDB<br/>Users • PSPProfiles • Facilities<br/>AccessCodes • PoolState")]
    indexer["🔄 EVM Event Indexer<br/>polls PoolCreated, Deposit,<br/>DrawdownExecuted, Repaid"]
    api --> mongo
    indexer --> mongo
  end

  subgraph onchain["⛓️ POLYGON AMOY (chain 80002)"]
    factory["🏭 PoolFactory<br/>EIP-1167 clones<br/>PSP registry + envelope"]
    pool["💧 PoolContract (per-facility)<br/>deposit • drawdown • repay<br/>yield claim • default handling"]
    treasury["🏦 TreasuryReserve<br/>protocol fees • insurance reserve"]
    usdc["💵 USDC/MockUSD<br/>6-decimal stablecoin rail"]
    factory -.clones.-> pool
    pool -.settles in.-> usdc
    pool -.protocol split.-> treasury
  end

  lender --> api
  psp_admin --> api
  api -->|reads state| pool
  api -->|reads state| factory
  api -->|reads state| treasury
  wallet -->|signs writes| factory
  wallet -->|signs writes| pool
  indexer -->|polls events| factory
  indexer -->|polls events| pool

  classDef userBox fill:#d4e6ff,stroke:#0066cc,color:#000
  classDef beBox fill:#fff4d4,stroke:#b8860b,color:#000
  classDef chainBox fill:#e0f0e0,stroke:#2d7d2d,color:#000
  class lender,psp_admin,wallet userBox
  class api,mongo,indexer beBox
  class factory,pool,treasury,usdc chainBox
```

## Facility lifecycle (KAM → CAD → CRO → Legal → On-chain Admin)

```mermaid
sequenceDiagram
  autonumber
  actor PSP as PSP
  actor KAM as KAM
  actor CAD as CAD
  actor CRO as CRO
  actor OCA as On-chain Admin
  actor LP as Lender
  participant BE as Backend API
  participant DB as MongoDB
  participant CH as Polygon Amoy

  PSP->>BE: POST /psp/apply-limit (KYB submit)
  BE->>DB: PSPProfile.workflowStep = FINALIZED
  PSP->>BE: POST /facility/request (terms)
  BE->>DB: Facility.status = KAM_REVIEW

  KAM->>BE: POST /facility/:id/approve
  BE->>DB: → CAD_REVIEW
  CAD->>BE: POST /facility/:id/approve
  BE->>DB: → CRO_REVIEW
  CRO->>BE: POST /facility/:id/approve (+ term overrides)
  BE->>DB: → AWAITING_POOL_INIT

  OCA->>BE: POST /admin/build-tx/approve-psp<br/>POST /admin/build-tx/initialize-pool
  BE-->>OCA: calldata (approve-psp, createPool)
  OCA->>CH: signs approvePsp + createPool
  CH-->>CH: emits PoolCreated event

  BE->>CH: evmIndexer polls (90s)
  BE->>DB: Facility.poolPda = <new pool>
  BE->>DB: mirror PoolState

  LP->>BE: POST /pool/lender/build-tx/deposit
  BE-->>LP: steps: [approve, deposit]
  LP->>CH: signs approve + deposit
  CH-->>LP: LP receives pro-rata pool share

  PSP->>BE: POST /psp/exec/drawdown
  BE->>CH: server signs AGENT2 executeDrawdown
  CH-->>PSP: USDC to authorized receiver

  PSP->>BE: POST /psp/build-tx/repay
  BE-->>PSP: calldata
  PSP->>CH: signs repay (principal + util fee + penalty)

  LP->>BE: POST /pool/lender/build-tx/redeem
  BE-->>LP: steps: [claimYield, claimPrincipal]
  LP->>CH: signs both → receives principal + yield
```

## Contract set (payfi_v1)

```mermaid
classDiagram
  class PoolFactory {
    +approvePsp(address)
    +revokePsp(address)
    +createPool(params)
    +setEnvelope(bounds)
    +psps mapping
    +poolCount, poolImplementation
  }

  class PoolContract {
    +initialize(params)
    +deposit(uint256)
    +withdraw(uint256)
    +finalizeFunding()
    +executeDrawdown(ref, receiver, amt, days)
    +repay(bytes32 ref)
    +payAccruedIdleFees(amount)
    +claimYield()
    +claimPrincipal()
    +declareDefault()
    +sweepProtocolFees()
    -status enum
    -drawDowns mapping
    -lpPositions mapping
  }

  class TreasuryReserve {
    +drawReserve(uint256)
    +topUp(uint256)
    +depositImFees(uint256)
    +setFactory(address)
  }

  class MockStablecoin {
    <<ERC-20, 6 decimals>>
    +mint(to, amount)
    +transfer / approve / balanceOf
  }

  PoolFactory "1" *-- "many" PoolContract : clones
  PoolContract --> TreasuryReserve : protocol fees split
  PoolContract --> MockStablecoin : settlement asset
  PoolFactory --> MockStablecoin : reference for pools
```

## Deployed on Polygon Amoy (chain 80002)

| Contract | Address | Explorer |
|---|---|---|
| **PoolFactory** | `0xE02D8d3B14746E42c5D41a2CA805798D5A6E0F78` | [amoy.polygonscan.com](https://amoy.polygonscan.com/address/0xE02D8d3B14746E42c5D41a2CA805798D5A6E0F78) |
| **MockUSD** | `0x4e39880B43f9a83586a2aC75a01dff779Eb958c0` | [amoy.polygonscan.com](https://amoy.polygonscan.com/address/0x4e39880B43f9a83586a2aC75a01dff779Eb958c0) |
| **TreasuryReserve** | `0x03D21aFF05a94E2B87d1F55b2deE8F6f3fd9D9f8` | [amoy.polygonscan.com](https://amoy.polygonscan.com/address/0x03D21aFF05a94E2B87d1F55b2deE8F6f3fd9D9f8) |

**3 demo facilities live on-chain**: Mercury Settlements USDC Facility (12% APR, Medium risk), Aurum Cross-Border Corridor (6% APR, Low risk), Meridian FX Working Capital (14% APR, Medium risk).

## Repo structure

```
├── client/           v2 lender UI  (React 19 + Vite + Tailwind v4 + wagmi + RainbowKit)
├── client-legacy/    PSP + admin portals (KAM/CAD/CRO/Legal/onchain-admin)
├── server/           Node/Express + Mongoose + ethers v6
│   ├── routes/       18 route files — auth, facility, poolTx, admin, faucet, etc.
│   ├── services/     poolServiceEvm (ethers client), walletAuthEvm (SIWE)
│   ├── workers/      evmIndexer (polls PoolCreated + DrawdownExecuted + Repaid)
│   └── test/         38-test suite (e2eFlows + lifecycleFlows + onchainFlows)
├── contracts/        Foundry payfi_v1 (7 Solidity sources, ~17K LOC test coverage)
└── docs/             This file, LOCAL_E2E, DEPLOYMENT
```

## Test coverage

**76 integration tests across two testnets, 38 per chain, all green.**

| Suite | Amoy | Arc |
|---|---|---|
| `e2eFlows.test.js` (auth, marketplace, deposit, faucet, gates, stubs) | 18/18 ✅ | 18/18 ✅ |
| `lifecycleFlows.test.js` (PSP → KAM → CAD → CRO → onchain admin) | 13/13 ✅ | 13/13 ✅ |
| `onchainFlows.test.js` (real approvePsp + createPool + faucet mint + BE state read) | 7/7 ✅ | 7/7 ✅ |
