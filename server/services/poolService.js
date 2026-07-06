/**
 * Anchor client wrapper for paymate-pool-v2.
 *
 * This is the off-chain analog of the on-chain program — it's how the
 * Express server talks to it. Two responsibilities:
 *
 *  1. **Read on-chain state** via `program.account.<X>.fetch(pda)`.
 *     Used by the indexer worker and by API endpoints that surface
 *     pool/drawdown state to the frontend.
 *
 *  2. **Build unsigned transactions** for every instruction. The frontend
 *     receives a base64 tx, the user signs in their wallet adapter, and
 *     submits to /relay/submit which adds the fee-payer signature.
 *
 * Crucially this module never **signs** anything — admin signing is
 * non-custodial, and PSP/lender signing happens in the browser. The only
 * server-held keys (faucet authority, fee payer) are managed elsewhere.
 *
 * IDL: copied to `server/idl/paymate_pool_v2.json` from
 * `solana/code/paymate-pool-v2/target/idl/`. **Re-copy after every program
 * upgrade** — deserialization will silently produce wrong data if the IDL
 * is stale relative to the deployed program.
 */

const anchor = require('@coral-xyz/anchor');
const { Program, BN } = anchor;
const {
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Keypair,
} = require('@solana/web3.js');

// SPL Memo program v2 — prepended to every build-tx so the wallet popup
// shows a human-readable line about what the user is signing (Phantom and
// every other major wallet renders the memo prominently). 0-cost on chain.
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
function memoIx(text) {
  return new TransactionInstruction({
    keys: [],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(String(text || '').slice(0, 256), 'utf8'),
  });
}
// Format USDC base units → "$1,234.56" for human-readable memos.
function memoUsd(base) {
  if (base === undefined || base === null) return '$0';
  const usd = Number(BigInt(base.toString())) / 1_000_000;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(usd);
}
const {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} = require('@solana/spl-token');

const { getConnection, PROGRAM_ID, getFeePayer, getUsdcDfMint } = require('./solanaService');
const idl = require('../idl/paymate_pool_v2.json');

// ─── Seeds (must match the Rust program's `*_SEED` constants) ──────────────
const POOL_SEED = Buffer.from('pool');
const VAULT_SEED = Buffer.from('vault');
const LP_MINT_SEED = Buffer.from('lp_mint');
const DRAWDOWN_SEED = Buffer.from('drawdown');

// ─── PDA derivations ────────────────────────────────────────────────────────
function derivePool(pspWallet, facilityId) {
  const facilityIdBuf = Buffer.alloc(8);
  facilityIdBuf.writeBigUInt64LE(BigInt(facilityId));
  return PublicKey.findProgramAddressSync(
    [POOL_SEED, new PublicKey(pspWallet).toBuffer(), facilityIdBuf],
    PROGRAM_ID
  );
}

function deriveVault(pool) {
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, new PublicKey(pool).toBuffer()],
    PROGRAM_ID
  );
}

function deriveLpMint(pool) {
  return PublicKey.findProgramAddressSync(
    [LP_MINT_SEED, new PublicKey(pool).toBuffer()],
    PROGRAM_ID
  );
}

function deriveDrawdown(pool, drawdownId) {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(BigInt(drawdownId));
  return PublicKey.findProgramAddressSync(
    [DRAWDOWN_SEED, new PublicKey(pool).toBuffer(), idBuf],
    PROGRAM_ID
  );
}

// ─── Read-only Program instance ─────────────────────────────────────────────
//
// Anchor's Program needs a Provider. For read + tx-building (no signing) we
// use an AnchorProvider with an ephemeral throwaway keypair as the wallet.
// Calls that try to .rpc() will fail (no SOL on the dummy wallet), which is
// the desired behavior — all signing happens in the browser, not here.
let cachedProgram = null;
function getProgram() {
  if (cachedProgram) return cachedProgram;
  const connection = getConnection();
  const dummyWallet = {
    publicKey: Keypair.generate().publicKey,
    signTransaction: async () => {
      throw new Error('poolService is read-only; sign client-side then submit via /relay');
    },
    signAllTransactions: async () => {
      throw new Error('poolService is read-only; sign client-side then submit via /relay');
    },
  };
  const provider = new anchor.AnchorProvider(connection, dummyWallet, {
    commitment: 'confirmed',
  });
  cachedProgram = new Program(idl, provider);
  return cachedProgram;
}

