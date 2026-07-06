# PayMate — End-to-End User Flow

This document outlines the high-level flow of the platform from PSP onboarding through repayment, in the **Solana, lender-funded** model.

## 1. PSP Onboarding & Registration
**Goal:** New PSP registers, connects a Solana wallet, and submits compliance documents.

- **Account Creation:** PSP creates an account on the client portal. **Connecting a Solana wallet is required at registration** — the wallet pubkey is stored on the PSP profile and is what the eventual on-chain pool will be bound to.
- **Document Submission (KYB/KYC):** PSP uploads compliance documents, legal registration, and financial info.
- **API Keys:** PSP receives API keys to begin sandbox integration with the platform's backend.

## 2. Profile Approval Workflow
**Goal:** Multi-tier verification before a credit facility is opened on-chain.

- **KAM** — initial review, approve / reject / request more info.
- **CAD** — risk assessment and recommended limit.
- **CFO** — financial sign-off.
- **CRO** — final confirmation. CRO approval transitions the workflow to `AWAITING_POOL_INIT`.

## 3. Pool Initialization (admin signs)
**Goal:** Open the on-chain credit facility.

- Admin sees an "Initialize Pool" action in their dashboard for the approved PSP.
- Admin connects wallet and signs `initialize_pool`. This creates the Pool PDA, vault, and LP mint with the parameters CRO approved (soft cap, hard cap, max drawdown, tenor, util / commit / penalty bps).
- Pool enters **Funding** state.

## 4. Funding (lenders deposit)
**Goal:** Raise capital up to the soft cap so the facility can activate.

- Anyone with a Solana wallet can browse open pools in Funding state.
- Lender connects wallet, deposits USDC, receives LP tokens 1:1.
- Lender may exit during Funding via `withdraw_funding` (burn LP, reclaim USDC).
- Once `total_capital >= soft_cap`, admin sees "Execute Facility" action.

## 5. Facility Activation (admin signs)
**Goal:** Close deposits, unlock drawdowns.

- Admin signs `execute_facility`. State transitions to **Active**. Lender deposits and exits are no longer accepted.
- PSP can begin drawing.

## 6. Drawdowns (PSP signs)
**Goal:** PSP draws funds against the pool to facilitate operations.

- PSP signs `request_drawdown` with `(amount, tenor_days)`. Bounded by `max_drawdown_amount` and remaining capacity.
- Caller passes all currently-active `Drawdown` PDAs as remaining accounts so the program can verify none are past `tenor + grace + penalty` (overdue draws block new draws automatically).
- Vault transfers USDC to PSP wallet. Pool's `outstanding_principal` increases. Commitment fee is accrued lazily on every state transition.

## 7. Repayment (PSP signs)
**Goal:** Settle drawdowns to free up pool capacity and pay fees.

- PSP signs `repay(drawdown_id)`. Program computes:
  - Utilization fee: `principal × util_bps × days_active / 10_000` for normal days (up to `tenor + grace`).
  - Penalty fee: `principal × penalty_bps × penalty_days / 10_000` for any days beyond `tenor + grace`.
  - Plus all accrued commitment fee at this moment.
- USDC moves from PSP back to vault. Drawdown is marked repaid. Protocol fee share moves to `protocol_fees_owed`.

## 8. Close-Out
**Goal:** Wind down the facility after tenor expires.

1. PSP repays last drawdown.
2. **Wait one day**, then PSP signs `settle_commit_fee` to clear the final day's commitment accrual.
3. Lenders sign `redeem_lp` to receive pro-rata share of the vault.
4. Admin signs `claim_protocol_fees` whenever they want to collect protocol's share.

If the PSP doesn't settle, admin can `declare_default` 30 days past tenor. Lenders eat the resulting haircut on redemption.

## What changed from the EVM model

| Before (EVM) | Now (Solana) |
|---|---|
| Admin disburses on PSP's behalf via `drawdown` | PSP self-serves via `request_drawdown` (signs themselves) |
| Admin records fee repayment manually | Fees computed automatically inside `repay` |
| Admin pauses/unpauses pool when overdue | Program blocks new draws automatically when overdue past grace+penalty |
| Pool funded via admin transfer | Pool funded by open-market lender deposits → LP tokens |
| No lender role | Lender is a first-class actor with its own deposit / withdraw / redeem flow |
