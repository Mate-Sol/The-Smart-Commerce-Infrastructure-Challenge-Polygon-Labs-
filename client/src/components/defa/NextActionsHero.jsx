import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { Loader2, AlertTriangle, Clock, Zap, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { api, buildSignRelay } from '../../services/solana';

/**
 * Next-Actions hero for the PSP borrower section. Surfaces every
 * decision the PSP needs to make right now:
 *
 *   - Drawdowns approved off-chain & ready to sign on-chain
 *   - Drawdowns approaching cliff (≤ 3 days)
 *   - Drawdowns past cliff (overdue — block facility from new draws)
 *   - Pools where commit fee needs settling for lenders to redeem
 *
 * Each surface has a one-click action: build-tx + wallet sign + relay
 * submit. After success, calls `onChange` so the parent refreshes.
 */
const fmt = (base) => {
  if (base === undefined || base === null) return '$0';
  const usd = Number(BigInt(base)) / 1_000_000;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(usd);
};
const fmtUsd = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(n) || 0);

const NextActionsHero = ({ onChange, pool }) => {
  const wallet = useWallet();
  const navigate = useNavigate();
  const [rawData, setRawData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState(null);

  const refresh = async () => {
    try {
      setLoading(true);
      const { data } = await api().get('/pool/psp/next-actions');
      setRawData(data);
    } catch (e) {
      toast.error(e.response?.data?.message || e.message);
    } finally { setLoading(false); }
  };
  useEffect(() => { refresh(); }, []);

  // When this hero is rendered on a single-facility page (`pool` prop set),
  // filter every action bucket to that pool's pubkey so we don't surface
  // unrelated facilities. Each bucket entry has a `pool` field on it from
  // the /psp/next-actions endpoint shape. Awaiting-drawdown rows likewise.
  const data = pool && rawData
    ? {
        awaitingDrawdowns:    (rawData.awaitingDrawdowns    || []).filter((r) => r.pool === pool),
        drawdownsDueSoon:     (rawData.drawdownsDueSoon     || []).filter((r) => r.pool === pool),
        drawdownsOverdue:     (rawData.drawdownsOverdue     || []).filter((r) => r.pool === pool),
        commitFeeSettleNeeded:(rawData.commitFeeSettleNeeded|| []).filter((r) => r.pool === pool),
      }
    : rawData;

  const runRelay = async (key, endpoint, body, postSubmit) => {
    if (!wallet.connected) { toast.error('Connect your PSP wallet first'); return; }
    setBusyKey(key);
    try {
      const r = await buildSignRelay(wallet, endpoint, body);
      toast.success(`Done: ${r.signature.slice(0, 8)}…`);
      // Optional follow-up call (e.g. confirm-disbursed for drawdowns).
      // Failure here is non-fatal — the on-chain tx already landed.
      if (postSubmit) {
        try { await postSubmit(r); }
        catch (err) {
          toast.error(`On-chain succeeded but follow-up failed: ${err.response?.data?.message || err.message}`);
        }
      }
      await refresh();
      onChange?.();
    } catch (e) {
      toast.error(e.response?.data?.message || e.message);
    } finally { setBusyKey(null); }
  };

  if (loading && !data) {
    return (
      <div className="defa-card p-6 mb-6 flex items-center gap-2 text-white/70">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading next actions…
      </div>
    );
  }
  if (!data) return null;

  const total =
    (data.awaitingDrawdowns?.length || 0) +
    (data.drawdownsOverdue?.length || 0) +
    (data.drawdownsDueSoon?.length || 0) +
    (data.commitFeeSettleNeeded?.length || 0);

  if (total === 0) {
    return (
      <div className="defa-card p-6 mb-6 flex items-center gap-3">
        <CheckCircle2 className="w-6 h-6 text-emerald-300" />
        <div>
          <div className="font-semibold">All clear</div>
          <div className="text-sm text-white/60">
            {pool ? 'No pending actions on this facility.' : 'No pending actions across your facilities right now.'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="defa-card p-6 mb-6" style={{ background: 'rgba(99,102,241,0.18)', borderColor: 'rgba(165,180,252,0.4)' }}>
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-white/15"><Zap className="w-5 h-5" /></div>
        <div>
          <h3 className="text-lg font-bold">Next Actions</h3>
          <p className="text-xs text-white/70">{total} item{total === 1 ? '' : 's'} need your attention</p>
        </div>
      </div>

      <div className="space-y-3">
        {/* Overdue first — most urgent */}
        {data.drawdownsOverdue?.map((d) => (
          <ActionRow
            key={'ov-' + d.drawdown}
            tone="red"
            icon={<AlertTriangle className="w-4 h-4" />}
            label={`Overdue · ${fmt(d.principal)} on Drawdown #${d.drawdownId}`}
            sub={`${Math.abs(d.daysToCliff)} day(s) past cliff. New drawdowns blocked until repaid.`}
            actionLabel="Sign Repayment"
            busy={busyKey === 'repay-' + d.drawdown}
            onClick={() => runRelay('repay-' + d.drawdown, '/pool/psp/build-tx/repay', { drawdownId: Number(d.drawdownId), pool: d.pool })}
            onView={() => navigate(`/psp/borrow/facilities/${d.pool}/drawdowns/${d.drawdownId}`)}
          />
        ))}

        {/* Awaiting drawdown signatures */}
        {data.awaitingDrawdowns?.map((r) => (
          <ActionRow
            key={'aw-' + r.id}
            tone="indigo"
            icon={<Zap className="w-4 h-4" />}
            label={`Drawdown ready · ${fmtUsd(r.amount)} for order ${r.orderReference}`}
            sub={`Approved off-chain. Sign to draw down on-chain (${r.tenorDays}d tenor).`}
            actionLabel="Sign Drawdown"
            busy={busyKey === 'draw-' + r.id}
            onClick={() => runRelay(
              'draw-' + r.id,
              '/pool/psp/build-tx/drawdown',
              {
                // FinancingRequest.amount is USD; on-chain program (and the
                // build-tx endpoint) expects USDC base units (6 decimals).
                amount: BigInt(Math.round(Number(r.amount) * 1_000_000)).toString(),
                tenorDays: r.tenorDays,
                pool: r.pool,
              },
              // After the on-chain tx confirms, flip the off-chain
              // FinancingRequest off `AwaitingDrawdown` so it disappears
              // from this Next Actions list.
              (relayResult) => api().post(`/pool/psp/financing/${r.id}/mark-disbursed`, {
                drawdownId: relayResult.built?.drawdownId,
                signature:  relayResult.signature,
                poolPda:    r.pool,
              }),
            )}
          />
        ))}

        {/* Due-soon (≤ 3 days to cliff) */}
        {data.drawdownsDueSoon?.map((d) => (
          <ActionRow
            key={'ds-' + d.drawdown}
            tone="amber"
            icon={<Clock className="w-4 h-4" />}
            label={`Due soon · ${fmt(d.principal)} on Drawdown #${d.drawdownId}`}
            sub={`${d.daysToCliff} day(s) to cliff. Plan repayment.`}
            actionLabel="Sign Repayment"
            busy={busyKey === 'repay-' + d.drawdown}
            onClick={() => runRelay('repay-' + d.drawdown, '/pool/psp/build-tx/repay', { drawdownId: Number(d.drawdownId), pool: d.pool })}
            onView={() => navigate(`/psp/borrow/facilities/${d.pool}/drawdowns/${d.drawdownId}`)}
          />
        ))}

        {/* Commit-fee settle needed */}
        {data.commitFeeSettleNeeded?.map((c) => (
          <ActionRow
            key={'cs-' + c.pool}
            tone="blue"
            icon={<Clock className="w-4 h-4" />}
            label={`Settle commit fee · ${fmt(c.accruedCommitFee)} on facility #${c.facilityId}`}
            sub="Tenor expired. Lenders can't redeem until commit fee is settled."
            actionLabel="Sign Settle"
            busy={busyKey === 'settle-' + c.pool}
            onClick={() => runRelay('settle-' + c.pool, '/pool/psp/build-tx/settle-commit-fee', { pool: c.pool })}
          />
        ))}
      </div>
    </div>
  );
};

const TONE_STYLES = {
  red:    { bg: 'rgba(239,68,68,0.20)',  border: 'rgba(252,165,165,0.5)', icon: 'text-red-200' },
  amber:  { bg: 'rgba(251,191,36,0.20)', border: 'rgba(253,224,71,0.5)',  icon: 'text-amber-200' },
  blue:   { bg: 'rgba(59,130,246,0.20)', border: 'rgba(147,197,253,0.5)', icon: 'text-blue-200' },
  indigo: { bg: 'rgba(99,102,241,0.25)', border: 'rgba(165,180,252,0.5)', icon: 'text-indigo-100' },
};

const ActionRow = ({ tone, icon, label, sub, actionLabel, onClick, onView, busy }) => {
  const t = TONE_STYLES[tone] || TONE_STYLES.indigo;
  return (
    <div className="rounded-xl p-4 flex items-center gap-3 border"
         style={{ background: t.bg, borderColor: t.border }}>
      <div className={`p-2 rounded-lg bg-white/15 ${t.icon}`}>{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm">{label}</div>
        <div className="text-xs text-white/70">{sub}</div>
      </div>
      <div className="flex items-center gap-2">
        {onView && (
          <button onClick={onView} className="defa-btn-ghost text-xs">View</button>
        )}
        <button onClick={onClick} disabled={busy} className="defa-btn-primary text-xs">
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
          {actionLabel}
        </button>
      </div>
    </div>
  );
};

export default NextActionsHero;
