import { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Loader2, RefreshCw, Zap, Inbox } from 'lucide-react';
import toast from 'react-hot-toast';
import OnChainAdminLayout from './Layout';
import PoolInitConfirmModal from '../../components/admin/PoolInitConfirmModal';
import { api, buildSignRelay } from '../../services/solana';

const fmtUsd = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(n) || 0);

const InitializeQueue = () => {
  const wallet = useWallet();
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState(null);
  const [confirmProfile, setConfirmProfile] = useState(null);

  const refresh = async () => {
    try {
      setLoading(true);
      const { data } = await api().get('/pool/admin/pending-pool-inits');
      setPending(data);
    } catch (e) {
      toast.error(e.response?.data?.message || e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const handleConfirmSign = async (overrides) => {
    const profile = confirmProfile;
    if (!profile) return;
    if (!wallet.connected) { toast.error('Connect wallet first'); return; }
    setSigning(profile._id);
    try {
      const result = await buildSignRelay(
        wallet,
        '/pool/admin/build-tx/initialize-pool',
        { pspProfileId: profile._id, overrides }
      );
      toast.success(`Pool initialized: ${result.signature.slice(0, 8)}…`);
      for (let i = 0; i < 6; i++) {
        try { await api().post(`/pool/admin/confirm-pool-init/${profile._id}`); break; }
        catch (e) {
          if (e.response?.status === 409) { await new Promise(r => setTimeout(r, 3000)); continue; }
          throw e;
        }
      }
      setConfirmProfile(null);
      refresh();
    } catch (e) {
      toast.error(e.response?.data?.message || e.message);
    } finally {
      setSigning(null);
    }
  };

  return (
    <OnChainAdminLayout>
      <div className="max-w-7xl mx-auto">
        <div className="flex items-end justify-between mb-8 mt-4">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">Initialize Queue</h1>
            <p className="text-white/70 mt-1">CRO-approved facilities awaiting on-chain deployment.</p>
          </div>
          <button onClick={refresh} className="defa-btn-ghost">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>

        {loading && pending.length === 0 ? (
          <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-white/70" /></div>
        ) : pending.length === 0 ? (
          <div className="defa-card p-16 text-center">
            <Inbox className="w-12 h-12 text-white/40 mx-auto mb-3" />
            <p className="text-lg font-semibold">Queue is empty</p>
            <p className="text-sm text-white/60 mt-1">CRO approvals will appear here for on-chain deployment.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {pending.map((p) => (
              <div key={p._id} className="defa-card defa-card-hover p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="text-xs uppercase tracking-widest text-white/60 mb-1">Awaiting Init</div>
                    <h3 className="text-xl font-bold">{p.companyName}</h3>
                    <code className="text-xs text-white/50 font-mono break-all">{p.solanaWallet}</code>
                  </div>
                  <span className="defa-status-pill">Pending</span>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                  <Stat label="Approved" value={fmtUsd(p.approvedCreditLine || p.approvedAmount)} />
                  <Stat label="Tenor" value={`${p.approvedDuration}d`} />
                  <Stat label="Util / Commit" value={`${p.utilizedBips}/${p.unutilizedBips} bps`} />
                  <Stat label="Penalty" value={`${p.penaltyBips} bps/d`} />
                </div>

                <div className="text-[11px] text-white/50 mb-4">
                  <div className="defa-label mb-1">Future Pool PDA</div>
                  <code className="font-mono break-all text-white/70">{p.assignedPoolAddress}</code>
                </div>

                <button
                  onClick={() => setConfirmProfile(p)}
                  disabled={!wallet.connected || signing === p._id}
                  className="defa-btn-primary w-full justify-center"
                >
                  {signing === p._id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                  Configure & Initialize
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {confirmProfile && (
        <PoolInitConfirmModal
          profile={confirmProfile}
          submitting={!!signing}
          onCancel={() => signing ? null : setConfirmProfile(null)}
          onConfirm={handleConfirmSign}
        />
      )}
    </OnChainAdminLayout>
  );
};

const Stat = ({ label, value }) => (
  <div>
    <div className="defa-label">{label}</div>
    <div className="text-base font-semibold tabular-nums">{value}</div>
  </div>
);

export default InitializeQueue;
