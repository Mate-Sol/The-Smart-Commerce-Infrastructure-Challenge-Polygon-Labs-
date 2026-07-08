import { useEffect, useState } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, getAccount } from '@solana/spl-token';
import { X, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { api, buildSignRelay } from '../../services/solana';

/**
 * Lender redeem modal. Reads the connected wallet's LP token balance for
 * this pool's lpMint, lets the user redeem any amount up to that balance.
 *
 * Pool data isn't trusted from the parent — we re-fetch /pool/pool/:pubkey/state
 * to pick up any state change between list-load and modal-open (e.g. pool
 * just got cancelled and now is_cancelled true means redemption opens).
 */
const RedeemModal = ({ pool, onClose, onSuccess }) => {
  const wallet = useWallet();
  const { connection } = useConnection();
  const [lpBalance, setLpBalance] = useState(null); // bigint
  const [poolState, setPoolState] = useState(pool);
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  // Read on-chain LP balance for this lender + pool. The Pool account exposes
  // lpMint; we derive the lender's ATA and read its balance directly via RPC.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: state } = await api().get(`/pool/pool/${pool.pubkey}/state`);
        if (cancelled) return;
        setPoolState({ ...pool, ...state });

        if (!wallet.publicKey) {
          setLpBalance(0n);
          return;
        }
        const lpMint = new PublicKey(state.lpMint);
        const ata = getAssociatedTokenAddressSync(lpMint, wallet.publicKey);
        try {
          const acc = await getAccount(connection, ata);
          if (!cancelled) setLpBalance(acc.amount);
        } catch {
          // ATA doesn't exist → 0 balance
          if (!cancelled) setLpBalance(0n);
        }
      } catch (e) {
        toast.error(e.response?.data?.message || e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [pool.pubkey, wallet.publicKey?.toBase58()]);

  const handleMax = () => {
    if (lpBalance === null) return;
    setAmount(lpBalance.toString());
  };

  const handleRedeem = async () => {
    if (!wallet.connected) {
      toast.error('Wallet not connected');
      return;
    }
    if (!amount) {
      toast.error('Enter an amount');
      return;
    }
    let lpAmount;
    try {
      lpAmount = BigInt(amount);
    } catch {
      toast.error('Amount must be an integer');
      return;
    }
    if (lpAmount <= 0n) {
      toast.error('Amount must be positive');
      return;
    }
    if (lpBalance !== null && lpAmount > lpBalance) {
      toast.error('Amount exceeds your LP balance');
      return;
    }

    setSubmitting(true);
    try {
      const result = await buildSignRelay(wallet, '/pool/lender/build-tx/redeem', {
        pool: pool.pubkey,
        lpAmount: lpAmount.toString(),
      });
      toast.success(`Redeemed: ${result.signature.slice(0, 8)}…`);
      onSuccess();
    } catch (e) {
      toast.error(e.response?.data?.message || e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const fmtLp = (base) => {
    if (base === null) return '—';
    const usd = Number(base) / 1_000_000;
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(usd);
  };

  const isClosable = poolState.isActive || poolState.isCancelled || poolState.isDefaulted;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900">Redeem LP</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-slate-50 rounded-lg p-3 text-sm text-slate-600 mb-4">
          <div className="font-medium text-slate-900 mb-1">{poolState.pspName}</div>
          <code className="text-xs font-mono text-slate-500">{poolState.pubkey}</code>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
          </div>
        ) : (
          <>
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 mb-4">
              <div className="text-xs text-emerald-700 mb-1">Your LP balance</div>
              <div className="text-2xl font-bold text-emerald-900">
                {fmtLp(lpBalance)} <span className="text-sm font-normal">LP</span>
              </div>
            </div>

            <label className="block text-sm font-medium text-slate-700 mb-2">
              LP amount to redeem (base units)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="0"
                className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 font-mono text-slate-900 placeholder:text-slate-400"
              />
              <button
                onClick={handleMax}
                className="px-3 py-2 border border-slate-300 text-slate-700 rounded-lg text-sm hover:bg-slate-50"
              >
                Max
              </button>
            </div>

            {/* Live USDC-out estimate. LP is minted 1:1 at deposit, so the
                base case is 1 LP ≈ 1 USDC. Final amount adjusts pro-rata
                to vault remainder, which includes accrued lender yield
                (and absorbs any haircut on default). */}
            {amount && /^\d+$/.test(amount) && BigInt(amount) > 0n && (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mt-2 text-xs">
                <div className="flex justify-between items-baseline">
                  <span className="text-slate-500">Estimated USDC out</span>
                  <span className="font-mono font-semibold text-slate-900">
                    ≈ {fmtLp(amount)} USDC
                  </span>
                </div>
                <div className="text-[10px] text-slate-500 mt-1 leading-snug">
                  1 LP ≈ 1 USDC base. Actual amount = your LP × (vault USDC /
                  total LP supply) at redemption time, so any accrued lender
                  yield bumps this up; default haircut would reduce it.
                </div>
              </div>
            )}

            {!isClosable && (
              <p className="text-xs text-amber-700 mt-2">
                Pool not yet redeemable — wait for facility close-out, cancellation, or default.
              </p>
            )}

            <div className="flex gap-2 mt-6">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                onClick={handleRedeem}
                disabled={submitting || !amount || !isClosable}
                className="flex-1 px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg flex items-center justify-center gap-2"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {submitting ? 'Confirming…' : 'Redeem'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default RedeemModal;
