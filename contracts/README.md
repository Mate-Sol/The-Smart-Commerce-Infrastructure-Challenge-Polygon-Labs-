# Contracts — payfi_v1 baseline

Solidity + Foundry credit pool contracts, ported verbatim from
[Mate-Sol/payfi_v1](https://github.com/Mate-Sol/payfi_v1). Same source, same
tests, same OZ + forge-std dependencies. See `../README.md` for hackathon
context.

## Layout

```
src/
  PoolFactory.sol       PSP registry + envelope + createPool (EIP-1167 clones)
  PoolContract.sol      per-facility credit pool (~1420 LOC)
  TreasuryReserve.sol   protocol-fee / insurance reserve
  MathLib.sol           WAD math helpers
  IPoolFactory.sol      minimal interface used by PoolContract
  ITreasuryReserve.sol  minimal interface used by PoolContract
  MockStablecoin.sol    USDC stand-in for local + testnet runs

test/                   26 Foundry test files: invariant / adversarial /
                        differential / fuzz / gas-profile / view-mutation
                        consistency / security. ~17K LOC of coverage.

lib/
  forge-std             Foundry std library
  openzeppelin-contracts  OZ v5.x — AccessControl, ReentrancyGuard, Clones, SafeERC20
```

## Local run

```bash
cd contracts
forge build
forge test
```

## Deploy scripts

Chain-specific deploy scripts (Polygon Amoy / Arc testnet) land in a later
batch under `script/`.