// ─── Account fetchers ───────────────────────────────────────────────────────
async function fetchPool(poolPubkey) {
  const program = getProgram();
  return program.account.pool.fetch(new PublicKey(poolPubkey));
}

async function fetchPoolMaybe(poolPubkey) {
  try {
    return await fetchPool(poolPubkey);
  } catch (e) {
    if (String(e).includes('Account does not exist')) return null;
    throw e;
  }
}

// Raw "is there ANY data at this address" check — bypasses Anchor's typed
// decode so we also catch zombie/stale-layout accounts that fetchPoolMaybe
// would error on. Used by the initialize-pool pre-flight to avoid blowing
// up at SystemProgram.allocate("already in use").
async function accountExists(pubkey) {
  const program = getProgram();
  const conn = program.provider.connection;
  const info = await conn.getAccountInfo(new PublicKey(pubkey), 'confirmed');
  return info !== null;
}

async function fetchDrawdown(drawdownPubkey) {
  const program = getProgram();
  return program.account.drawdown.fetch(new PublicKey(drawdownPubkey));
}

// Tolerant version of `program.account.pool.all()`. We hit
// `getProgramAccounts` directly and decode each one inside a try/catch so
// a single stale-layout account (e.g. a Pool initialized before the
// `seconds_per_day` field was added) doesn't blow up the whole call.
async function fetchAllPools() {
  const program = getProgram();
  const conn = program.provider.connection;
  // 8-byte anchor discriminator for the Pool account.
  const disc = require('crypto')
    .createHash('sha256')
    .update('account:Pool')
    .digest()
    .slice(0, 8);
  const raws = await conn.getProgramAccounts(program.programId, {
    filters: [{ memcmp: { offset: 0, bytes: bs58Encode(disc) } }],
  });
  const decoded = [];
  let skipped = 0;
  for (const r of raws) {
    try {
      const account = program.coder.accounts.decode('pool', r.account.data);
      decoded.push({ publicKey: r.pubkey, account });
    } catch {
      skipped += 1;
    }
  }
  if (skipped > 0) {
    console.warn(`[fetchAllPools] skipped ${skipped} undecodable pool account(s) (likely stale layout from a prior program version)`);
  }
  return decoded;
}

async function fetchActiveDrawdownsForPool(poolPubkey) {
  const program = getProgram();
  const conn = program.provider.connection;
  const pool = new PublicKey(poolPubkey);
  const disc = require('crypto')
    .createHash('sha256')
    .update('account:Drawdown')
    .digest()
    .slice(0, 8);
  // Pool field is the first field in Drawdown (32 bytes after the 8-byte
  // anchor discriminator). Filter on it server-side via memcmp.
  const raws = await conn.getProgramAccounts(program.programId, {
    filters: [
      { memcmp: { offset: 0, bytes: bs58Encode(disc) } },
      { memcmp: { offset: 8, bytes: pool.toBase58() } },
    ],
  });
  const decoded = [];
  for (const r of raws) {
    try {
      const account = program.coder.accounts.decode('drawdown', r.account.data);
      if (!account.repaid) decoded.push({ publicKey: r.pubkey, account });
    } catch { /* skip stale-layout */ }
  }
  return decoded;
}

// Tolerant fetch of every Drawdown PDA in the program — used by the
// indexer. Same skip-on-decode-failure pattern as `fetchAllPools`.
async function fetchAllDrawdowns() {
  const program = getProgram();
  const conn = program.provider.connection;
  const disc = require('crypto')
    .createHash('sha256')
    .update('account:Drawdown')
    .digest()
    .slice(0, 8);
  const raws = await conn.getProgramAccounts(program.programId, {
    filters: [{ memcmp: { offset: 0, bytes: bs58Encode(disc) } }],
  });
  const decoded = [];
  let skipped = 0;
  for (const r of raws) {
    try {
      const account = program.coder.accounts.decode('drawdown', r.account.data);
      decoded.push({ publicKey: r.pubkey, account });
    } catch { skipped += 1; }
  }
  if (skipped > 0) {
    console.warn(`[fetchAllDrawdowns] skipped ${skipped} undecodable drawdown account(s) (likely stale layout)`);
  }
  return decoded;
}

