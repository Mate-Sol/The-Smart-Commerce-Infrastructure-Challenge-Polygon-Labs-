import { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { Loader2, RefreshCw, Zap } from 'lucide-react';
import toast from 'react-hot-toast';
import Sidebar from '../../components/Sidebar';
import WalletBindButton from '../../components/WalletBindButton';
import PoolInitConfirmModal from '../../components/admin/PoolInitConfirmModal';
import { api, buildSignRelay } from '../../services/solana';

// Admin queue for facilities in AWAITING_POOL_INIT (CRO-approved, awaiting
// the on-chain initialize_pool tx). Each row corresponds to one Facility
// doc — same PSP can appear multiple times if they have several facilities
// pending init.
const PendingPoolInits = () => {
  const wallet = useWallet();
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState(null);
  const [boundWallet, setBoundWallet] = useState('');
  const [confirmFacility, setConfirmFacility] = useState(null);

  const refresh = async () => {
    try {
      setLoading(true);
      const [pendingRes, meRes] = await Promise.all([
        api().get('/pool/admin/pending-pool-inits'),
        api().get('/auth/me').catch(() => ({ data: {} })),
      ]);
      setPending(pendingRes.data);
      setBoundWallet(meRes.data?.solanaWallet || '');
    } catch (e) {
      toast.error(e.response?.data?.message || e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const handleSign = (facility) => {
    if (!wallet.connected) {
      toast.error('Connect your admin wallet first');
      return;
    }
    setConfirmFacility(facility);
  };

  const handleConfirmSign = async (overrides) => {
    const facility = confirmFacility;
    if (!facility) return;
    setSigning(facility._id);
    try {
      const result = await buildSignRelay(
        wallet,
        '/pool/admin/build-tx/initialize-pool',
        { facilityDocId: facility._id, overrides }
      );
      toast.success(`Pool initialized: ${result.signature.slice(0, 8)}…`);
      // Indexer needs ~15s before on-chain state shows up; retry the confirm.
      for (let i = 0; i < 6; i++) {
        try {
          await api().post(`/pool/admin/confirm-pool-init/${facility._id}`, { txSig: result.signature });
          break;
        } catch (e) {
          if (e.response?.status === 409) {
            await new Promise((r) => setTimeout(r, 3000));
            continue;
          }
          throw e;
        }
      }
      refresh();
      setConfirmFacility(null);
    } catch (e) {
      toast.error(e.response?.data?.message || e.message);
    } finally {
      setSigning(null);
    }
  };

  const fmt = (usd) => {
    if (!usd) return '—';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(usd);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <Sidebar />
      <main className="ml-64 p-8">
        <div className="max-w-6xl mx-auto">
          <header className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Pending Pool Initializations</h1>
              <p className="text-slate-600 text-sm mt-1">
                CRO-approved facilities waiting for an admin to sign{' '}
                <code className="text-xs">initialize_pool</code> on-chain.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={refresh} className="text-slate-500 hover:text-slate-900" title="Refresh">
                <RefreshCw className="w-4 h-4" />
              </button>
              <WalletMultiButton />
            </div>
          </header>

          <div className="mb-6">
            <WalletBindButton boundWallet={boundWallet} onBound={(pubkey) => setBoundWallet(pubkey)} />
          </div>

          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
          ) : pending.length === 0 ? (
            <div className="bg-white rounded-lg border border-slate-200 p-12 text-center text-slate-500">
              Nothing pending. CRO approvals will appear here for signing.
            </div>
          ) : (
            <div className="space-y-3">
              {pending.map((f) => {
                const t = f.approvedTerms || {};
                return (
                  <div key={f._id} className="bg-white rounded-lg border border-slate-200 p-5">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <div className="font-semibold text-slate-900">
                          {f.companyName || 'PSP'}
                          <span className="ml-2 text-xs text-slate-500">
                            · facility #{f.facilityId}
                            {f.label && ` · ${f.label}`}
                            {f.isFirstFacility && <span className="ml-2 px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded">first</span>}
                          </span>
                        </div>
                        <code className="text-xs text-slate-400 font-mono">{f.pspWallet}</code>
                      </div>
                      {(() => {
                        const connectedKey = wallet.publicKey?.toBase58();
                        const walletMatches = boundWallet && connectedKey && connectedKey === boundWallet;
                        const blocker =
                          !boundWallet ? 'Bind admin wallet first' :
                          !wallet.connected ? 'Connect your wallet' :
                          !walletMatches ? `Connected wallet must match bound (${boundWallet.slice(0,6)}…)` :
                          '';
                        return (
                          <button
                            onClick={() => handleSign(f)}
                            disabled={signing === f._id || !!blocker}
                            title={blocker || undefined}
                            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg flex items-center gap-2"
                          >
                            {signing === f._id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                            Sign Pool Init
                          </button>
                        );
                      })()}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                      <div>
                        <div className="text-xs text-slate-500">Approved Credit Line</div>
                        <div className="text-slate-900">{fmt(t.creditLine)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-500">Tenor</div>
                        <div className="text-slate-900">{t.tenorDays}d</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-500">Util / Commit Bps</div>
                        <div className="text-slate-900">{t.utilizationRateBps} / {t.commitmentRateBps}</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-500">Future Pool PDA</div>
                        <code className="text-xs text-slate-700 font-mono">{f.poolPda?.slice(0, 12)}…</code>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {confirmFacility && (
        <PoolInitConfirmModal
          profile={confirmFacility}
          submitting={signing === confirmFacility._id}
          onCancel={() => signing ? null : setConfirmFacility(null)}
          onConfirm={handleConfirmSign}
        />
      )}
    </div>
  );
};

export default PendingPoolInits;
