# Solana Migration — Decisions & Plan

Single source of truth for the EVM → Solana migration. All decisions captured during planning; update this doc when anything changes.

## Status

- **Phase 1 — Demolish EVM**: in progress / first PR.
- **Phase 2 — Solana foundation**: pending.
- **Phase 3 — Backend integration**: pending.
- **Phase 4 — Frontend integration**: pending.
- **Phase 5 — Tests / docs**: pending.
- **Phase 6 — Mainnet readiness**: pending.

---

## Architecture decisions (locked)

### Wallet / signing model
- **Non-custodial across all roles.** PSP, lender, and admin all connect their own Solana wallets.
- **No server-held private keys for on-chain actions.** Every state transition is initiated by a connected wallet through the appropriate UI.
- **PSP wallet is captured at registration** via connect-wallet and stored on `PSPProfile.solana_wallet`. The wallet is **immutable per pool** because `pool.psp_wallet` is baked into the pool PDA seeds.
- **Lender auth is wallet-only**: connect wallet → sign nonce → JWT. No email/password.

### Pool creation & lender onboarding
- **Pool init is gated by the existing approval workflow.** CRO final approval transitions the workflow to `AWAITING_POOL_INIT`; admin signs `initialize_pool` from the admin portal.
- **Lender deposits are open** — no allowlist, no KYC at MVP. (Mainnet KYC question is deferred to Phase 6.)

### Token
- **Custom SPL mint** as a fake USDC for testing — devnet 6-decimal "USDC-DF".
- **Faucet**: 1M per call, lifetime 10M cap per recipient pubkey.
- Mainnet flip: real USDC mint (`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`) via env var swap.

### State / source-of-truth
- **Mongo** is authoritative for: PSP profile, approval workflow, audit logs, notifications, support tickets, business metadata.
- **On-chain** is authoritative for: vault balances, LP supply, drawdown principal, accrued fees, lifecycle state.
- **Indexer**: polling-based (`getProgramAccounts` every ~15s) for v1. Free, simple. Helius webhooks deferred.

