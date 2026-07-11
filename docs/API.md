# API Reference

*One-page cheat sheet for the DeFa backend. Full source lives in `server/routes/`. Mounted at `/api/*` in the production deployment.*

## Authentication

Two JWT flavours, both bearer-token in `Authorization: Bearer <token>`:

| Flavour | Issued by | Used by |
|---|---|---|
| **Password** | `POST /auth/login` (JSON `{email, password}`) | PSP, KAM, CAD, CRO, CFO, LEGAL_ADMIN, VIEW_ONLY_ADMIN, SUPER_ADMIN |
| **SIWE (wallet)** | `POST /auth/wallet/login` + `POST /auth/wallet/onchain-admin/login` | Lender (LP), Onchain Admin |

SIWE flow: `POST /auth/wallet/nonce {wallet, purpose}` → sign returned `message` with the wallet → `POST /auth/wallet/{login,onchain-admin/login} {wallet, nonce, signature, message}` → JWT.

All authenticated endpoints run through `middleware/auth.js`. Role-gated routes use `authorizeRoles(...roles)`.

## Route index

Prefixes:
- `/auth/*` — password + SIWE auth
- `/users/*` — v2 lender legacy shim (issues `userId`-carrying JWTs for the v2 client)
- `/psp/*` — PSP-only (KYB, applications, order book)
- `/admin/*` — approvals + build-tx endpoints
- `/facility/*` — facility lifecycle + approvals
- `/access-code/*` — lender onboarding gate
- `/pool/*` — pool state reads + user-signed tx builders
- `/faucet/*` — testnet USDC minting
- `/marketPlaces/*` — v2 lender legacy shim over EVM `/pool` state

### Auth (`/auth`)

| Method | Path | Body | Auth | Returns |
|---|---|---|---|---|
| `POST` | `/auth/register` | `{email, password, role, name, companyName}` | none | `{token, user}` |
| `POST` | `/auth/login` | `{email, password}` | none | `{token, user}` |
| `GET` | `/auth/me` | — | Bearer | `{user}` |
| `POST` | `/auth/wallet/nonce` | `{wallet, purpose}` | none | `{wallet, nonce, expiresAt, message}` |
| `POST` | `/auth/wallet/login` | `{wallet, nonce, signature, message}` | none | `{token, lender}` |
| `POST` | `/auth/wallet/onchain-admin/login` | same | none, but wallet must be in `ONCHAIN_ADMIN_WALLETS` env | `{token, user}` |
| `POST` | `/auth/wallet/bind` | `{wallet, nonce, signature, message}` | Bearer | binds wallet to authed User |

### Access codes (`/access-code`)

| Method | Path | Body | Auth | Returns |
|---|---|---|---|---|
| `POST` | `/access-code/check` | `{code}` | none | `{valid: bool, reason?}` |
| `POST` | `/access-code/redeem` | `{code, name, email, wallet, nonce, signature, message}` | none | `{token, lender}` |
| `POST` | `/access-code/create` | `{count, label, expiresAt?}` | ONCHAIN_ADMIN | `{created: [...]}` |
| `GET` | `/access-code/list` | — (query: `status=all\|used\|unused`) | ONCHAIN_ADMIN | `{items}` |
| `DELETE` | `/access-code/:code` | — | ONCHAIN_ADMIN | `{ok}` |

### PSP (`/psp`)

| Method | Path | Body | Auth |
|---|---|---|---|
| `POST` | `/psp/apply-limit` | KYB fields (see `PSPProfile` schema) | PSP |
| `GET` | `/psp/profile` | — | PSP |
| `POST` | `/psp/request-financing` | `{amount, orderRef, tenorDays}` | PSP |
| `GET` | `/psp/active-financings` | — | PSP |
| `POST` | `/psp/exec/drawdown` | `{pool, ref, receiver, amount, days}` | PSP (server signs AGENT2) |
| `POST` | `/psp/build-tx/repay` | `{pool, ref}` | PSP (returns calldata for the PSP wallet to sign) |
| `POST` | `/psp/cl-negotiate` | `{action, type, details}` | PSP |
| `POST` | `/psp/cl-action` | `{action, type, additionalDetails}` | PSP |

### Facility (`/facility`)

| Method | Path | Body | Auth |
|---|---|---|---|
| `POST` | `/facility/request` | `{requestedTerms}` | PSP |
| `GET` | `/facility/my` | — | PSP |
| `GET` | `/facility/queue?status=<STATE>` | — | KAM/CAD/CRO/SUPER_ADMIN/ONCHAIN_ADMIN |
| `GET` | `/facility/:id` | — | any admin or the owning PSP |
| `POST` | `/facility/:id/approve` | `{note?, overrides?}` | KAM/CAD/CRO (state gates who) |
| `POST` | `/facility/:id/credit-memo` | multipart PDF | CRO/SUPER_ADMIN |
| `GET` | `/facility/by-pool/:poolPda/credit-memo` | — | any |

