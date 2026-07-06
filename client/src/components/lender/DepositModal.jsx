import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { X, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { buildSignRelay } from '../../services/solana';

/**
 * Lender deposit modal. Converts USD-friendly amount → 6-decimal base units,
 * then build-sign-relay against /pool/lender/build-tx/deposit. The connected
 * wallet must hold the USDC-DF being deposited (use /faucet/usdc-df first).
 */
const DepositModal = ({ pool, onClose, onSuccess }) => {
  const wallet = useWallet();
  const [amountUsd, setAmountUsd] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleDeposit = async () => {
    if (!wallet.connected) {
      toast.error('Wallet not connected');
      return;
    }
    const usd = parseFloat(amountUsd);
    if (!Number.isFinite(usd) || usd <= 0) {
      toast.error('Amount must be a positive number');
      return;
    }
    setSubmitting(true);
    try {
      const baseUnits = BigInt(Math.round(usd * 1_000_000)).toString();
      const result = await buildSignRelay(wallet, '/pool/lender/build-tx/deposit', {
        pool: pool.pubkey,
        amount: baseUnits,
      });
      toast.success(`Deposit confirmed: ${result.signature.slice(0, 8)}…`);
      onSuccess();
    } catch (e) {
      toast.error(e.response?.data?.message || e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900">Deposit USDC-DF</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-slate-50 rounded-lg p-3 text-sm text-slate-600 mb-4">
          <div className="font-medium text-slate-900 mb-1">{pool.pspName}</div>
          <code className="text-xs font-mono text-slate-500">{pool.pubkey}</code>
        </div>

        <label className="block text-sm font-medium text-slate-700 mb-2">
          Amount (USD)
        </label>
        <input
          type="number"
          value={amountUsd}
          onChange={(e) => setAmountUsd(e.target.value)}
          placeholder="0.00"
          className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-slate-900 placeholder:text-slate-400"
        />

        <p className="text-xs text-slate-500 mt-2">
          You will receive LP tokens 1:1 with your deposit. LP can be burned for
          your pro-rata share of the vault after the facility closes.
        </p>

        <div className="flex gap-2 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            onClick={handleDeposit}
            disabled={submitting || !amountUsd}
            className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg flex items-center justify-center gap-2"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {submitting ? 'Confirming…' : 'Deposit'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DepositModal;
