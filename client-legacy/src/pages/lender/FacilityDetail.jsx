import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  ArrowLeft, RefreshCw, Loader2, ExternalLink,
  ShieldOff, Pause, ArrowUpRight, ArrowDownLeft, BarChart3,
  TrendingUp, Coins, Clock, CheckCircle2, AlertCircle, Zap, FileText, Download,
} from 'lucide-react';
import toast from 'react-hot-toast';
import LenderLayout from './Layout';
import DepositModal from '../../components/lender/DepositModal';
import RedeemModal from '../../components/lender/RedeemModal';
import { api } from '../../services/solana';
import { fmtDayIndex } from '../../utils/dateFmt';
import { isSettledFromPool } from '../../utils/poolStatus';
import ValidationPipeline from '../../components/defa/ValidationPipeline';

const fmt = (base) => {
  if (base === undefined || base === null) return '$0';
  const usd = Number(BigInt(base)) / 1_000_000;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(usd);
};
const fmtBps = (bps) => `${(Number(bps) / 100).toFixed(2)}%/d`;
const fmtBpsRaw = (bps) => `${Number(bps)}bps/d`;
const explorer = (kind, val) => `https://explorer.solana.com/${kind}/${val}?cluster=devnet`;
const todayDayIndex = () => Math.floor(Date.now() / 1000 / 86400);

