# Local end-to-end smoke test

Four terminals, ~10 minutes end-to-end. Verifies the full lender loop
(deploy → connect wallet → redeem access code → deposit → dashboard)
before deploying to Polygon Amoy / Arc testnet.

## 0. Prereqs

- Node 20+
- Foundry (`curl -L https://foundry.paradigm.xyz | bash && foundryup`)
- MongoDB running locally, OR a MongoDB Atlas URI

## 1. Terminal A — Anvil (local chain)

```bash
anvil --chain-id 31337
```

Prints the 10 default funded wallets. Keep this open — the addresses
below refer to Anvil's default keys.

## 2. Terminal B — Deploy contracts

```bash
cd contracts

# DEMO_PSP is one of anvil's default addresses so we don't have to
# multisig-approve it in a separate step.
DEMO_PSP=0x70997970C51812dc3A010C7d01b50e0d17dc79C8 \
forge script script/Deploy.s.sol:DeployScript \
  --rpc-url http://localhost:8545 \
  --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

Note the three addresses printed at the end — you need them in the next
step.

Optionally seed a demo pool so the UI has something to render immediately:

```bash
export PAYFI_FACTORY_ADDRESS=<from-above>
export PAYFI_STABLECOIN_ADDRESS=<from-above>
export PSP_WALLET=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
export AGENT1_ADDRESS=$PSP_WALLET
export AGENT2_ADDRESS=$PSP_WALLET
export MULTISIG_ADDRESS=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

forge script script/CreateDemoPool.s.sol:CreateDemoPoolScript \
  --rpc-url http://localhost:8545 \
  --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

## 3. Terminal C — Server

```bash
cd server
cp .env.example .env

# Fill .env with (minimum required):
cat <<EOF > .env
MONGODB_URI=mongodb://localhost:27017/defa-local
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")
PORT=5050
FRONTEND_URL=http://localhost:5173

# EVM
EVM_CHAIN_ID=31337
EVM_RPC_URL=http://localhost:8545

# Paste from Terminal B output
PAYFI_STABLECOIN_ADDRESS=0x...
PAYFI_TREASURY_ADDRESS=0x...
PAYFI_FACTORY_ADDRESS=0x...

# Anvil's second key — server holds AGENT roles
AGENT_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d

# Anvil's first address — the deployer is on the on-chain admin allowlist
ONCHAIN_ADMIN_WALLETS=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

# SIWE
SIWE_DOMAIN=localhost:5173
SIWE_ORIGIN=http://localhost:5173
EOF

npm install
npm run dev    # http://localhost:5050
```

Boot log should show `[evmIndexer] starting; interval=30000ms`. If it
says `not starting: PAYFI_FACTORY_ADDRESS not set`, check your .env.

## 4. Terminal D — Client

```bash
cd client
cp .env.example .env

cat <<EOF > .env
VITE_API_URL=http://localhost:5050
VITE_CHAIN_ID=31337
VITE_CHAIN_NAME=Anvil
VITE_CHAIN_NATIVE_SYMBOL=ETH
VITE_RPC_URL=http://localhost:8545

# Paste from Terminal B output
VITE_STABLECOIN_ADDRESS=0x...
VITE_TREASURY_ADDRESS=0x...
VITE_FACTORY_ADDRESS=0x...
EOF

npm install
npm run dev    # http://localhost:5173
```

## 5. Manual smoke test — lender loop

Import Anvil's third key into MetaMask (or any wallet RainbowKit shows):

```
Address:      0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
Private key:  0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
```

Add Anvil as a custom network in MetaMask:
- Network name: Anvil
- RPC URL: http://localhost:8545
- Chain ID: 31337
- Currency symbol: ETH

Then:

1. **Mint yourself USDC.** On terminal D, hit the faucet:
   ```
   curl -X POST http://localhost:5050/faucet/usdc-df \
     -H 'Content-Type: application/json' \
     -d '{"wallet":"0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"}'
   ```
   Wallet gets 1M USDC.

2. **Mint an access code** (server-side, since we didn't wire an admin
   UI in the demo path — hit Mongo directly or add an in-code shortcut).
   For a quick path, create one manually:
   ```
   # From the mongo shell / Compass:
   use defa-local
   db.accesscodes.insertOne({
     code: '123456',
     label: 'smoke test',
     usedAt: null,
     expiresAt: new Date(Date.now() + 3600_000),
     createdBy: 'seed'
   })
   ```

3. **Redeem the code.** Open http://localhost:5173/lender-v2/enter-access-code
   - Enter code `123456`, name `Test Lender`, email `test@local`
   - Click Connect (RainbowKit) → pick MetaMask → select Anvil-key-3
   - Sign the SIWE message
   - Click Redeem & Continue → should land on `/lender-v2/wellcome`

4. **Browse pools.** Navigate to `/lender-v2/pools` — see the demo pool
   from step 2 above rendering.

5. **Deposit.** Click the pool → PoolDetails → enter 1000 in the deposit
   form → click Deposit. Wallet prompts twice (approve + deposit) →
   both sign → tx confirms → toast appears.

6. **Dashboard.** Navigate to `/lender-v2/dashboard` — Wallet Balance
   dropped by 1000, Total Deposited shows 1000.

Pass = the loop above completes without errors. Any failures point at
specific chunks: SIWE errors → walletAuthEvm; tx build failures → poolTx
route; wallet-connect errors → EvmWalletProvider.

## Known issues on this smoke test

- **Analytics endpoints stubbed 501** — `/pool/:pool/activity`,
  `/daily-activity`, `/fee-aggregates` return 501. Any lender-v2 tab
  that hits these renders empty. Belongs to a later polish batch.
- **PSP + admin portals still on Solana wallet-adapter** — visiting
  `/psp/*` or `/admin/*` may throw if you don't have Phantom installed.
  Ignore for now; `/lender-v2/*` is the demo path.
- **No poolAggregates indexer on EVM** — realized-yield across old
  positions in `/lender/portfolio` shows 0. Wired to the on-chain
  claimed* getters; real cumulative math needs event replay.

## Deleting local state

```bash
# Kill anvil, then:
rm -rf broadcast/ cache/ out/
mongo defa-local --eval 'db.dropDatabase()'
```
