import { useEffect, useState } from 'react';
import {
  ChevronDown, ChevronUp, Loader2, ExternalLink,
  TrendingUp, TrendingDown, AlertCircle, CheckCircle2, Pause, ArrowUpRight, ArrowDownLeft, Zap, ShieldOff,
} from 'lucide-react';
import { api } from '../../services/solana';
import { fmtDayIndex } from '../../utils/dateFmt';

const fmtUsdc = (base) => {
  if (base === undefined || base === null) return '$0';
  const n = Number(BigInt(base) / 1_000_000n);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
};
const fmtBps = (bps) => `${(Number(bps) / 100).toFixed(2)}%/d`;

const StatusPill = ({ pool }) => {
  if (pool.isDefaulted)
    return <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-red-500/10 text-red-300 border border-red-500/30 inline-flex items-center gap-1"><ShieldOff className="w-3 h-3" />Defaulted</span>;
  if (pool.isCancelled)
    return <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-slate-500/10 text-slate-300 border border-slate-500/30 inline-flex items-center gap-1"><Pause className="w-3 h-3" />Cancelled</span>;
  if (pool.isActive)
    return <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 inline-flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Active</span>;
  return <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-500/10 text-indigo-300 border border-indigo-500/30 inline-flex items-center gap-1"><TrendingUp className="w-3 h-3" />Funding</span>;
};

const explorer = (kind, val) => `https://explorer.solana.com/${kind}/${val}?cluster=devnet`;