// bs58 v6 ESM/CJS interop: depending on how it's required, the exported
// shape is either { encode } or { default: { encode } }. Handle both.
function bs58Encode(buf) {
  // eslint-disable-next-line global-require
  const bs58 = require('bs58');
  const enc = bs58.encode || (bs58.default && bs58.default.encode);
  return enc(buf);
}

// ─── Tx-building helpers ────────────────────────────────────────────────────
//
// Pattern: each builder returns `{ tx, accounts }`. The tx has:
//   - feePayer = relay pubkey (so /relay/submit can pay gas)
//   - recentBlockhash fresh
//   - the user as a (currently unsigned) signer
//
// The frontend serializes, signs in-wallet, base64-encodes, POSTs to
// /relay/submit. The relay validates the instruction allowlist, adds its
// own signature, and submits.
//
// `accounts` is returned for diagnostic / logging purposes.

async function _wrap(ixOrIxs, opts = {}) {
  const connection = getConnection();
  const feePayer = getFeePayer();
  if (!feePayer) {
    throw new Error('FEE_PAYER_PRIVATE_KEY not configured; cannot build tx');
  }
  const ixs = Array.isArray(ixOrIxs) ? ixOrIxs : [ixOrIxs];
  const tx = new Transaction();
  // Prepend a Memo IX with a human-readable description so the wallet
  // popup tells the user exactly what they're signing + the cost involved.
  if (opts.memo) tx.add(memoIx(opts.memo));
  for (const ix of ixs) tx.add(ix);
  tx.feePayer = feePayer.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
  return { tx, txBase64: tx.serialize({ requireAllSignatures: false }).toString('base64') };
}

