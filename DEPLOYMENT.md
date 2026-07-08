# Deploy — Ignyte Smart Commerce Infrastructure Challenge (Polygon Labs)

Two-service deploy: **Vercel for both clients + Railway for server (with Mongo add-on)**. Total time: ~30 min for a fresh setup, mostly form-clicking. This is the same shape Colosseum used.

Three deployables per repo:
- `client/` — v2 lender UI → Vercel
- `client-legacy/` — PSP + admin portals → Vercel
- `server/` — Node API → Railway (+ Railway Mongo)

## Public URLs (once deployed)

- **Lender UI**: https://defa-polygon.vercel.app (or custom domain defa-polygon.invoicemate.net)
- **Admin/PSP UI**: https://defa-polygon-admin.vercel.app
- **API**: https://defa-polygon-api.up.railway.app

## Step 1 — Backend (Railway)

1. Sign in to https://railway.app with GitHub.
2. **New Project → Deploy from GitHub repo** → pick this repo.
3. After the project scaffolds:
   - **Settings → Root Directory**: `server`
   - **Settings → Start Command**: (blank — nixpacks.toml handles it)
4. **Variables** — copy from `server/.env.production.example`. Fill in:

```
PORT                          5050
JWT_SECRET                    <generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))">
FRONTEND_URL                  https://defa-polygon.vercel.app
EXTRA_CORS_ORIGINS            https://defa-polygon.vercel.app,https://defa-polygon-admin.vercel.app

EVM_CHAIN_ID                  80002
EVM_RPC_URL                   https://rpc-amoy.polygon.technology
PAYFI_FACTORY_ADDRESS         0xE02D8d3B14746E42c5D41a2CA805798D5A6E0F78
PAYFI_STABLECOIN_ADDRESS      0x4e39880B43f9a83586a2aC75a01dff779Eb958c0
PAYFI_TREASURY_ADDRESS        0x03D21aFF05a94E2B87d1F55b2deE8F6f3fd9D9f8

AGENT_PRIVATE_KEY             0x692fb6f9b2c22e3d2ad4e0434f22f41617fb65ce1ac89146da2ae21b58443ce9
FAUCET_AUTHORITY_PRIVATE_KEY  0x692fb6f9b2c22e3d2ad4e0434f22f41617fb65ce1ac89146da2ae21b58443ce9
ONCHAIN_ADMIN_WALLETS         0x0b9dDfcdB31aEf5Cde26d0E6DbAc6917B6849f05

SIWE_DOMAIN                   defa-polygon.vercel.app
SIWE_ORIGIN                   https://defa-polygon.vercel.app

EVM_INDEXER_WINDOW_BLOCKS     100
EVM_INDEXER_INTERVAL_MS       90000
```

5. **Add MongoDB plugin**: Project → New Service → Database → MongoDB. Railway wires it into your service — set `MONGODB_URI` to the auto-injected connection string (`${{Mongo.MONGODB_URI}}`).
6. Click **Deploy**. First build ~3 min. Check logs — should end with:
   `[evmIndexer] starting; interval=90000ms window=100 blocks`
   `MongoDB Connected`
7. **Settings → Networking → Generate Domain**. Note the resulting `defa-polygon-api.up.railway.app` URL.

## Step 2 — Frontend (Vercel × 2)

### 2a. v2 lender client

1. https://vercel.com/new → import same GitHub repo.
2. **Configure project**:
   - **Root Directory**: `client`
   - Framework preset: **Vite** (should auto-detect via `client/vercel.json`)
   - Build command / output: leave defaults
3. **Environment Variables** — from `.env.production.example`. Fill:

```
VITE_API_URL                          https://defa-polygon-api.up.railway.app
VITE_CHAIN_ID                         80002
VITE_CHAIN_NAME                       Polygon Amoy
VITE_CHAIN_NATIVE_SYMBOL              POL
VITE_CHAIN_NATIVE_DECIMALS            18
VITE_RPC_URL                          https://rpc-amoy.polygon.technology
VITE_CHAIN_EXPLORER_URL               https://amoy.polygonscan.com
VITE_STABLECOIN_ADDRESS               0x4e39880B43f9a83586a2aC75a01dff779Eb958c0
VITE_TREASURY_ADDRESS                 0x03D21aFF05a94E2B87d1F55b2deE8F6f3fd9D9f8
VITE_FACTORY_ADDRESS                  0xE02D8d3B14746E42c5D41a2CA805798D5A6E0F78
VITE_WALLETCONNECT_PROJECT_ID         defa-demo
```

4. Click **Deploy**. Auto-assigns `defa-polygon.vercel.app` (or an ID; you can rename in Settings → Domains).

### 2b. PSP + admin (legacy) client

1. https://vercel.com/new → import same GitHub repo (yes, again — Vercel supports multiple projects per repo).
2. **Configure project**:
   - **Root Directory**: `client-legacy`
   - Framework preset: Vite
3. **Environment Variables** — same list as 2a, plus:

```
VITE_API_URL                          https://defa-polygon-api.up.railway.app
```

4. Deploy. Rename domain to `defa-polygon-admin.vercel.app`.

## Step 3 — CORS

Go back to Railway. Update the server's env:

```
EXTRA_CORS_ORIGINS   https://defa-polygon.vercel.app,https://defa-polygon-admin.vercel.app
```

Railway auto-redeploys on env change.

## Step 4 — Seed access code (one time)

Get a Railway Mongo shell (Railway Settings → Data → Query):

```javascript
db.accesscodes.insertOne({
  code: "123456",
  label: "public-demo",
  usedAt: null,
  expiresAt: new Date(Date.now() + 30*24*3600*1000),
  createdBy: "seed"
})
```

## Step 5 — Verify

- `curl https://defa-polygon-api.up.railway.app/pools` → 3 pools
- Open `https://defa-polygon.vercel.app/enter-access-code` → paste `123456`
- Full lender loop should work on real Polygon Amoy.

## Custom domain (optional)

Vercel + Railway both support custom domains via CNAME. Point:
- `defa-polygon.invoicemate.net` CNAME → Vercel project 1
- `defa-polygon-admin.invoicemate.net` CNAME → Vercel project 2
- `defa-polygon-api.invoicemate.net` CNAME → Railway domain

Update the server envs `FRONTEND_URL`, `SIWE_DOMAIN`, `SIWE_ORIGIN`, and Vercel client's `VITE_API_URL` accordingly.

## Redeploy on code change

Vercel + Railway both auto-deploy on `git push`. No manual action required.