const FacilityDetail = () => {
  const { pool: poolPubkey } = useParams();
  const navigate = useNavigate();
  const wallet = useWallet();
  const [state, setState] = useState(null);
  const [drawdowns, setDrawdowns] = useState([]);
  const [activity, setActivity] = useState([]);
  const [position, setPosition] = useState(null);
  const [pending, setPending] = useState(null); // util-fee pending etc.
  const [creditMemo, setCreditMemo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showDeposit, setShowDeposit] = useState(false);
  const [showRedeem, setShowRedeem] = useState(false);
  const [drawdownPage, setDrawdownPage] = useState(1);
  const [activityPage, setActivityPage] = useState(1);
  const [expandedDd, setExpandedDd] = useState(null);
  const PAGE_SIZE = 10;

  const refresh = async () => {
    try {
      setLoading(true);
      const [s, d, a, pf, da, cm] = await Promise.all([
        api().get(`/pool/pool/${poolPubkey}/state`),
        api().get(`/pool/pool/${poolPubkey}/drawdowns`, { params: { includeRepaid: true } }),
        api().get(`/pool/pool/${poolPubkey}/activity`, { params: { limit: 200 } }).catch(() => ({ data: [] })),
        api().get('/pool/lender/portfolio').catch(() => ({ data: { positions: [] } })),
        api().get(`/pool/pool/${poolPubkey}/daily-activity`).catch(() => ({ data: null })),
        // Credit memo metadata. 404 = no memo on file (most pools); swallow.
        api().get(`/facility/by-pool/${poolPubkey}/credit-memo`).catch(() => ({ data: null })),
      ]);
      setState(s.data); setDrawdowns(d.data); setActivity(a.data);
      setPosition(pf.data.positions?.find((p) => p.pool === poolPubkey) || null);
      setPending(da.data);
      setCreditMemo(cm.data);
    } catch (e) {
      toast.error(e.response?.data?.message || e.message);
    } finally { setLoading(false); }
  };
  useEffect(() => { refresh(); }, [poolPubkey]);

  useEffect(() => {
    const max = Math.max(1, Math.ceil(drawdowns.length / PAGE_SIZE));
    if (drawdownPage > max) setDrawdownPage(max);
  }, [drawdowns.length]);
  useEffect(() => {
    const max = Math.max(1, Math.ceil(activity.length / PAGE_SIZE));
    if (activityPage > max) setActivityPage(max);
  }, [activity.length]);

  const canDeposit = state && !state.isActive && !state.isCancelled && !state.isDefaulted;
  const canRedeem  = state && position && (state.isActive || state.isCancelled || state.isDefaulted);

  if (loading && !state) {
    return <LenderLayout><div className="flex justify-center pt-32"><Loader2 className="w-8 h-8 animate-spin text-white/70" /></div></LenderLayout>;
  }
  if (!state) {
    return <LenderLayout><div className="defa-card p-12 text-center text-white/70 max-w-3xl mx-auto mt-16">Pool not found.</div></LenderLayout>;
  }

  return (
    <LenderLayout>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between mb-6 mt-4 gap-4">
          <div>
            <button onClick={() => navigate(-1)} className="text-white/70 hover:text-white text-sm inline-flex items-center gap-1 mb-2">
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <h1 className="text-3xl font-bold tracking-tight">Facility #{state.facilityId} · {state.pspName}</h1>
            <a href={explorer('address', poolPubkey)} target="_blank" rel="noopener noreferrer"
               className="text-xs font-mono text-white/60 hover:text-white inline-flex items-center gap-1 mt-1 break-all">
              {poolPubkey} <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {canDeposit && (
              <button onClick={() => setShowDeposit(true)} className="defa-btn-primary">
                <ArrowDownLeft className="w-4 h-4" /> Deposit USDC
              </button>
            )}
            {canRedeem && (
              <button onClick={() => setShowRedeem(true)} className="defa-btn-ghost" style={{ background: 'rgba(217,70,239,0.25)', borderColor: 'rgba(217,70,239,0.5)' }}>
                <ArrowUpRight className="w-4 h-4" /> Redeem LP
              </button>
            )}
            <button onClick={refresh} className="defa-btn-ghost" title="Refresh">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Status banners */}
        {state.isDefaulted && (
          <div className="defa-card p-4 mb-5 flex items-center gap-3" style={{ background: 'rgba(239,68,68,0.15)', borderColor: 'rgba(239,68,68,0.4)' }}>
            <ShieldOff className="w-5 h-5 text-red-200" />
            <div><div className="font-semibold">Defaulted</div><div className="text-xs text-white/70">You can redeem against the vault remainder (haircut).</div></div>
          </div>
        )}
        {isSettledFromPool(state, pending) && (
          <div className="defa-card p-4 mb-5 flex items-center gap-3" style={{ background: 'rgba(34,197,94,0.15)', borderColor: 'rgba(34,197,94,0.4)' }}>
            <CheckCircle2 className="w-5 h-5 text-emerald-200" />
            <div><div className="font-semibold">Settled</div><div className="text-xs text-white/70">All borrower obligations paid — you can redeem your full position.</div></div>
          </div>
        )}
        {state.isCancelled && (
          <div className="defa-card p-4 mb-5 flex items-center gap-3">
            <Pause className="w-5 h-5 text-white/80" />
            <div><div className="font-semibold">Cancelled</div><div className="text-xs text-white/70">Funding round cancelled — you can withdraw your deposit.</div></div>
          </div>
        )}

        {/* Lender-centric headline stats. Replaces the old pool-wide grid
            (Capacity / Outstanding / Util Fee Realized / Unutilized Fee)
            with 4 cards framed from the lender's POV. Pool-wide metrics
            still live in the daily-activity sub-page + drawdowns table. */}
        {(() => {
          const principalIn = BigInt(position?.principalIn || position?.deposited || '0');
          const realized    = BigInt(position?.realizedYield || position?.yield || '0');
          const outstanding = BigInt(position?.outstandingYield || position?.unrealizedYield || '0');
          const totalReturn = realized + outstanding;
          const yieldPct    = principalIn > 0n
            ? (Number(totalReturn) / Number(principalIn)) * 100
            : 0;
          return (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
              <Stat
                label="My Position"
                value={fmt(principalIn)}
                sub={position
                  ? `${position.sharePctNum?.toFixed(2) ?? '0'}% of pool`
                  : 'no deposit yet'}
                icon={<Coins className="w-4 h-4 text-indigo-200" />}
              />
              <Stat
                label="Realized Yield"
                value={fmt(realized)}
                sub={position?.positionStatus === 'closed_loss'
                  ? `loss: ${fmt(position?.realizedLoss || '0')}`
                  : 'claimed via redemption'}
                accent={realized > 0n}
              />
              <Stat
                label="Outstanding"
                value={fmt(outstanding)}
                sub="your share of accruing yield"
                icon={<TrendingUp className="w-4 h-4 text-amber-200" />}
              />
              <Stat
                label="Yield %"
                value={`${yieldPct >= 0 ? '+' : ''}${yieldPct.toFixed(2)}%`}
                sub={`on ${fmt(principalIn)} principal`}
                accent={yieldPct > 0}
              />
            </div>
          );
        })()}

        {/* Terms — lender-relevant only. Max drawdown, penalty rate, and
            grace/penalty days are PSP-side concerns, hidden from this view. */}
        <div className="defa-card p-5 mb-4">
          <h3 className="font-semibold mb-4">Terms</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <Term label="Facility Range" value={`${fmt(state.softCap)} - ${fmt(state.hardCap)}`} />
            <Term label="Tenor" value={`${state.facilityTenorDays} days`} />
            <Term label="Activated" value={state.activatedDay ? fmtDayIndex(state.activatedDay) : '—'} />
            <Term label="Utilization Rate" value={fmtBpsRaw(state.utilizationRateBps)} />
            <Term label="Commitment" value={fmtBpsRaw(state.commitmentRateBps)} />
          </div>
        </div>

        {/* Credit memo (CRO underwriting writeup). Only renders when the
            CRO has uploaded one; silent otherwise so older facilities
            don't show an empty card. */}
        {creditMemo && (
          <a
            href={creditMemo.url}
            target="_blank"
            rel="noopener noreferrer"
            download={creditMemo.fileName}
            className="defa-card defa-card-hover w-full p-4 mb-4 flex items-center gap-3 text-left"
          >
            <div className="p-2 rounded-lg bg-white/15 text-white">
              <FileText className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold">Credit Memo</div>
              <div className="text-xs text-white/60 truncate">
                {creditMemo.fileName}
                {creditMemo.uploadedAt && ` · uploaded ${new Date(creditMemo.uploadedAt).toLocaleDateString()}`}
              </div>
            </div>
            <Download className="w-5 h-5 text-white/60" />
          </a>
        )}

        {/* Daily activity entry */}
        <button
          onClick={() => navigate(`/lender/facilities/${poolPubkey}/daily-activity`)}
          className="defa-card defa-card-hover w-full p-4 mb-6 flex items-center gap-3 text-left"
        >
          <div className="p-2 rounded-lg bg-white/15 text-white">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <div className="font-semibold">Daily Activity & P&L Breakdown</div>
            <div className="text-xs text-white/60">Day-by-day capital, fees, events and yield realized</div>
          </div>
          <ArrowUpRight className="w-5 h-5 text-white/60" />
        </button>

        {/* Drawdowns */}
        <div className="defa-card p-5 mb-6">
          <h3 className="font-semibold mb-3">Drawdowns ({drawdowns.length})</h3>
          {drawdowns.length === 0 ? (
            <div className="text-sm text-white/60 text-center py-4">No drawdowns yet.</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-white/60 text-xs uppercase">
                    <tr>
                      <th className="text-left py-2">ID</th>
                      <th className="text-right py-2">Principal</th>
                      <th className="text-center py-2">Drawn Day</th>
                      <th className="text-center py-2">Tenor</th>
                      <th className="text-center py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drawdowns.slice((drawdownPage - 1) * PAGE_SIZE, drawdownPage * PAGE_SIZE).map((d) => {
                      const cliff = d.drawdownDay + d.tenorDays + state.graceDays + state.penaltyDays;
                      const today = todayDayIndex();
                      const overdue = !d.repaid && today >= cliff;
                      const isExpanded = expandedDd === d.id;
                      return (
                        <>
                          <tr
                            key={d.pubkey}
                            className="border-t border-white/10 cursor-pointer hover:bg-white/5"
                            onClick={() => setExpandedDd(isExpanded ? null : d.id)}
                          >
                            <td className="py-3">#{d.id}</td>
                            <td className="py-3 text-right font-semibold tabular-nums">{fmt(d.principal)}</td>
                            <td className="py-3 text-center text-white/70">{fmtDayIndex(d.drawdownDay)}</td>
                            <td className="py-3 text-center text-white/70">{d.tenorDays}d</td>
                            <td className="py-3 text-center">
                              {d.repaid ? (
                                <span className="defa-status-pill" style={{ background: 'rgba(34,197,94,0.25)', borderColor: 'rgba(34,197,94,0.5)' }}>Repaid</span>
                              ) : overdue ? (
                                <span className="defa-status-pill" style={{ background: 'rgba(239,68,68,0.25)', borderColor: 'rgba(239,68,68,0.5)' }}>Overdue</span>
                              ) : (
                                <span className="defa-status-pill">Open</span>
                              )}
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr key={`${d.pubkey}-pipeline`} className="bg-white/5">
                              <td colSpan={5} className="px-3 py-3">
                                <ValidationPipeline pool={poolPubkey} drawdownId={d.id} />
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pager total={drawdowns.length} page={drawdownPage} pageSize={PAGE_SIZE} onChange={setDrawdownPage} />
            </>
          )}
        </div>


        {/* Activity feed */}
        <div className="defa-card p-5">
          <h3 className="font-semibold mb-3">On-chain Activity ({activity.length})</h3>
          {activity.length === 0 ? (
            <div className="text-sm text-white/60 text-center py-4">No events recorded.</div>
          ) : (
            <>
              <div className="space-y-2">
                {activity.slice((activityPage - 1) * PAGE_SIZE, activityPage * PAGE_SIZE).map((ev, i) => (
                  <ActivityRow key={`${ev.signature}-${i}`} event={ev} />
                ))}
              </div>
              <Pager total={activity.length} page={activityPage} pageSize={PAGE_SIZE} onChange={setActivityPage} />
            </>
          )}
        </div>
      </div>

      {showDeposit && (
        <DepositModal
          pool={{ ...state, pubkey: poolPubkey }}
          onClose={() => setShowDeposit(false)}
          onSuccess={() => { setShowDeposit(false); refresh(); }}
        />
      )}
      {showRedeem && (
        <RedeemModal
          pool={{ ...state, pubkey: poolPubkey }}
          onClose={() => setShowRedeem(false)}
          onSuccess={() => { setShowRedeem(false); refresh(); }}
        />
      )}
    </LenderLayout>
  );
};