const PoolRow = ({ pool, myPosition, onDeposit, onRedeem }) => {
  const [expanded, setExpanded] = useState(false);
  const [details, setDetails] = useState(null);
  const [activity, setActivity] = useState(null);
  const [drawdowns, setDrawdowns] = useState(null);
  const [loadingExp, setLoadingExp] = useState(false);

  useEffect(() => {
    if (!expanded || details) return;
    let cancelled = false;
    (async () => {
      setLoadingExp(true);
      try {
        const [stateRes, ddRes, actRes] = await Promise.all([
          api().get(`/pool/pool/${pool.pubkey}/state`),
          api().get(`/pool/pool/${pool.pubkey}/drawdowns`),
          api().get(`/pool/pool/${pool.pubkey}/activity`, { params: { limit: 30 } }).catch(() => ({ data: [] })),
        ]);
        if (cancelled) return;
        setDetails(stateRes.data);
        setDrawdowns(ddRes.data);
        setActivity(actRes.data);
      } finally {
        if (!cancelled) setLoadingExp(false);
      }
    })();
    return () => { cancelled = true; };
  }, [expanded]);

  // Cap progress (raised vs hard cap)
  const totalCapital = BigInt(pool.totalCapital);
  const hardCap = BigInt(pool.hardCap);
  const softCap = BigInt(pool.softCap);
  const pctRaised = hardCap > 0n ? Number((totalCapital * 10000n) / hardCap) / 100 : 0;
  const pctOfSoft = softCap > 0n ? Number((totalCapital * 10000n) / softCap) / 100 : 0;
  const softCapMet = totalCapital >= softCap;

  // Utilization (only meaningful when active)
  const outstanding = BigInt(pool.outstandingPrincipal);
  const utilization = totalCapital > 0n ? Number((outstanding * 10000n) / totalCapital) / 100 : 0;

  const canDeposit = !pool.isActive && !pool.isCancelled && !pool.isDefaulted;
  const canRedeem = !!myPosition && (pool.isActive || pool.isCancelled || pool.isDefaulted);

  return (
    <div className={`rounded-2xl border ${myPosition ? 'border-indigo-500/40 bg-indigo-500/5' : 'border-slate-800 bg-slate-900/40'} overflow-hidden transition-all`}>
      {/* Collapsed header */}
      <button
        onClick={() => setExpanded((x) => !x)}
        className="w-full p-5 flex items-center gap-4 hover:bg-white/5 transition-colors text-left"
      >
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 flex items-center justify-center font-bold text-white">
          {(pool.pspName || 'P').slice(0, 1).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-semibold text-white truncate">{pool.pspName || 'Unnamed PSP'}</span>
            <StatusPill pool={pool} />
            {myPosition && (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-indigo-500/20 text-indigo-200">
                Your stake
              </span>
            )}
          </div>
          <code className="text-xs text-slate-500 font-mono">{pool.pubkey}</code>
        </div>

        <div className="hidden md:flex items-center gap-6 text-right">
          <Stat label="Raised" value={fmtUsdc(pool.totalCapital)} sub={`of ${fmtUsdc(pool.hardCap)} cap`} />
          {myPosition ? (
            <Stat label="Your Position" value={fmtUsdc(myPosition.deposited)}
                  sub={`${myPosition.sharePctNum.toFixed(2)}% of pool`} highlight />
          ) : (
            <Stat label="Util" value={pool.isActive ? `${utilization.toFixed(1)}%` : '—'} sub="of capital" />
          )}
        </div>
        <div className="text-slate-400">
          {expanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </div>
      </button>

      {/* Cap progress bar (always visible) */}
      <div className="px-5 pb-3">
        <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
          <span>{fmtUsdc(pool.totalCapital)} raised</span>
          <span>{pctRaised.toFixed(1)}% of hard cap · {pctOfSoft.toFixed(0)}% of soft</span>
        </div>
        <div className="h-2 bg-slate-800 rounded-full overflow-hidden relative">
          {/* Hard cap fill */}
          <div
            className={`h-full transition-all ${softCapMet ? 'bg-gradient-to-r from-emerald-500 to-emerald-400' : 'bg-gradient-to-r from-indigo-500 to-fuchsia-500'}`}
            style={{ width: `${Math.min(100, pctRaised)}%` }}
          />
          {/* Soft cap marker */}
          {hardCap > 0n && (
            <div
              className="absolute top-0 bottom-0 w-px bg-amber-300/80"
              style={{ left: `${Number((softCap * 10000n) / hardCap) / 100}%` }}
              title={`Soft cap: ${fmtUsdc(softCap)}`}
            />
          )}
        </div>
      </div>

      {/* Action bar */}
      <div className="px-5 pb-4 flex flex-wrap gap-2">
        {canDeposit && (
          <button
            onClick={(e) => { e.stopPropagation(); onDeposit(); }}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-lg flex items-center gap-1.5"
          >
            <ArrowDownLeft className="w-4 h-4" />
            Deposit USDC
          </button>
        )}
        {canRedeem && (
          <button
            onClick={(e) => { e.stopPropagation(); onRedeem(); }}
            className="px-4 py-2 bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-sm font-semibold rounded-lg flex items-center gap-1.5"
          >
            <ArrowUpRight className="w-4 h-4" />
            Redeem LP
          </button>
        )}
        <a
          href={explorer('address', pool.pubkey)}
          target="_blank" rel="noopener noreferrer"
          className="px-4 py-2 border border-slate-700 hover:border-slate-500 text-slate-300 text-sm rounded-lg flex items-center gap-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink className="w-4 h-4" />
          Explorer
        </a>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div className="border-t border-slate-800 bg-slate-950/40 p-5 space-y-6">
          {loadingExp && !details ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-indigo-400" /></div>
          ) : details ? (
            <>
              {/* Your position panel (if any) */}
              {myPosition && (
                <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-4">
                  <h4 className="text-xs uppercase tracking-wide text-indigo-300 font-semibold mb-3">Your Position</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <Mini label="LP Tokens" value={fmtUsdc(myPosition.lpBalance)} />
                    <Mini label="Pool Share" value={`${myPosition.sharePctNum.toFixed(2)}%`} />
                    <Mini label="Deposited" value={fmtUsdc(myPosition.deposited)} />
                    <Mini label="Redeemable Now" value={fmtUsdc(myPosition.redeemable)}
                          accent={BigInt(myPosition.yield) > 0n ? 'text-emerald-300' : 'text-slate-200'} />
                  </div>
                  {BigInt(myPosition.yield) > 0n && (
                    <div className="mt-3 text-xs text-emerald-300 flex items-center gap-1">
                      <TrendingUp className="w-3.5 h-3.5" />
                      Unrealized yield: <strong>{fmtUsdc(myPosition.yield)}</strong>
                    </div>
                  )}
                </div>
              )}

              {/* Pool stats */}
              <div>
                <h4 className="text-xs uppercase tracking-wide text-slate-400 font-semibold mb-3">Pool Stats</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Mini label="Soft Cap" value={fmtUsdc(details.softCap)} />
                  <Mini label="Hard Cap" value={fmtUsdc(details.hardCap)} />
                  <Mini label="Outstanding" value={fmtUsdc(details.outstandingPrincipal)} />
                  <Mini label="Active Loans" value={String(details.countActiveDrawdowns)} />
                  <Mini label="Util Fee Accrued" value={fmtUsdc(details.accruedUtilFee)} />
                  <Mini label="Commit Fee Accrued" value={fmtUsdc(details.accruedCommitFee)} />
                  <Mini label="Penalty Fee Accrued" value={fmtUsdc(details.accruedPenaltyFee)} />
                  <Mini label="Protocol Fees Owed" value={fmtUsdc(details.protocolFeesOwed)} />
                </div>
              </div>

              {/* Fee structure */}
              <div>
                <h4 className="text-xs uppercase tracking-wide text-slate-400 font-semibold mb-3">Fee Structure</h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <Mini label="Utilization rate" value={fmtBps(details.utilizationRateBps)} sub="on drawn principal" />
                  <Mini label="Commitment rate" value={fmtBps(details.commitmentRateBps)} sub="on idle capital" />
                  <Mini label="Penalty rate" value={fmtBps(details.penaltyRateBps)} sub={`after ${details.facilityTenorDays + details.graceDays}d`} />
                  <Mini label="Tenor" value={`${details.facilityTenorDays} days`} />
                  <Mini label="Grace / Penalty" value={`${details.graceDays} / ${details.penaltyDays} days`} />
                  <Mini label="Max Drawdown" value={fmtUsdc(details.maxDrawdownAmount)} />
                </div>
              </div>

              {/* Active drawdowns */}
              {drawdowns && drawdowns.length > 0 && (
                <div>
                  <h4 className="text-xs uppercase tracking-wide text-slate-400 font-semibold mb-3">Active Drawdowns ({drawdowns.length})</h4>
                  <div className="rounded-xl border border-slate-800 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-900/80 text-xs text-slate-400 uppercase">
                        <tr>
                          <th className="text-left px-3 py-2">ID</th>
                          <th className="text-right px-3 py-2">Principal</th>
                          <th className="text-center px-3 py-2">Drawn Day</th>
                          <th className="text-center px-3 py-2">Tenor</th>
                          <th className="text-right px-3 py-2">PDA</th>
                        </tr>
                      </thead>
                      <tbody>
                        {drawdowns.map((d) => (
                          <tr key={d.pubkey} className="border-t border-slate-800/60">
                            <td className="px-3 py-2 text-slate-300">#{d.id}</td>
                            <td className="px-3 py-2 text-right text-white tabular-nums">{fmtUsdc(d.principal)}</td>
                            <td className="px-3 py-2 text-center text-slate-400">{fmtDayIndex(d.drawdownDay)}</td>
                            <td className="px-3 py-2 text-center text-slate-400">{d.tenorDays}d</td>
                            <td className="px-3 py-2 text-right">
                              <a href={explorer('address', d.pubkey)} target="_blank" rel="noopener noreferrer"
                                 className="text-indigo-400 hover:text-indigo-300 font-mono text-xs">
                                {d.pubkey.slice(0, 8)}…
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Activity feed */}
              <div>
                <h4 className="text-xs uppercase tracking-wide text-slate-400 font-semibold mb-3">
                  On-chain Activity
                  {activity && <span className="ml-2 text-slate-500 normal-case font-normal">({activity.length} events)</span>}
                </h4>
                {activity && activity.length > 0 ? (
                  <div className="space-y-2">
                    {activity.map((ev, i) => (
                      <ActivityRow key={i} event={ev} />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-6 text-slate-500 text-sm">No on-chain events recorded yet.</div>
                )}
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
};

const Stat = ({ label, value, sub, highlight }) => (
  <div className="text-right">
    <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
    <div className={`text-base font-bold tabular-nums ${highlight ? 'text-indigo-200' : 'text-white'}`}>{value}</div>
    {sub && <div className="text-[10px] text-slate-500">{sub}</div>}
  </div>
);

const Mini = ({ label, value, sub, accent }) => (
  <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-3">
    <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">{label}</div>
    <div className={`text-base font-semibold tabular-nums ${accent || 'text-white'}`}>{value}</div>
    {sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}
  </div>
);

const EVENT_META = {
  PoolInitialized:       { color: 'text-indigo-300',  bg: 'bg-indigo-500/10',  icon: <Zap className="w-3.5 h-3.5" />, label: 'Pool Initialized' },
  Deposited:             { color: 'text-emerald-300', bg: 'bg-emerald-500/10', icon: <ArrowDownLeft className="w-3.5 h-3.5" />, label: 'Lender Deposit' },
  WithdrawnFunding:      { color: 'text-slate-300',   bg: 'bg-slate-500/10',   icon: <ArrowUpRight className="w-3.5 h-3.5" />, label: 'Lender Withdraw (Funding)' },
  FacilityExecuted:      { color: 'text-emerald-300', bg: 'bg-emerald-500/10', icon: <CheckCircle2 className="w-3.5 h-3.5" />, label: 'Facility Activated' },
  FundingCancelledEvent: { color: 'text-amber-300',   bg: 'bg-amber-500/10',   icon: <Pause className="w-3.5 h-3.5" />, label: 'Funding Cancelled' },
  DrawdownExecuted:      { color: 'text-fuchsia-300', bg: 'bg-fuchsia-500/10', icon: <ArrowUpRight className="w-3.5 h-3.5" />, label: 'PSP Drawdown' },
  RepaymentProcessed:    { color: 'text-emerald-300', bg: 'bg-emerald-500/10', icon: <ArrowDownLeft className="w-3.5 h-3.5" />, label: 'PSP Repayment' },
  CommitFeeSettled:      { color: 'text-blue-300',    bg: 'bg-blue-500/10',    icon: <ArrowDownLeft className="w-3.5 h-3.5" />, label: 'Commit Fee Settled' },
  LpRedeemed:            { color: 'text-fuchsia-300', bg: 'bg-fuchsia-500/10', icon: <ArrowUpRight className="w-3.5 h-3.5" />, label: 'LP Redeemed' },
  ProtocolFeesClaimed:   { color: 'text-blue-300',    bg: 'bg-blue-500/10',    icon: <Zap className="w-3.5 h-3.5" />, label: 'Protocol Fees Claimed' },
  DefaultDeclared:       { color: 'text-red-300',     bg: 'bg-red-500/10',     icon: <AlertCircle className="w-3.5 h-3.5" />, label: 'Default Declared' },
};

const fmtTime = (unix) => {
  if (!unix) return '—';
  const d = new Date(unix * 1000);
  const now = Date.now();
  const ageMs = now - d.getTime();
  if (ageMs < 60_000) return 'just now';
  if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)}m ago`;
  if (ageMs < 86_400_000) return `${Math.floor(ageMs / 3_600_000)}h ago`;
  return `${Math.floor(ageMs / 86_400_000)}d ago`;
};

const ActivityRow = ({ event }) => {
  const meta = EVENT_META[event.name] || { color: 'text-slate-300', bg: 'bg-slate-500/10', icon: null, label: event.name };
  const detail = describeEvent(event);
  return (
    <a
      href={explorer('tx', event.signature)}
      target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-3 p-3 rounded-lg border border-slate-800 hover:border-slate-700 hover:bg-slate-900/60 transition-colors"
    >
      <div className={`p-2 rounded-lg ${meta.bg} ${meta.color}`}>{meta.icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-white">{meta.label}</div>
        {detail && <div className="text-xs text-slate-400 truncate">{detail}</div>}
      </div>
      <div className="text-xs text-slate-500 text-right shrink-0">
        <div>{fmtTime(event.blockTime)}</div>
        <div className="font-mono">{event.signature.slice(0, 6)}…</div>
      </div>
    </a>
  );
};

function describeEvent(ev) {
  const d = ev.data || {};
  const usd = (v) => v ? fmtUsdc(v) : null;
  switch (ev.name) {
    case 'Deposited':          return `${usd(d.amount)} from ${(d.lender || '').slice(0, 6)}…`;
    case 'WithdrawnFunding':   return `${usd(d.amount)} to ${(d.lender || '').slice(0, 6)}…`;
    case 'FacilityExecuted':   return `Activated with ${usd(d.totalCapital)} on ${fmtDayIndex(d.activatedDay)}`;
    case 'DrawdownExecuted':   return `${usd(d.amount)} for ${d.tenorDays}d (drawdown #${d.id})`;
    case 'RepaymentProcessed': return `Principal ${usd(d.principal)} · util ${usd(d.utilFee)} · penalty ${usd(d.penaltyFee)}`;
    case 'CommitFeeSettled':   return `Settled ${usd(d.amount)}`;
    case 'LpRedeemed':         return `${usd(d.usdcPaid)} for ${usd(d.lpBurned)} LP → ${(d.lender || '').slice(0, 6)}…`;
    case 'ProtocolFeesClaimed':return `${usd(d.amount)} to admin`;
    case 'DefaultDeclared':    return `Outstanding ${usd(d.outstanding)} on ${fmtDayIndex(d.day)}`;
    case 'FundingCancelledEvent': return `Capital at cancel: ${usd(d.totalCapitalAtCancel)}`;
    default: return null;
  }
}

export default PoolRow;
