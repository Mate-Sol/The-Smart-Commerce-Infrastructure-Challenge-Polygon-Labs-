/**
 * Wallet-signature authentication helpers.
 *
 * Verifies that a base58 signature over a known nonce was produced by the
 * private key corresponding to the given Solana pubkey, using ed25519
 * (the same scheme Solana wallets use). The nonce is created server-side
 * and bound to the wallet that requested it; the client signs the raw
 * nonce string's UTF-8 bytes with its wallet.
 *
 * This is the canonical "Sign in with Solana" pattern.
 */

const crypto = require('crypto');
const nacl = require('tweetnacl');
const bs58 = require('bs58');
const { PublicKey } = require('@solana/web3.js');

const AuthNonce = require('../models/AuthNonce');

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function bs58Decode(str) {
  const fn = bs58.decode || (bs58.default && bs58.default.decode);
  return fn(str);
}

/**
 * Issue a fresh nonce for a wallet. Stored with a TTL so unused nonces are
 * reaped automatically. Multiple in-flight nonces per wallet are allowed
 * (e.g., two browser tabs); each is single-use.
 */
async function issueNonce(walletStr, purpose = 'login') {
  // Validate wallet pubkey shape early.
  let wallet;
  try {
    wallet = new PublicKey(walletStr).toBase58();
  } catch {
    throw new Error('Invalid wallet pubkey');
  }
  const nonce = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + NONCE_TTL_MS);
  await AuthNonce.create({ wallet, nonce, purpose, expiresAt });
  return {
    wallet,
    nonce,
    expiresAt,
    message: `Sign in to DeFa\nWallet: ${wallet}\nNonce: ${nonce}`,
  };
}

/**
 * Verify a base58-encoded ed25519 signature over the nonce string. Returns
 * the wallet pubkey (canonical base58) on success. Consumes the nonce
 * regardless of outcome to prevent replay.
 */
async function verifySignature({ wallet, nonce, signature, purpose = 'login' }) {
  let walletPk;
  try {
    walletPk = new PublicKey(wallet);
  } catch {
    throw new Error('Invalid wallet pubkey');
  }

  // Atomically claim the nonce ONLY if it's still unconsumed AND unexpired.
  // Putting expiry in the filter (instead of checking after the update)
  // means an expired nonce isn't burned — the user can simply request a
  // fresh one and retry instead of getting "already used" on the second try.
  const record = await AuthNonce.findOneAndUpdate(
    { wallet: walletPk.toBase58(), nonce, purpose, consumedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { consumedAt: new Date() } },
    { new: false }
  );
  if (!record) throw new Error('Nonce not found, expired, or already used');

  // The signed payload is the same `message` the client constructed for
  // display. Wallets typically `signMessage(Buffer.from(message))`.
  const message = `Sign in to DeFa\nWallet: ${walletPk.toBase58()}\nNonce: ${nonce}`;
  const messageBytes = Buffer.from(message, 'utf8');

  let sigBytes;
  try {
    sigBytes = bs58Decode(signature);
  } catch {
    throw new Error('Signature must be base58-encoded');
  }
  if (sigBytes.length !== 64) {
    throw new Error('Signature must be 64 bytes');
  }

  const ok = nacl.sign.detached.verify(messageBytes, sigBytes, walletPk.toBytes());
  if (!ok) throw new Error('Signature verification failed');

  return walletPk.toBase58();
}

module.exports = {
  issueNonce,
  verifySignature,
  NONCE_TTL_MS,
};