const Stat = ({ label, value, sub, icon }) => (
  <div className="defa-card p-4">
    <div className="flex items-center justify-between">
      <div className="defa-label">{label}</div>
      {icon}
    </div>
    <div className="text-2xl font-bold tabular-nums mt-1">{value}</div>
    {sub && <div className="text-[11px] text-white/60 mt-1">{sub}</div>}
  </div>
);

const Mini = ({ label, value, sub, accent }) => (
  <div>
    <div className="defa-label">{label}</div>
    <div className={`text-lg font-bold tabular-nums mt-0.5 ${typeof accent === 'string' ? accent : (accent ? 'text-emerald-200' : '')}`}>
      {value}
    </div>
    {sub && <div className="text-[10px] text-white/55 mt-0.5">{sub}</div>}
  </div>
);

const Pager = ({ total, page, pageSize, onChange }) => {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount <= 1) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex items-center justify-between mt-4 pt-3 border-t border-white/10 text-xs">
      <div className="text-white/60">{from}–{to} of {total}</div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="px-2.5 py-1 rounded-md border border-white/15 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white/10"
        >
          Prev
        </button>
        <span className="text-white/70 tabular-nums">Page {page} / {pageCount}</span>
        <button
          onClick={() => onChange(Math.min(pageCount, page + 1))}
          disabled={page >= pageCount}
          className="px-2.5 py-1 rounded-md border border-white/15 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white/10"
        >
          Next
        </button>
      </div>
    </div>
  );
};