### Admin build-tx (`/admin/build-tx`)

Returns unsigned calldata `{to, data, value}` for the onchain admin wallet to sign + broadcast. Gate: `requireOnchainAdmin` (wallet in `ONCHAIN_ADMIN_WALLETS` env).

| Method | Path | Body | Effect |
|---|---|---|---|
| `POST` | `/admin/build-tx/approve-psp` | `{pspWallet}` | Factory `approvePsp` |
| `POST` | `/admin/build-tx/revoke-psp` | `{pspWallet}` | Factory `revokePsp` |
| `POST` | `/admin/build-tx/initialize-pool` | `{facilityId}` or raw params | Factory `createPool` |
| `POST` | `/admin/build-tx/execute-facility` | `{pool}` | Pool `finalizeFunding` |
| `POST` | `/admin/build-tx/cancel-funding` | `{pool}` | Pool cancel path |
| `POST` | `/admin/build-tx/claim-protocol-fees` | `{pool}` | Pool `sweepProtocolFees` |
| `POST` | `/admin/build-tx/declare-default` | `{pool}` | Pool `declareDefault` |
| `POST` | `/admin/build-tx/settle-default-principal` | `{pool}` | TreasuryReserve draw |
| `POST` | `/admin/build-tx/settle-default-yield` | `{pool}` | TreasuryReserve yield draw |
| `POST` | `/admin/exec/set-paused` | `{pool, paused}` | Server signs AGENT1 |
| `POST` | `/admin/exec/set-sc-overdue` | `{pool, overdue}` | Server signs AGENT1 |

### Pool state (`/pool`)

Read-only + user-signed build-tx paths.

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/pools` | none | All pools with real onchain state + display-name overrides |
| `GET` | `/pool/:pool/state` | none | Single-pool state read |
| `GET` | `/pool/:pool/drawdowns` | none | Drawdown records for this pool |
| `GET` | `/pool/:pool/drawdown/:drawdownId/pipeline` | none | Synthetic validation-pipeline stepper (5/5 for demo) |
| `POST` | `/pool/lender/build-tx/deposit` | Lender | Returns `[approve, deposit]` step tuples |
| `POST` | `/pool/lender/build-tx/redeem` | Lender | Returns `[claimYield, claimPrincipal]` step tuples |

### Faucet (`/faucet`)

| Method | Path | Body | Notes |
|---|---|---|---|
| `POST` | `/faucet/usdc-df` | `{wallet}` | Mints 1M MockUSD to `wallet`. Rate-limited per IP. Backed by the `FAUCET_AUTHORITY_PRIVATE_KEY` env var. |

### v2 lender shim (`/users`, `/marketPlaces`)

Legacy URL contract the standalone `client/` v2 lender expects. Zero direct client changes needed to serve the EVM backend.

| Method | Path | Body | Purpose |
|---|---|---|---|
| `POST` | `/users/login-user` | `{email, password}` | v2 lender email login. Returns `{token, data: lender}`. |
| `POST` | `/users/apply-referral` | `{refercode}` | Access-code precheck for the GrantAccessPage. |
| `POST` | `/users/create-user` | `{userName, email, password, refercode}` | Atomic signup + code consumption. |
| `GET` | `/users/get-user/:id` | — | Lender hydration for AuthProtection. |
| `POST` | `/marketPlaces/getAlldealsnew` | body ignored, query used | Paginated pool list in v2 deal shape. |
| `GET` | `/marketPlaces/getDealsById/:pool` | — | Single pool detail in v2 deal shape. |

## Rate limits

- `/auth/*`, `/faucet/*` — 30 req/min per IP (`sensitiveLimiter` middleware)
- `/access-code/check`, `/access-code/redeem` — same
- All other endpoints — unlimited (behind Cloudflare / GCP LB in prod)

## Standard error responses

- **`400 Bad Request`** — validation failure, missing required field. Body: `{message}` or `{errors: [{path, msg}]}`
- **`401 Unauthorized`** — missing / invalid JWT
- **`403 Forbidden`** — JWT valid but wrong role or wallet not on allowlist
- **`404 Not Found`** — resource doesn't exist
- **`409 Conflict`** — state precondition failed (e.g. code already redeemed, facility already approved at this stage)
- **`500 Server Error`** — unhandled. Body includes `{message: <error.message>}`.
