/**
 * USDC-DF faucet — devnet/test only.
 *
 * POST /faucet/usdc-df
 *   body: { wallet: "<base58 pubkey>" }
 *
 * Mints `GRANT_PER_CALL` (1M USDC-DF, 6 decimals) to the recipient's
 * associated token account. Per-wallet lifetime cap of `LIFETIME_CAP`
 * (10M USDC-DF). Cooldown of `COOLDOWN_MS` between calls.
 *
 * Auth: open endpoint (anyone with a wallet can claim). Rate limit is
 * enforced by the per-wallet `FaucetClaim` record, not by IP, so the same
 * wallet can't bypass via multiple IPs.
 *
 * Server holds the mint authority (FAUCET_AUTHORITY_PRIVATE_KEY). This is
 * fine for a fake test token; the production env (mainnet USDC) skips this
 * route entirely by setting USDC_DF_MINT_ADDRESS empty.
 */

const express = require('express');
const router = express.Router();
const {
  PublicKey,
  Transaction,
  ComputeBudgetProgram,
  sendAndConfirmTransaction,
} = require('@solana/web3.js');
const {
  getOrCreateAssociatedTokenAccount,
  createMintToInstruction,
} = require('@solana/spl-token');

const FaucetClaim = require('../models/FaucetClaim');
const {
  getConnection,
  getFaucetAuthority,
  getFeePayer,
  getUsdcDfMint,
} = require('../services/solanaService');

const USDC_DECIMALS = 6n;
const ONE_USDC = 10n ** USDC_DECIMALS;
const GRANT_PER_CALL = 1_000_000n * ONE_USDC; // 1M USDC-DF
const LIFETIME_CAP = 10_000_000n * ONE_USDC;  // 10M USDC-DF
const COOLDOWN_MS = 60 * 1000;                 // 1 minute between calls

router.post('/usdc-df', async (req, res) => {
  try {
    const { wallet } = req.body || {};
    if (!wallet || typeof wallet !== 'string') {
      return res.status(400).json({ message: 'wallet (base58 pubkey) required' });
    }

    let recipient;
    try {
      recipient = new PublicKey(wallet);
    } catch {
      return res.status(400).json({ message: 'wallet is not a valid base58 Solana pubkey' });
    }

    const mint = getUsdcDfMint();
    const mintAuthority = getFaucetAuthority();
    if (!mint || !mintAuthority) {
      return res.status(503).json({
        message: 'Faucet not configured on this environment',
      });
    }

    // Per-wallet cap + cooldown enforcement.
    const claim = await FaucetClaim.findOne({ wallet: recipient.toBase58() });
    const totalMinted = BigInt(claim?.totalMinted || '0');
    if (totalMinted + GRANT_PER_CALL > LIFETIME_CAP) {
      return res.status(429).json({
        message: 'Lifetime cap reached for this wallet',
        totalMinted: totalMinted.toString(),
        cap: LIFETIME_CAP.toString(),
      });
    }
    if (claim?.lastClaimAt && Date.now() - new Date(claim.lastClaimAt).getTime() < COOLDOWN_MS) {
      const wait = Math.ceil(
        (COOLDOWN_MS - (Date.now() - new Date(claim.lastClaimAt).getTime())) / 1000
      );
      return res.status(429).json({
        message: `Cooldown active; retry in ${wait}s`,
        retryAfterSeconds: wait,
      });
    }

    const connection = getConnection();
    const feePayer = getFeePayer() || mintAuthority;

    // Ensure recipient has an ATA. This will create it (paying rent from
    // mintAuthority). spl-token's helper signs on behalf of the payer and
    // the owner is just a key reference — no signature required from the
    // recipient.
    const recipientAta = await getOrCreateAssociatedTokenAccount(
      connection,
      mintAuthority, // payer for ATA rent
      mint,
      recipient
    );

    const tx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }),
      createMintToInstruction(
        mint,
        recipientAta.address,
        mintAuthority.publicKey,
        GRANT_PER_CALL
      )
    );

    const signers = feePayer.publicKey.equals(mintAuthority.publicKey)
      ? [mintAuthority]
      : [feePayer, mintAuthority];
    tx.feePayer = feePayer.publicKey;

    const txSignature = await sendAndConfirmTransaction(connection, tx, signers, {
      commitment: 'confirmed',
    });

    // Persist claim record.
    const newTotal = (totalMinted + GRANT_PER_CALL).toString();
    await FaucetClaim.findOneAndUpdate(
      { wallet: recipient.toBase58() },
      {
        $set: { totalMinted: newTotal, lastClaimAt: new Date() },
        $inc: { callCount: 1 },
        $push: {
          history: {
            amount: GRANT_PER_CALL.toString(),
            txSignature,
            claimedAt: new Date(),
          },
        },
      },
      { upsert: true, new: true }
    );

    res.json({
      success: true,
      wallet: recipient.toBase58(),
      mint: mint.toBase58(),
      ata: recipientAta.address.toBase58(),
      amount: GRANT_PER_CALL.toString(),
      totalMinted: newTotal,
      remaining: (LIFETIME_CAP - totalMinted - GRANT_PER_CALL).toString(),
      txSignature,
    });
  } catch (err) {
    console.error('[faucet] error:', err);
    res.status(500).json({ message: 'Faucet error', error: err.message });
  }
});

router.get('/usdc-df/status/:wallet', async (req, res) => {
  try {
    const claim = await FaucetClaim.findOne({ wallet: req.params.wallet });
    res.json({
      wallet: req.params.wallet,
      totalMinted: claim?.totalMinted || '0',
      callCount: claim?.callCount || 0,
      remaining: (LIFETIME_CAP - BigInt(claim?.totalMinted || '0')).toString(),
      grantPerCall: GRANT_PER_CALL.toString(),
      lifetimeCap: LIFETIME_CAP.toString(),
      cooldownMs: COOLDOWN_MS,
      lastClaimAt: claim?.lastClaimAt || null,
    });
  } catch (err) {
    res.status(500).json({ message: 'Status lookup failed', error: err.message });
  }
});

module.exports = router;
