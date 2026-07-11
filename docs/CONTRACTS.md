# Contracts — Quick Reference

*One-page reference for the `payfi_v1` contract set. Full source lives in `contracts/src/`. Test coverage in `contracts/test/`.*

## Deployed on Polygon Amoy (chain 80002)

| Contract | Address | Explorer |
|---|---|---|
| **PoolFactory** | `0xE02D8d3B14746E42c5D41a2CA805798D5A6E0F78` | [amoy.polygonscan.com](https://amoy.polygonscan.com/address/0xE02D8d3B14746E42c5D41a2CA805798D5A6E0F78) |
| **MockUSD** (6-decimal USDC surrogate) | `0x4e39880B43f9a83586a2aC75a01dff779Eb958c0` | [amoy.polygonscan.com](https://amoy.polygonscan.com/address/0x4e39880B43f9a83586a2aC75a01dff779Eb958c0) |
| **TreasuryReserve** | `0x03D21aFF05a94E2B87d1F55b2deE8F6f3fd9D9f8` | [amoy.polygonscan.com](https://amoy.polygonscan.com/address/0x03D21aFF05a94E2B87d1F55b2deE8F6f3fd9D9f8) |

## Contract set

### PoolFactory

The factory that mints per-facility `PoolContract` clones via EIP-1167.

Key external functions:

| Function | Caller | Effect |
|---|---|---|
| `approvePsp(address psp)` | `MULTISIG_ROLE` | Adds `psp` to the allowlist. Idempotent — safe to re-run. |
| `revokePsp(address psp)` | `MULTISIG_ROLE` | Removes `psp` from the allowlist. Does not cancel existing pools. |
| `createPool(PoolParams params)` | `MULTISIG_ROLE` | Deploys a new `PoolContract` clone, initializes it with `params`, and registers it in the factory's pool list. Returns the new pool address. Reverts if `params.psp` isn't approved. |
| `setEnvelope(EnvelopeBounds bounds)` | `MULTISIG_ROLE` | Updates the risk envelope caps (APR ceiling, tenor limit, utilisation cap, penalty rate). Doesn't affect already-created pools. |

State:

- `psps: mapping(address => bool)` — PSP allowlist
- `poolCount: uint256` — running count
- `poolImplementation: address` — EIP-1167 impl target

### PoolContract (one per facility)

Deployed as a minimal-proxy clone off `PoolFactory.poolImplementation`. Holds LP deposits, gates PSP drawdowns, executes repayment waterfalls.

Key external functions:

| Function | Caller | Effect |
|---|---|---|
| `initialize(InitParams params)` | Factory (once) | One-shot init. `_disableInitializers` guards direct calls to the impl. |
| `deposit(uint256 amount)` | Any address (LP) | Transfers `amount` USDC from LP → pool, credits `lpPositions[lp]`, mints pro-rata LP shares. |
| `withdraw(uint256 amount)` | LP | Only allowed before `finalizeFunding` is called. After that, use `claimYield` + `claimPrincipal`. |
| `finalizeFunding()` | AGENT1 or admin | Moves pool from `FUNDING` → `ACTIVE`. `softCap` must be met. |
| `executeDrawdown(bytes32 ref, address receiver, uint256 amount, uint16 days)` | AGENT2 | Transfers `amount` USDC → `receiver`. Records a `Drawdown` with `ref` as the external-order reference. `receiver` doesn't have to be the PSP. |
| `repay(bytes32 ref)` | PSP | Waterfall: principal → utilisation fee → penalty → protocol split → LP yield. Reverts if the drawdown ref doesn't exist or is already repaid. |
| `payAccruedIdleFees(uint256 amount)` | PSP | Pays down accrued idle (unutilised) commit fees. |
| `claimYield()` | LP | Transfers accrued yield share to LP. Callable any time after activation. |
| `claimPrincipal()` | LP | Transfers principal share back to LP. Callable after pool maturity. |
| `declareDefault()` | AGENT1 or admin | Freezes drawdowns, triggers `TreasuryReserve.drawReserve()` for the shortfall. |
| `sweepProtocolFees()` | Admin | Transfers accrued protocol fees to `TreasuryReserve`. |

State (per-drawdown records + LP positions):

- `status: enum` — `FUNDING`, `ACTIVE`, `MATURED`, `DEFAULTED`, `CLOSED`
- `drawDowns: mapping(bytes32 => Drawdown)` — keyed by external-order ref
- `lpPositions: mapping(address => LPPosition)` — principal + yield accounting

### TreasuryReserve

Protocol fee sink + insurance reserve.

| Function | Caller | Effect |
|---|---|---|
| `drawReserve(uint256 amount)` | Registered pool (via `Factory`) | Transfers `amount` USDC to caller. Called during `PoolContract.declareDefault`. |
| `topUp(uint256 amount)` | Any address | Adds USDC to the reserve. |
| `depositImFees(uint256 amount)` | Registered pool | Records protocol fees separately from the reserve principal. |
| `setFactory(address factory)` | Owner (deployment) | One-shot binding to the factory. |

## Security invariants tested

- **Solvency**: `pool.totalAssets >= sum(lpPositions.principal) + accrued yield`. Property fuzzed across 50k random state paths.
- **No LP dilution**: LP-share issuance = principal-in / current-share-price. Verified against a Rust reference impl (differential fuzzing).
- **AGENT2 separation**: `executeDrawdown` cannot mint, cannot touch protocol fees, cannot upgrade the impl.
- **Idempotent PSP allowlist**: `approvePsp` twice is a no-op, not a state corruption.
- **Reentrancy-safe repay**: `repay` is `nonReentrant` — every entry point that transfers USDC out is guarded.

## Access control

| Role | Wallet | What it can do |
|---|---|---|
| `DEPLOYER_ROLE` | Onchain admin | Deploy pools, approve PSPs, upgrade config |
| `AGENT1_ROLE` | Backend key | Pause pools, finalise funding, declare default |
| `AGENT2_ROLE` | Backend key | Execute drawdowns (server-signed after validation) |
| `MULTISIG_ROLE` | Multi-sig | Factory-level config: envelope bounds, treasury binding |
| `LP` | Any wallet | Deposit / claim yield / claim principal |
| `PSP` | Whitelisted wallet | Repay drawdowns, pay accrued idle fees |

## Gas ballpark (Polygon Amoy, 25 gwei)

| Op | Gas | ~POL |
|---|---|---|
| `approvePsp` | 55k | 0.0014 |
| `createPool` | 420k | 0.0105 |
| `deposit` | 95k | 0.0024 |
| `finalizeFunding` | 130k | 0.0033 |
| `executeDrawdown` | 170k | 0.0043 |
| `repay` | 210k | 0.0053 |
| `claimYield` | 90k | 0.0023 |
| `claimPrincipal` | 105k | 0.0026 |

Full facility cycle (create → deposit → finalise → drawdown → repay → claim): **~0.032 POL** (~$0.02 at current PoL price).

## Source layout

```
contracts/
├── src/
│   ├── PoolFactory.sol
│   ├── PoolContract.sol
│   ├── TreasuryReserve.sol
│   ├── MockStablecoin.sol
│   └── lib/
│       ├── MathLib.sol            # WAD fixed-point + waterfall math
│       └── AccessControl.sol      # OpenZeppelin re-exports
├── test/                          # 26 files, ~17K LOC
├── script/
│   └── Deploy.s.sol
└── foundry.toml
```
