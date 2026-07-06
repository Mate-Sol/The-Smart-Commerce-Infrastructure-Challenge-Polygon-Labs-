/**
 * Solana service — replaces the deleted EVM contractService.js.
 *
 * Provides a singleton Connection plus lazy-loaded keypairs for the two
 * server-side roles. **Admin signing is non-custodial** — admin connects a
 * wallet from the dashboard and signs in-browser. Server-held keys are only
 * for:
 *
 *  1. FAUCET_AUTHORITY_PRIVATE_KEY — mint authority for the fake USDC-DF
 *     SPL mint (devnet only). Lets `/faucet/usdc-df` auto-mint without
 *     human approval. Has no power over real USDC on mainnet.
 *
 *  2. FEE_PAYER_PRIVATE_KEY — covers SOL fees for relayed user transactions
 *     so end users don't need SOL. Cannot sign as authority on any account.
 *
 * Both keys are SEPARATE from any admin authority on the Anchor program.
 */

const { Connection, Keypair, PublicKey, clusterApiUrl } = require('@solana/web3.js');
const bs58 = require('bs58');

const RPC_URL = process.env.SOLANA_RPC_URL || clusterApiUrl('devnet');
const PROGRAM_ID = new PublicKey(
  process.env.PAYMATE_PROGRAM_ID || 'pnYKpEUVokW9uMJxULV5gZMvRjSYh6uDiarg9HN5WCh'
);

let cachedConnection = null;
function getConnection() {
  if (!cachedConnection) {
    cachedConnection = new Connection(RPC_URL, { commitment: 'confirmed' });
  }
  return cachedConnection;
}

function loadKeypairFromEnv(envVar) {
  const raw = process.env[envVar];
  if (!raw) return null;
  // Accept both base58 strings and JSON arrays so the same code path works
  // for `solana-keygen`-style wallet files and the more compact base58 form.
  if (raw.trim().startsWith('[')) {
    try {
      const arr = JSON.parse(raw);
      return Keypair.fromSecretKey(Uint8Array.from(arr));
    } catch (e) {
      throw new Error(`${envVar} looked like JSON array but failed to parse: ${e.message}`);
    }
  }
  try {
    const decoded = bs58.decode ? bs58.decode(raw.trim()) : bs58.default.decode(raw.trim());
    return Keypair.fromSecretKey(decoded);
  } catch (e) {
    throw new Error(`${envVar} failed to decode as base58: ${e.message}`);
  }
}

let cachedFaucetAuthority = null;
function getFaucetAuthority() {
  if (cachedFaucetAuthority === null) {
    cachedFaucetAuthority = loadKeypairFromEnv('FAUCET_AUTHORITY_PRIVATE_KEY');
  }
  return cachedFaucetAuthority;
}

let cachedFeePayer = null;
function getFeePayer() {
  if (cachedFeePayer === null) {
    cachedFeePayer = loadKeypairFromEnv('FEE_PAYER_PRIVATE_KEY');
  }
  return cachedFeePayer;
}

function getUsdcDfMint() {
  const raw = process.env.USDC_DF_MINT_ADDRESS;
  if (!raw) return null;
  return new PublicKey(raw);
}

module.exports = {
  RPC_URL,
  PROGRAM_ID,
  getConnection,
  getFaucetAuthority,
  getFeePayer,
  getUsdcDfMint,
};
