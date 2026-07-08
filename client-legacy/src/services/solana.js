/**
 * Frontend Solana helpers.
 *
 *  - walletLogin(wallet)         : nonce → signMessage → /auth/wallet/login → JWT
 *  - walletBind(wallet)          : same flow but for /auth/wallet/bind (binds
 *                                  a wallet to an already-authenticated User)
 *  - signAndRelay(wallet, txB64) : decode tx, signTransaction in wallet,
 *                                  submit base64 to /relay/submit, return signature
 *  - api()                       : axios instance pointed at server, with JWT
 *
 * The wallet object is what `useWallet()` returns from
 * @solana/wallet-adapter-react.
 */

import axios from 'axios';
import { Transaction } from '@solana/web3.js';
import bs58 from 'bs58';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5050';

// Token lives in sessionStorage for PSP/admin (AuthContext) and in
// localStorage for lender (wallet-only). On lender routes we MUST prefer
// localStorage — if a stale PSP/admin sessionStorage token is read first
// it shadows the lender token and every API call 401s.
function getToken() {
  const lenderTok = localStorage.getItem('token') || '';
  const userTok   = sessionStorage.getItem('token') || '';
  const onLenderPath =
    typeof window !== 'undefined' &&
    window.location.pathname.startsWith('/lender');
  if (onLenderPath) return lenderTok || userTok;
  return userTok || lenderTok;
}

export function api() {
  const token = getToken();
  return axios.create({
    baseURL: API_BASE,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

async function fetchNonce(walletPubkey, purpose) {
  const { data } = await axios.post(`${API_BASE}/auth/wallet/nonce`, {
    wallet: walletPubkey,
    purpose,
  });
  return data; // { wallet, nonce, expiresAt, message }
}

async function signNonceMessage(wallet, message) {
  if (!wallet.signMessage) {
    throw new Error('Connected wallet does not support signMessage');
  }
  const messageBytes = new TextEncoder().encode(message);
  const sigBytes = await wallet.signMessage(messageBytes);
  return bs58.encode(sigBytes);
}

/**
 * Sign in as a lender. Creates a Lender record on first use, returns JWT.
 */
export async function walletLogin(wallet) {
  if (!wallet.publicKey) throw new Error('Wallet not connected');
  const walletStr = wallet.publicKey.toBase58();
  const { nonce, message } = await fetchNonce(walletStr, 'login');
  const signature = await signNonceMessage(wallet, message);
  const { data } = await axios.post(`${API_BASE}/auth/wallet/login`, {
    wallet: walletStr,
    nonce,
    signature,
  });
  localStorage.setItem('token', data.token);
  localStorage.setItem('lender', JSON.stringify(data.lender));
  return data;
}

/**
 * On-chain admin login. Wallet-only (no email). Server checks the wallet
 * is in the ONCHAIN_ADMIN_WALLETS allowlist before issuing JWT.
 * JWT is stored in sessionStorage so it interops with existing User-side
 * AuthContext semantics (admin pages read `sessionStorage.token`).
 */
export async function onchainAdminLogin(wallet) {
  if (!wallet.publicKey) throw new Error('Wallet not connected');
  const walletStr = wallet.publicKey.toBase58();
  const { nonce, message } = await fetchNonce(walletStr, 'login');
  const signature = await signNonceMessage(wallet, message);
  const { data } = await axios.post(`${API_BASE}/auth/wallet/onchain-admin/login`, {
    wallet: walletStr,
    nonce,
    signature,
  });
  sessionStorage.setItem('token', data.token);
  sessionStorage.setItem('user', JSON.stringify(data.user));
  return data;
}

/**
 * Bind the connected wallet to the currently-authenticated User
 * (PSP or admin). Requires an existing JWT in localStorage.
 */
export async function walletBind(wallet) {
  if (!wallet.publicKey) throw new Error('Wallet not connected');
  const walletStr = wallet.publicKey.toBase58();
  const { nonce, message } = await fetchNonce(walletStr, 'bind');
  const signature = await signNonceMessage(wallet, message);
  const { data } = await api().post('/auth/wallet/bind', {
    wallet: walletStr,
    nonce,
    signature,
  });
  return data;
}

/**
 * Decode a server-built unsigned tx, sign it with the connected wallet, and
 * submit to /relay/submit. Returns the on-chain tx signature.
 *
 * Pre: server set tx.feePayer = relay pubkey and a fresh blockhash. We just
 * add the user signature; the relay adds its own signature server-side.
 *
 * On failure, throws an Error whose .message includes the program-side
 * error name (e.g. "ConstraintHasOne") parsed out of the relay's logs,
 * not just the generic "Relay submit failed" wrapper.
 */
export async function signAndRelay(wallet, txBase64) {
  if (!wallet.signTransaction) {
    throw new Error('Connected wallet does not support signTransaction');
  }
  const tx = Transaction.from(Buffer.from(txBase64, 'base64'));
  const signed = await wallet.signTransaction(tx);
  const userSignedB64 = signed
    .serialize({ requireAllSignatures: false })
    .toString('base64');
  try {
    const { data } = await api().post('/relay/submit', { tx: userSignedB64 });
    return data; // { success, signature, wallet }
  } catch (err) {
    // Pull the most useful detail out of the relay response so the toast
    // shows e.g. "ConstraintHasOne (admin mismatch)" instead of a generic
    // "Relay submit failed".
    const body = err.response?.data || {};
    const logs = Array.isArray(body.logs) ? body.logs : [];
    const anchorErr = logs
      .map((l) => /AnchorError.*Error Code: (\w+)\.\s*Error Number:.*Error Message: (.+)$/.exec(l))
      .find(Boolean);
    const detail = anchorErr
      ? `${anchorErr[1]} — ${anchorErr[2]}`
      : (body.error || body.message || err.message);
    const e = new Error(detail);
    e.original = err;
    e.logs = logs;
    throw e;
  }
}

/**
 * Convenience: end-to-end build + sign + relay for an arbitrary
 * /pool/.../build-tx endpoint.
 *
 *   await buildSignRelay(wallet, '/pool/lender/build-tx/deposit', { pool, amount });
 */
export async function buildSignRelay(wallet, endpoint, body) {
  const { data: built } = await api().post(endpoint, body);
  if (!built.txBase64) throw new Error('Server did not return a tx');
  const result = await signAndRelay(wallet, built.txBase64);
  return { ...result, built };
}
