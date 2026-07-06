/**
 * Fee-payer relay — covers SOL fees so PSPs / lenders / admin never need
 * SOL in their wallet. Frontend builds a tx with `feePayer = relayPubkey`,
 * signs as the auth signer, base64-encodes, and POSTs it here.
 *
 * The relay then:
 *  1. Decodes the tx and validates every instruction's program ID is in
 *     the allowlist (paymate-pool-v2 + spl-token + associated-token-account
 *     + compute-budget). Anything else is rejected hard — the relay must
 *     never sign for an arbitrary program.
 *  2. Identifies the human signer (the non-relay signer with a partial sig
 *     attached), uses that pubkey as the rate-limit key.
 *  3. Enforces per-wallet daily quota.
 *  4. Adds the relay's signature as fee payer.
 *  5. Submits to the network and returns the signature.
 *
 * The relay key is loaded from FEE_PAYER_PRIVATE_KEY (separate keypair from
 * faucet authority and from any admin authority on the program).
 *
 * Endpoints:
 *   POST /relay/submit         { tx: base64 } → { signature }
 *   GET  /relay/health         → { pubkey, sol_balance, daily_quota }
 *   GET  /relay/usage/:wallet  → { dailyCount, lifetimeCount, ... }
 */

const express = require('express');
const router = express.Router();
const {
  Transaction,
  PublicKey,
  sendAndConfirmRawTransaction,
} = require('@solana/web3.js');

const RelayUsage = require('../models/RelayUsage');
const { getConnection, getFeePayer, PROGRAM_ID } = require('../services/solanaService');

// Programs the relay will sign for. Anything not in this set causes the
// relay to refuse — protects against an attacker tricking the relay into
// signing arbitrary tx (e.g., draining a user wallet via a token transfer
// instruction with the user as authority).
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const ASSOCIATED_TOKEN_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const COMPUTE_BUDGET_PROGRAM = new PublicKey('ComputeBudget111111111111111111111111111111');
const SYSTEM_PROGRAM = new PublicKey('11111111111111111111111111111111');
// SPL Memo — used by tx-builders that prepend a human-readable note
// (e.g. "Lender deposit", "PSP repayment") so on-chain explorers show
// context. Memo can't move funds or change state, so allowing it does
// not widen the relay's authority.
const MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

const ALLOWED_PROGRAMS = new Set([
  PROGRAM_ID.toBase58(),
  TOKEN_PROGRAM.toBase58(),
  TOKEN_2022_PROGRAM.toBase58(),
  ASSOCIATED_TOKEN_PROGRAM.toBase58(),
  COMPUTE_BUDGET_PROGRAM.toBase58(),
  SYSTEM_PROGRAM.toBase58(), // needed for ATA creation rent + drawdown PDA init
  MEMO_PROGRAM.toBase58(),
]);

const DAILY_QUOTA_PER_WALLET = parseInt(process.env.RELAY_DAILY_QUOTA || '50', 10);
const MAX_INSTRUCTIONS_PER_TX = 8;
const WINDOW_MS = 24 * 60 * 60 * 1000;