async function buildInitializePoolTx(args) {
  // args: { admin, pspWallet, pspName, facilityId, softCap, hardCap,
  //         maxDrawdownAmount, facilityTenorDays, utilizationRateBps,
  //         commitmentRateBps, penaltyRateBps, graceDays, penaltyDays,
  //         protocolFeeShareBps, secondsPerDay?, usdcMint? }
  // secondsPerDay defaults to 86_400 (real day). For warp-time test pools
  // pass a smaller value (60..=86_400). Contract enforces the same range.
  const program = getProgram();
  const usdcMint = args.usdcMint ? new PublicKey(args.usdcMint) : getUsdcDfMint();
  if (!usdcMint) throw new Error('USDC mint not configured');

  const pspWallet = new PublicKey(args.pspWallet);
  const [pool] = derivePool(pspWallet, args.facilityId);
  const [vault] = deriveVault(pool);
  const [lpMint] = deriveLpMint(pool);

  const ix = await program.methods
    .initializePool({
      pspWallet,
      pspName: args.pspName,
      facilityId: new BN(args.facilityId.toString()),
      softCap: new BN(args.softCap.toString()),
      hardCap: new BN(args.hardCap.toString()),
      maxDrawdownAmount: new BN(args.maxDrawdownAmount.toString()),
      facilityTenorDays: args.facilityTenorDays,
      utilizationRateBps: args.utilizationRateBps,
      commitmentRateBps: args.commitmentRateBps,
      penaltyRateBps: args.penaltyRateBps,
      graceDays: args.graceDays,
      penaltyDays: args.penaltyDays,
      protocolFeeShareBps: args.protocolFeeShareBps,
      secondsPerDay: args.secondsPerDay ?? 86_400,
    })
    .accounts({
      pool,
      vault,
      lpMint,
      usdcMint,
      admin: new PublicKey(args.admin),
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction();

  const out = await _wrap(ix, {
    memo: `DeFa: Initialize pool — ${args.pspName || 'PSP'} facility #${args.facilityId} (${args.facilityTenorDays}d tenor, util ${args.utilizationRateBps}bps)`,
  });
  return { ...out, accounts: { pool: pool.toBase58(), vault: vault.toBase58(), lpMint: lpMint.toBase58() } };
}

async function buildDepositTx({ pool, lender, amount, usdcMint }) {
  const program = getProgram();
  const feePayer = getFeePayer();
  const poolPk = new PublicKey(pool);
  const lenderPk = new PublicKey(lender);
  const mint = usdcMint ? new PublicKey(usdcMint) : getUsdcDfMint();
  const [vault] = deriveVault(poolPk);
  const [lpMint] = deriveLpMint(poolPk);
  const lenderUsdc = getAssociatedTokenAddressSync(mint, lenderPk);
  const lenderLp = getAssociatedTokenAddressSync(lpMint, lenderPk);

  // Pre-create the lender's LP ATA with the relay as payer. The deposit
  // ix has `init_if_needed payer = lender`, but lenders in the
  // non-custodial-with-fee-payer-relay model don't hold SOL — so we create
  // the ATA via a separate idempotent IX paid by the relay. By the time
  // the program-side init_if_needed runs, the account exists and it's a
  // no-op.
  const ataIx = createAssociatedTokenAccountIdempotentInstruction(
    feePayer.publicKey, // payer
    lenderLp,
    lenderPk,
    lpMint
  );

  const depositIx = await program.methods
    .deposit(new BN(amount.toString()))
    .accounts({
      pool: poolPk,
      vault,
      lpMint,
      lenderUsdc,
      lenderLp,
      lender: lenderPk,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  return _wrap([ataIx, depositIx], {
    memo: `DeFa: Deposit ${memoUsd(amount)} USDC into facility — mints LP tokens 1:1`,
  });
}

async function buildWithdrawFundingTx({ pool, lender, amount, usdcMint }) {
  const program = getProgram();
  const poolPk = new PublicKey(pool);
  const lenderPk = new PublicKey(lender);
  const mint = usdcMint ? new PublicKey(usdcMint) : getUsdcDfMint();
  const [vault] = deriveVault(poolPk);
  const [lpMint] = deriveLpMint(poolPk);
  const lenderUsdc = getAssociatedTokenAddressSync(mint, lenderPk);
  const lenderLp = getAssociatedTokenAddressSync(lpMint, lenderPk);

  const ix = await program.methods
    .withdrawFunding(new BN(amount.toString()))
    .accounts({
      pool: poolPk,
      vault,
      lpMint,
      lenderUsdc,
      lenderLp,
      lender: lenderPk,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

  return _wrap(ix, {
    memo: `DeFa: Withdraw ${memoUsd(amount)} USDC from funding — burns equivalent LP`,
  });
}

async function buildExecuteFacilityTx({ pool, admin }) {
  const program = getProgram();
  const ix = await program.methods
    .executeFacility()
    .accounts({ pool: new PublicKey(pool), admin: new PublicKey(admin) })
    .instruction();
  return _wrap(ix, {
    memo: 'DeFa: Execute facility (admin) — Funding → Active, lender deposits locked, PSP can drawdown',
  });
}

async function buildCancelFundingTx({ pool, admin }) {
  const program = getProgram();
  const ix = await program.methods
    .cancelFunding()
    .accounts({ pool: new PublicKey(pool), admin: new PublicKey(admin) })
    .instruction();
  return _wrap(ix, {
    memo: 'DeFa: Cancel funding (admin) — lenders can withdraw deposits',
  });
}

async function buildRequestDrawdownTx({ pool, psp, drawdownId, amount, tenorDays, usdcMint }) {
  const program = getProgram();
  const feePayer = getFeePayer();
  const poolPk = new PublicKey(pool);
  const pspPk = new PublicKey(psp);
  const mint = usdcMint ? new PublicKey(usdcMint) : getUsdcDfMint();
  const [vault] = deriveVault(poolPk);
  const [drawdown] = deriveDrawdown(poolPk, drawdownId);
  const pspUsdc = getAssociatedTokenAddressSync(mint, pspPk);

  // Pre-create the PSP's USDC-DF ATA. The program transfers vault → psp_usdc
  // and expects the ATA to already exist. First-time borrowers (who've
  // never received USDC-DF) won't have one yet, so the program would
  // bail with `AccountNotInitialized`. Idempotent IX paid by the relay
  // means existing ATAs are a no-op.
  const ataIx = createAssociatedTokenAccountIdempotentInstruction(
    feePayer.publicKey, // payer
    pspUsdc,
    pspPk,
    mint
  );

  // The on-chain program requires ALL currently-active drawdowns be passed
  // as `remaining_accounts` so it can verify none are overdue past
  // tenor+grace+penalty. Fetch them from chain.
  const active = await fetchActiveDrawdownsForPool(poolPk);
  const remainingAccounts = active.map((d) => ({
    pubkey: d.publicKey,
    isWritable: false,
    isSigner: false,
  }));

  const ix = await program.methods
    .requestDrawdown(new BN(drawdownId.toString()), new BN(amount.toString()), tenorDays)
    .accounts({
      pool: poolPk,
      drawdown,
      vault,
      pspUsdc,
      psp: pspPk,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(remainingAccounts)
    .instruction();

  return {
    ...(await _wrap([ataIx, ix], {
      memo: `DeFa: Drawdown #${drawdownId} — borrow ${memoUsd(amount)} USDC for ${tenorDays}d tenor`,
    })),
    accounts: { drawdown: drawdown.toBase58() },
  };
}

async function buildRepayTx({ pool, psp, drawdownId, usdcMint }) {
  const program = getProgram();
  const feePayer = getFeePayer();
  const poolPk = new PublicKey(pool);
  const pspPk = new PublicKey(psp);
  const mint = usdcMint ? new PublicKey(usdcMint) : getUsdcDfMint();
  const [vault] = deriveVault(poolPk);
  const [drawdown] = deriveDrawdown(poolPk, drawdownId);
  const pspUsdc = getAssociatedTokenAddressSync(mint, pspPk);

  // Defensive: ensure psp_usdc ATA exists. In normal flow it does (the
  // drawdown that created this loan would've created the ATA), but if
  // anyone closed it manually we'd fail with AccountNotInitialized.
  const ataIx = createAssociatedTokenAccountIdempotentInstruction(
    feePayer.publicKey, pspUsdc, pspPk, mint
  );

  // Fetch the drawdown so the memo can show principal + projected fees.
  // Optional — if RPC fails, we still build with a generic memo.
  let memo = `DeFa: Repay drawdown #${drawdownId} — principal + accrued util/penalty fees`;
  try {
    const dd = await program.account.drawdown.fetch(drawdown);
    const pool_ = await program.account.pool.fetch(poolPk);
    const principal = BigInt(dd.principal.toString());
    const spd = pool_.secondsPerDay || 86_400;
    const today = Math.floor(Date.now() / 1000 / spd);
    const daysActive = Math.max(1, today - dd.drawdownDay + 1);
    const normalMax = dd.tenorDays + pool_.graceDays;
    const utilDays = Math.min(daysActive, normalMax);
    const penaltyDays = Math.max(0, daysActive - normalMax);
    const utilFee = (principal * BigInt(pool_.utilizationRateBps) * BigInt(utilDays)) / 10000n;
    const penaltyFee = (principal * BigInt(pool_.penaltyRateBps) * BigInt(penaltyDays)) / 10000n;
    const total = principal + utilFee + penaltyFee;
    memo = `DeFa: Repay drawdown #${drawdownId} — pay ${memoUsd(total)} (principal ${memoUsd(principal)} + util ${memoUsd(utilFee)}${penaltyFee > 0n ? ` + penalty ${memoUsd(penaltyFee)}` : ''})`;
  } catch { /* fall through to generic memo */ }

  const ix = await program.methods
    .repay(new BN(drawdownId.toString()))
    .accounts({
      pool: poolPk,
      drawdown,
      vault,
      pspUsdc,
      psp: pspPk,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

  return _wrap([ataIx, ix], { memo });
}

async function buildSettleCommitFeeTx({ pool, psp, usdcMint }) {
  const program = getProgram();
  const feePayer = getFeePayer();
  const poolPk = new PublicKey(pool);
  const pspPk = new PublicKey(psp);
  const mint = usdcMint ? new PublicKey(usdcMint) : getUsdcDfMint();
  const [vault] = deriveVault(poolPk);
  const pspUsdc = getAssociatedTokenAddressSync(mint, pspPk);

  const ataIx = createAssociatedTokenAccountIdempotentInstruction(
    feePayer.publicKey, pspUsdc, pspPk, mint
  );

  // Best-effort fetch to show the exact commit-fee amount in the wallet popup.
  let memo = 'DeFa: Settle commit fee — clears pool unutilized fee balance';
  try {
    const pool_ = await program.account.pool.fetch(poolPk);
    memo = `DeFa: Settle commit fee — pay ${memoUsd(pool_.accruedCommitFee.toString())} USDC (clears pool unutilized fee)`;
  } catch { /* fall through to generic memo */ }

  const ix = await program.methods
    .settleCommitFee()
    .accounts({
      pool: poolPk,
      vault,
      pspUsdc,
      psp: pspPk,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

  return _wrap([ataIx, ix], { memo });
}

async function buildRedeemLpTx({ pool, lender, lpAmount, usdcMint }) {
  const program = getProgram();
  const poolPk = new PublicKey(pool);
  const lenderPk = new PublicKey(lender);
  const mint = usdcMint ? new PublicKey(usdcMint) : getUsdcDfMint();
  const [vault] = deriveVault(poolPk);
  const [lpMint] = deriveLpMint(poolPk);
  const lenderUsdc = getAssociatedTokenAddressSync(mint, lenderPk);
  const lenderLp = getAssociatedTokenAddressSync(lpMint, lenderPk);

  const ix = await program.methods
    .redeemLp(new BN(lpAmount.toString()))
    .accounts({
      pool: poolPk,
      vault,
      lpMint,
      lenderUsdc,
      lenderLp,
      lender: lenderPk,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

  return _wrap(ix, {
    memo: `DeFa: Redeem ${memoUsd(lpAmount)} LP — receive pro-rata share of vault USDC`,
  });
}

async function buildClaimProtocolFeesTx({ pool, admin, usdcMint }) {
  const program = getProgram();
  const feePayer = getFeePayer();
  const poolPk = new PublicKey(pool);
  const adminPk = new PublicKey(admin);
  const mint = usdcMint ? new PublicKey(usdcMint) : getUsdcDfMint();
  const [vault] = deriveVault(poolPk);
  const adminUsdc = getAssociatedTokenAddressSync(mint, adminPk);

  // Pre-create the admin's USDC-DF ATA. The program transfers vault →
  // adminUsdc and bails with AccountNotInitialized if the admin has
  // never received USDC-DF before. Idempotent — no-op if it already
  // exists. Paid by the relay so the admin doesn't need SOL for it.
  const ataIx = createAssociatedTokenAccountIdempotentInstruction(
    feePayer.publicKey, // payer
    adminUsdc,
    adminPk,
    mint
  );

  // Best-effort fetch to show the exact protocol fee amount in the wallet popup.
  let memo = 'DeFa: Claim protocol fees (admin) — transfers pool protocol cut to admin wallet';
  try {
    const pool_ = await program.account.pool.fetch(poolPk);
    memo = `DeFa: Claim ${memoUsd(pool_.protocolFeesOwed.toString())} USDC protocol fees (admin)`;
  } catch { /* fall through to generic memo */ }

  const ix = await program.methods
    .claimProtocolFees()
    .accounts({
      pool: poolPk,
      vault,
      adminUsdc,
      admin: adminPk,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

  return _wrap([ataIx, ix], { memo });
}

async function buildDeclareDefaultTx({ pool, admin }) {
  const program = getProgram();
  const ix = await program.methods
    .declareDefault()
    .accounts({ pool: new PublicKey(pool), admin: new PublicKey(admin) })
    .instruction();
  return _wrap(ix, {
    memo: 'DeFa: Declare default (admin) — pool past tenor + buffer, lenders can redeem against vault remainder',
  });
}

module.exports = {
  // PDAs
  derivePool,
  deriveVault,
  deriveLpMint,
  deriveDrawdown,
  // program
  getProgram,
  // account reads
  fetchPool,
  fetchPoolMaybe,
  accountExists,
  fetchDrawdown,
  fetchAllPools,
  fetchAllDrawdowns,
  fetchActiveDrawdownsForPool,
  // tx builders
  buildInitializePoolTx,
  buildDepositTx,
  buildWithdrawFundingTx,
  buildExecuteFacilityTx,
  buildCancelFundingTx,
  buildRequestDrawdownTx,
  buildRepayTx,
  buildSettleCommitFeeTx,
  buildRedeemLpTx,
  buildClaimProtocolFeesTx,
  buildDeclareDefaultTx,
};
