# Security Policy

## Contract security posture

The `payfi_v1` Solidity contract set in `contracts/` ships with the following posture:

- **~17K LOC of Foundry test coverage** across 26 test files
  - Unit tests for every external entry point
  - Property-based invariant tests (5 invariants across pool + treasury)
  - Adversarial suites (4 rounds — replay, front-running, griefing, insolvency)
  - Differential fuzzing against a reference Rust implementation of the WAD math
  - Gas-profile regressions
  - View-mutation consistency checks (every view returns the same tuple mutations would produce)
- **OpenZeppelin v5.x** — `AccessControl`, `ReentrancyGuard`, `Clones`, `SafeERC20`
- **EIP-1167 minimal proxies** for facility clones — cheap gas per facility, no code duplication
- **`_disableInitializers` guard** on the implementation contract — only clones deployed via the factory can be initialized; direct calls to the impl revert
- **WAD fixed-point math** with property-based invariant tests
- **AGENT1 / AGENT2 role separation** — the AGENT2 signer (backend) can `executeDrawdown` but cannot mint, upgrade, or touch protocol fees
- **TreasuryReserve** — protocol fee sink + insurance reserve, drawn from only on declared default

## Audit plan

- **Q3 2026** — engage a third-party audit firm (OpenZeppelin or Trail of Bits) for the full `payfi_v1` set before Polygon PoS mainnet cutover.
- **Report will be published** in `docs/AUDIT.md` on the same repo prior to mainnet launch.
- Until then, mainnet deployments are gated by the audit clearance.

## Reporting a vulnerability

**Do not open a public GitHub issue for security bugs.**

Report to: **security@invoicemate.net**

Include:
- Impact (what an attacker gains)
- Reproduction (steps or PoC)
- Affected commit hash
- Suggested fix if you have one

We commit to:
- Acknowledge within 48 hours
- Patch or explain the risk decision within 14 days for critical / high-severity issues
- Credit reporters (with permission) in the release notes

## Scope

- ✅ `contracts/` — Solidity contracts
- ✅ `server/` — backend API (auth, faucet, indexer, build-tx endpoints)
- ✅ `client/` — v2 lender UI
- ✅ `client-legacy/` — PSP + admin portals
- ❌ Third-party dependencies (report upstream)
- ❌ Testnet-only assets (private keys deliberately published for the hackathon in `.env.production.example` are out of scope — they will be rotated before mainnet)