router.post('/submit', async (req, res) => {
  try {
    const feePayer = getFeePayer();
    if (!feePayer) {
      return res.status(503).json({ message: 'Relay not configured' });
    }

    const { tx: txBase64 } = req.body || {};
    if (!txBase64 || typeof txBase64 !== 'string') {
      return res.status(400).json({ message: 'tx (base64) required' });
    }

    let tx;
    try {
      tx = Transaction.from(Buffer.from(txBase64, 'base64'));
    } catch (e) {
      return res.status(400).json({ message: 'tx failed to deserialize', error: e.message });
    }

    // --- Sanity checks on tx shape -----------------------------------------
    if (!tx.feePayer || !tx.feePayer.equals(feePayer.publicKey)) {
      return res.status(400).json({
        message: 'tx.feePayer must equal relay pubkey',
        expected: feePayer.publicKey.toBase58(),
        got: tx.feePayer ? tx.feePayer.toBase58() : null,
      });
    }
    if (tx.instructions.length === 0 || tx.instructions.length > MAX_INSTRUCTIONS_PER_TX) {
      return res.status(400).json({
        message: `tx must have 1..${MAX_INSTRUCTIONS_PER_TX} instructions`,
      });
    }

    // --- Allowlist enforcement ---------------------------------------------
    for (const ix of tx.instructions) {
      if (!ALLOWED_PROGRAMS.has(ix.programId.toBase58())) {
        return res.status(403).json({
          message: 'instruction targets disallowed program',
          programId: ix.programId.toBase58(),
        });
      }
    }

    // --- Identify human signer ---------------------------------------------
    // The relay is one of the signers (fee payer). The other signer(s) are
    // the human(s). For rate-limiting we use the first non-relay signature.
    const userSig = tx.signatures.find(
      (s) => s.signature && !s.publicKey.equals(feePayer.publicKey)
    );
    if (!userSig) {
      return res.status(400).json({
        message: 'tx must include at least one user signature distinct from relay',
      });
    }
    const userPubkey = userSig.publicKey.toBase58();

    // --- Rate limit --------------------------------------------------------
    let usage = await RelayUsage.findOne({ wallet: userPubkey });
    const now = Date.now();
    if (!usage) {
      usage = new RelayUsage({ wallet: userPubkey, lastWindowAt: new Date(now) });
    } else if (now - new Date(usage.lastWindowAt).getTime() > WINDOW_MS) {
      usage.dailyCount = 0;
      usage.lastWindowAt = new Date(now);
    }
    if (usage.dailyCount >= DAILY_QUOTA_PER_WALLET) {
      return res.status(429).json({
        message: 'Daily relay quota exceeded',
        wallet: userPubkey,
        quota: DAILY_QUOTA_PER_WALLET,
      });
    }

    // --- Add relay's signature and submit ----------------------------------
    tx.partialSign(feePayer);

    const connection = getConnection();
    const raw = tx.serialize();
    const signature = await sendAndConfirmRawTransaction(connection, raw, {
      commitment: 'confirmed',
      skipPreflight: false,
    });

    usage.dailyCount += 1;
    usage.lifetimeCount += 1;
    usage.lastTxAt = new Date();
    await usage.save();

    res.json({ success: true, signature, wallet: userPubkey });
  } catch (err) {
    // SendTransactionError carries program logs that are very useful for
    // the frontend to surface to the user. Bubble them up.
    const logs = err.logs || err.transactionLogs || null;
    console.error('[relay] submit error:', err.message, logs ? logs.join('\n') : '');
    res.status(500).json({ message: 'Relay submit failed', error: err.message, logs });
  }
});

router.get('/health', async (req, res) => {
  try {
    const feePayer = getFeePayer();
    if (!feePayer) {
      return res.json({ status: 'unconfigured' });
    }
    const connection = getConnection();
    const lamports = await connection.getBalance(feePayer.publicKey);
    res.json({
      status: 'ok',
      pubkey: feePayer.publicKey.toBase58(),
      solBalance: lamports / 1e9,
      lamports,
      dailyQuotaPerWallet: DAILY_QUOTA_PER_WALLET,
      allowedPrograms: [...ALLOWED_PROGRAMS],
    });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

router.get('/usage/:wallet', async (req, res) => {
  const usage = await RelayUsage.findOne({ wallet: req.params.wallet });
  res.json({
    wallet: req.params.wallet,
    dailyCount: usage?.dailyCount || 0,
    lifetimeCount: usage?.lifetimeCount || 0,
    quota: DAILY_QUOTA_PER_WALLET,
    lastTxAt: usage?.lastTxAt || null,
    windowResetsAt: usage
      ? new Date(new Date(usage.lastWindowAt).getTime() + WINDOW_MS)
      : null,
  });
});

module.exports = router;
