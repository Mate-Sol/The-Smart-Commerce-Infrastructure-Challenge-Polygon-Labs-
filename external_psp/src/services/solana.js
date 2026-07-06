/**
 * Same wallet helpers as the CredMate client, copy-pasted slim into the
 * external_psp portal. The portal only needs `signAndRelay` for the
 * Sign Drawdown action — there's no lender/admin flow here.
 */
import axios from 'axios';
import { Transaction } from '@solana/web3.js';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5050';

function getToken() {
  return (
    sessionStorage.getItem('token') ||
    localStorage.getItem('externalPspToken') ||
    localStorage.getItem('token') ||
    ''
  );
}

export function api() {
  const token = getToken();
  return axios.create({
    baseURL: API_BASE,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

export async function signAndRelay(wallet, txBase64) {
  if (!wallet.signTransaction) {
    throw new Error('Connected wallet does not support signTransaction');
  }
  const tx = Transaction.from(Buffer.from(txBase64, 'base64'));
  const signed = await wallet.signTransaction(tx);
  const userSignedB64 = signed
    .serialize({ requireAllSignatures: false })
    .toString('base64');
  const { data } = await api().post('/relay/submit', { tx: userSignedB64 });
  return data;
}

export async function buildSignRelay(wallet, endpoint, body) {
  const { data: built } = await api().post(endpoint, body);
  if (!built.txBase64) throw new Error('Server did not return a tx');
  const result = await signAndRelay(wallet, built.txBase64);
  return { ...result, built };
}