const Term = ({ label, value }) => (
  <div>
    <div className="defa-label mb-1">{label}</div>
    <div className="text-sm font-semibold">{value}</div>
  </div>
);

const EVENT_LABELS = {
  PoolInitialized: 'Pool Initialized',
  Deposited: 'Lender Deposit',
  WithdrawnFunding: 'Lender Withdraw',
  FacilityExecuted: 'Facility Activated',
  FundingCancelledEvent: 'Funding Cancelled',
  DrawdownExecuted: 'PSP Drawdown',
  RepaymentProcessed: 'PSP Repayment',
  CommitFeeSettled: 'Commit Fee Settled',
  LpRedeemed: 'LP Redeemed',
  ProtocolFeesClaimed: 'Protocol Fees Claimed',
  DefaultDeclared: 'Default Declared',
};
const fmtTime = (unix) => {
  if (!unix) return '—';
  const ageMs = Date.now() - unix * 1000;
  if (ageMs < 60_000) return 'just now';
  if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)}m ago`;
  if (ageMs < 86_400_000) return `${Math.floor(ageMs / 3_600_000)}h ago`;
  return `${Math.floor(ageMs / 86_400_000)}d ago`;
};
const ActivityRow = ({ event }) => {
  const d = event.data || {};
  const usd = (v) => v ? fmt(v) : '—';
  let detail = '';
  switch (event.name) {
    case 'Deposited':           detail = `${usd(d.amount)} from ${(d.lender || '').slice(0, 6)}…`; break;
    case 'WithdrawnFunding':    detail = `${usd(d.amount)} to ${(d.lender || '').slice(0, 6)}…`; break;
    case 'FacilityExecuted':    detail = `Activated with ${usd(d.totalCapital)} on ${fmtDayIndex(d.activatedDay)}`; break;
    case 'DrawdownExecuted':    detail = `${usd(d.amount)} for ${d.tenorDays}d (#${d.id})`; break;
    case 'RepaymentProcessed':  detail = `Principal ${usd(d.principal)} · util ${usd(d.utilFee)} · penalty ${usd(d.penaltyFee)}`; break;
    case 'CommitFeeSettled':    detail = `${usd(d.amount)} settled`; break;
    case 'LpRedeemed':          detail = `${usd(d.usdcPaid)} for ${usd(d.lpBurned)} LP`; break;
    case 'ProtocolFeesClaimed': detail = `${usd(d.amount)} to admin`; break;
    case 'DefaultDeclared':     detail = `Outstanding ${usd(d.outstanding)}`; break;
    case 'FundingCancelledEvent': detail = `Capital at cancel: ${usd(d.totalCapitalAtCancel)}`; break;
    default: detail = '';
  }
  return (
    <a
      href={explorer('tx', event.signature)}
      target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-3 p-3 rounded-lg hover:bg-white/10 transition-colors"
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{EVENT_LABELS[event.name] || event.name}</div>
        {detail && <div className="text-xs text-white/60 truncate">{detail}</div>}
      </div>
      <div className="text-xs text-white/50 text-right shrink-0">
        <div>{fmtTime(event.blockTime)}</div>
        <div className="font-mono">{event.signature.slice(0, 6)}…</div>
      </div>
    </a>
  );
};

export default FacilityDetail;