### Fee-payer relay
- Server signs as `feePayer` so PSPs / lenders / admin never need SOL.
- **Dedicated keypair** in `FEE_PAYER_PRIVATE_KEY` env var, separate from any other key.
- Required abuse controls: instruction allowlist (only this program's instructions), per-wallet rate limit + daily quota, SOL balance auto-topup with alerting.
- Reference: Octane (Solana Labs); we'll roll a slim version since we only have ~6 instructions to relay.

### Admin signing scope
Admin only signs four instructions, all surfaced as buttons in the admin dashboard:

| Instruction | Frequency | Trigger |
|---|---|---|
| `initialize_pool` | Once per pool | After CRO approval |
| `execute_facility` | Once per pool | When `total_capital >= soft_cap` |
| `claim_protocol_fees` | Optional | When `protocol_fees_owed > 0` |
| `declare_default` | Rare | After `tenor_end + 30 days` if PSP defaults |

Drawdowns / repayments / commit-fee settlement are PSP-signed. Deposits / withdraws / redemptions are lender-signed.

### Contract additions
- **`cancel_funding`** instruction — to be added before mainnet. Admin-only, callable when `!is_active`. Marks pool `is_cancelled`. Lenders use existing `withdraw_funding` to exit. No automatic refund loop.
- **No on-chain pause exists** by design. The program already blocks new draws automatically when an existing drawdown is past `tenor + grace + penalty`.

### Disposable data
- No EVM data migration. Wipe and reseed.

---

## Phase 1 — Demolish EVM (this PR)

- [x] Delete `contract/` (Hardhat / Solidity tree).
- [x] Delete `server/services/contractService.js`.
- [x] Strip `contractService` imports + call sites from `routes/admin.js`, `routes/auth.js`, `routes/cfo.js`, `routes/maintenance.js`, `routes/psp.js`, and the three EVM workers.
- [x] Replace expiry checks with `creditLineEndDate`-based logic.
- [x] Workers refactored: `disbursementAgent` transitions to `AwaitingDrawdown` and notifies PSP. `overdueWatcher` becomes a pure notifier (penalty is automatic on-chain). `repaymentAgent` had only an unused require.
- [x] Drop `ethers` dependency from `server/` and `client/` package.json.
- [x] Strip 506-line dead `poolABI` block from `RepaymentModal.jsx`.
- [x] Replace 9 hardcoded `etherscan.io` / `sepolia.etherscan.io` URLs with a `services/explorer.js` helper that points at Solana Explorer.
- [x] Drop EVM env vars from `server/.env`. Add Solana placeholders. Create `server/.env.example`.
- [x] Add `.env` to `server/.gitignore` to prevent re-leaks.
- [x] Update `README.md`, `USER_FLOW.md`, `REPAYMENT_LOGIC.md` to describe Solana flow.

**User to-do (out-of-band)**: rotate leaked credentials that were in the committed `.env` — Mongo connection string, JWT secret, SendGrid API key, Eficyent password, Azure storage account key. The two leaked EVM private keys are removed but still in git history; they're now valueless since the EVM contracts are gone.

---

## Phase 2 — Solana foundation (next)

- Verify `anchor build` works against `solana/code/paymate-pool-v2/`.
- Generate fresh program keypair + deploy to devnet; commit IDL to a shared location.
- Build a real Anchor test suite using bankrun (current `tests/paymate-pool-v2.ts` is an empty stub).
- Create the fake-USDC SPL mint script + faucet endpoint with the 1M/call, 10M lifetime cap.
- Stand up the fee-payer relay scaffold: dedicated keypair, allowlist, rate limiter, balance monitor.
- Add `cancel_funding` instruction to the program.
- Decide on admin authority strategy: dev = single keypair, mainnet = Squads multisig.

---

## Phase 3 — Backend integration

- `server/services/solanaService.js` — analog of the deleted `contractService.js`. Wraps all program calls, PDA derivations (`pool`, `vault`, `lp_mint`, `drawdown`), and account fetches via `@coral-xyz/anchor`.
- New endpoints: `/auth/wallet/nonce`, `/auth/wallet/verify`, lender CRUD, build-tx endpoints for every PSP and admin instruction.
- Workers reshape:
  - `solanaIndexer` — new worker. Poll `getProgramAccounts`, mirror Pool / Drawdown PDAs into Mongo.
  - `disbursementAgent` — already transitions to `AwaitingDrawdown` (Phase 1). Phase 3 adds the build-tx endpoint the frontend hits.
  - `repaymentAgent` — receives indexer events, updates Mongo records.
  - `overdueWatcher` — pure notifier (Phase 1).
  - Drift reconciler that compares on-chain pool state vs Mongo and flags mismatches.
- Schema: add `LenderDeposit` / `LPHolding` models. Drop `interestDays` / EVM-era virtuals from `FinancingRequest`. Repurpose `assignedPoolAddress` (already done) to hold the Solana Pool PDA pubkey.

---

## Phase 4 — Frontend integration

- `client/`: install `@solana/wallet-adapter-react`, `@solana/wallet-adapter-wallets`, `@solana/wallet-adapter-react-ui`, `@coral-xyz/anchor`. Wrap app in `WalletProvider` (Phantom + Solflare + Backpack).
- New **Lender portal** as a top-level section: wallet-connect login, list funding pools, deposit / withdraw / redeem.
- Update PSP pages to require wallet connection on registration; surface "Sign Drawdown" / "Sign Repayment" / "Settle Commit Fee" actions.
- Update admin pages: "Initialize Pool" / "Execute Facility" / "Claim Fees" / "Declare Default" buttons.
- `external_psp/`: minimal — wallet connect on `LoanRequest.jsx`, sign drawdown tx returned by backend.

---

## Phase 5 — Tests / observability / docs

- E2E: lender deposits → admin executes → PSP draws → clock-advance → repay → settle → redeem → check pro-rata math.
- Devnet smoke-test script with 1–2 day tenors.
- Logging: tx signatures, on-chain account snapshots, mismatch alerts.

---

## Phase 6 — Mainnet readiness

- Independent audit of the Anchor program (focus areas: `remaining_accounts` overdue-check trick, LP redemption math under default, day-boundary edges).
- Squads multisig as program upgrade authority + pool admin.
- Mainnet USDC mint env flip; production-grade RPC (Helius / Triton / QuickNode) with rate limits sized for traffic.
- Runbooks: stuck txs, default declaration, fee claim, KYC gate decision.
