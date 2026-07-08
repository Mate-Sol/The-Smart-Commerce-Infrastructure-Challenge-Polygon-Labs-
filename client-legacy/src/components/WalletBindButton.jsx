import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { CheckCircle, Loader2, Wallet as WalletIcon } from 'lucide-react';
import toast from 'react-hot-toast';
import { walletBind } from '../services/solana';

/**
 * Re-usable wallet-binding component for already-authenticated users
 * (PSPs and admins). Shows three states:
 *   1. Wallet not connected → standard wallet-multi-button.
 *   2. Wallet connected, not yet bound → "Bind this wallet" button.
 *   3. Bound → green check + bound pubkey.
 *
 * `boundWallet` is the wallet pubkey already bound to the account
 * (passed in by the parent via the user profile load), used to detect
 * state 3 without an extra API roundtrip.
 *
 * On successful bind, calls `onBound(walletPubkey)`. The on-chain Pool
 * PDA is bound to this wallet at init time — once a pool exists, the
 * server refuses rebinding.
 */
const WalletBindButton = ({ boundWallet, onBound }) => {
  const wallet = useWallet();
  const [submitting, setSubmitting] = useState(false);

  const handleBind = async () => {
    if (!wallet.connected) {
      toast.error('Connect a wallet first');
      return;
    }
    setSubmitting(true);
    try {
      await walletBind(wallet);
      const pubkey = wallet.publicKey.toBase58();
      toast.success('Wallet bound');
      onBound?.(pubkey);
    } catch (e) {
      toast.error(e.response?.data?.message || e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (boundWallet) {
    return (
      <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
        <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0" />
        <div className="min-w-0">
          <div className="text-sm font-medium text-emerald-900">Wallet bound</div>
          <code className="text-xs text-emerald-700 font-mono break-all">{boundWallet}</code>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <WalletIcon className="w-5 h-5 text-slate-600" />
        <h3 className="text-sm font-semibold text-slate-900">Bind your Solana wallet</h3>
      </div>
      <p className="text-xs text-slate-600 mb-4">
        This wallet is what you'll sign all on-chain actions with. Once a credit
        facility is initialized for you, the wallet is permanently locked to that
        pool — bind a hardware wallet or multisig if this is a production account.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <WalletMultiButton />
        {wallet.connected && (
          <button
            onClick={handleBind}
            disabled={submitting}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Bind this wallet
          </button>
        )}
      </div>
    </div>
  );
};

export default WalletBindButton;
