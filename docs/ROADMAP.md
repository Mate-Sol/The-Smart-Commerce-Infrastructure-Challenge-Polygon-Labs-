# DeFa — Launch Roadmap

**Post-hackathon path to production for the DeFa on-chain credit primitive.**

The Ignyte submission ships the full lifecycle running on Polygon Amoy today. The roadmap below is what turns that hackathon build into a licensed, audited, multi-corridor production rail.

---

## Phase 1 — Sprint (through Aug 2026)

- **Jul 13, 2026** — Ignyte submission.
- **Jul – Aug 2026** — Pilot facility onboarded with a live PSP partner in the UAE ↔ Pakistan corridor, drawing on real USDC over the CBUAE PTSR bridge.
- **Aug 2026** — Third-party audit engaged for the `payfi_v1` contract set (targeting OpenZeppelin or Trail of Bits).
- **Metrics**: 1 live facility, real drawdowns onchain, one PSP partner, audit engagement letter signed.

## Phase 2 — Q4 2026

- Migrate `MockStablecoin` → **native USDC on Polygon PoS mainnet**.
- **`PoolFactory v2`** — configurable per-pool risk envelopes, protocol-fee auction, multi-asset support (USDC + PYUSD).
- Legal wrapper for pool holders — Prescribed Company / SPV structure per pool, LP-share tokenisation for secondary transfer.
- Integrate the KAM → CAD → CRO agent path — deterministic gates first (KYB completeness, portfolio exposure recompute, risk-envelope check), human multisig for the on-chain admin signer.
- **Metrics**: 3 live facilities, audit report published, mainnet contracts deployed, first LP off-ramp round.

## Phase 3 — H1 2027

- 3 live facilities across UAE ↔ Pakistan, UAE ↔ South Africa, and Gulf ↔ Kenya corridors.
- **Target: $10M cumulative drawdown volume** across pilot facilities by end of H1.
- Institutional LP onboarding via DIFC Cat 3C arrangement.
- Agent-driven KAM / CAD reviews live in production behind a human-approval fallback.
- **Metrics**: $10M cumulative drawdown volume, $5M live TVL, 5+ institutional LPs on-ramped, first defaulted-pool cure completed via `TreasuryReserve`.

## Phase 4 — H2 2027

- Open the `payfi_v1` set to third-party PSPs via a hosted-facility model — any regulated PSP can spin up a credit pool without running the underwriting stack themselves.
- **Multi-chain deployment** — Polygon PoS + Arc + Base, with CCTP-based liquidity balancing (LP funds on Polygon, PSP draws to Ethereum L1 supplier wallet, waterfall repay flows back).
- **Target: $50M cumulative drawdown volume**, $5M live TVL, 3 new PSPs hosted on the platform.
- Regulatory expansion — VARA (Dubai), FSA (Seychelles), MAS (Singapore) sandbox tracks.

## Phase 5 — 2028+

- **Public credit-scoring primitive** — KYR scores published on-chain as attestations, so PSPs get a portable credit history that carries across banks and pools rather than starting from zero at each new lender.
- **Trade finance in a stablecoin-native form** — settlement, credit, and yield on the same rail, with cross-corridor arbitrage between USDC-native chains.

---

## Go-to-market — what's real today

Our existing distribution surface is the launchpad, not a hypothesis:

1. **Warm-start liquidity from existing InvoiceMate LP relationships.** We already run pooled credit for 20+ institutional partners off-chain today; migrating those seats onto DeFa is a product upgrade, not a new sales cycle.
2. **PSP-side onboarding via existing bank partnerships.** Soneri, Bank Islami, Zindigi, ADIB — each already integrates with our KYB + credit workflow. Adding an on-chain drawdown rail is an incremental route, not a rip-and-replace.
3. **Regulatory tailwind.** UAE PTSR + South Africa FSCA + DIFC Cat 3C already permit exactly this activity — we are not waiting for regulation to catch up.
4. **Ecosystem partnerships.** Existing MoUs with Stellar Development Foundation, Hub71, IOTA Foundation, and Taisu Ventures give us co-marketing and distribution surface across MENA + APAC.

---

## Milestones summary (roll-up)

| Phase | Timeline | Volume target | LP count | PSP count |
|---|---|---|---|---|
| Phase 1 | Jul–Aug 2026 | 1 pilot facility | 0 (bootstrap) | 1 |
| Phase 2 | Q4 2026 | 3 facilities | 3–5 | 2 |
| Phase 3 | H1 2027 | **$10M drawdown** · $5M TVL | 5+ institutional | 3 |
| Phase 4 | H2 2027 | **$50M drawdown** · $5M TVL | 8+ | 5+ (hosted) |
| Phase 5 | 2028 → | on-chain credit rail at scale | open ecosystem | open ecosystem |

---

## What "done" looks like

- Any PSP with regulator paperwork can spin up a credit pool in one flow.
- Any LP can browse those pools, deposit USDC, watch drawdowns settle in real time, and claim yield — the same experience whether they're a family office or a passive on-chain LP.
- Every underwriting decision (KYR score, credit line, drawdown validation) lives on-chain as an attestation, portable across banks.
- Trade finance stops being a paper workflow and starts being a stablecoin-native protocol.

That's the endgame. Everything in phases 1–4 is what it takes to get there.
