import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Loader2, RefreshCw, Wallet, PiggyBank, ArrowUpRight, Layers, ArrowDownLeft, Coins,
} from 'lucide-react';
import toast from 'react-hot-toast';
import LenderLayout from './Layout';
import { api } from '../../services/solana';

const fmt = (base) => {
  if (base === undefined || base === null) return '$0';
  const big = BigInt(base);
  const usd = Number(big) / 1_000_000;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(usd);
};
const fmtTime = (unix) => {
  if (!unix) return '';
  const ageMs = Date.now() - unix * 1000;
  if (ageMs < 60_000) return 'just now';
  if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)}m ago`;
  if (ageMs < 86_400_000) return `${Math.floor(ageMs / 3_600_000)}h ago`;
  return `${Math.floor(ageMs / 86_400_000)}d ago`;
};

const LenderDashboard = () => {
  const navigate = useNavigate();
  const [portfolio, setPortfolio] = useState(null);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      setLoading(true);
      const { data } = await api().get('/pool/lender/portfolio');
      setPortfolio(data);

      // Pull the most recent activity from each pool the lender is in,
      // merge, sort by time, take top 20.
      const activityArrays = await Promise.all(
        (data.positions || []).map((p) =>
          api().get(`/pool/pool/${p.pool}/activity`, { params: { limit: 10 } })
            .then((r) => r.data.map((ev) => ({ ...ev, poolName: p.pspName, pool: p.pool })))
            .catch(() => [])
        )
      );
      const merged = activityArrays.flat().sort((a, b) => (b.blockTime || 0) - (a.blockTime || 0)).slice(0, 20);
      setActivity(merged);
    } catch (e) {
      toast.error(e.response?.data?.message || e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  return (
    <LenderLayout>
      <div className="max-w-7xl mx-auto">
        <div className="flex items-end justify-between mb-6 mt-4">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">Dashboard</h1>
            <p className="text-white/70 mt-1">Your lending positions and recent on-chain activity.</p>
          </div>
          <button onClick={refresh} className="defa-btn-ghost">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>

        {/* Hero stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Stat
            icon={<Wallet className="w-4 h-4 text-emerald-200" />}
            label="Wallet USDC-DF"
            value={fmt(portfolio?.walletUsdc || '0')}
            sub="Available to deposit"
          />
          <Stat
            icon={<PiggyBank className="w-4 h-4 text-indigo-200" />}
            label="Total Deposited"
            value={fmt(portfolio?.totalDeposited || '0')}
            sub={`${portfolio?.poolsJoined || 0} pool${portfolio?.poolsJoined === 1 ? '' : 's'} joined`}
          />
          <Stat
            icon={<Layers className="w-4 h-4 text-fuchsia-200" />}
            label="Active Positions"
            value={fmt(
              (portfolio?.positions || []).reduce((acc, p) => acc + BigInt(p.lpBalance || '0'), 0n).toString()
            )}
            sub={`${(portfolio?.positions || []).filter((p) => BigInt(p.lpBalance || '0') > 0n).length} LP holding${(portfolio?.positions || []).filter((p) => BigInt(p.lpBalance || '0') > 0n).length === 1 ? '' : 's'}`}
          />
          <Stat
            icon={<Coins className="w-4 h-4 text-amber-200" />}
            label="Earned Yield"
            value={fmt(portfolio?.totalRealizedYield || '0')}
            sub={
              portfolio && BigInt(portfolio.totalRealizedYield || '0') > 0n
                ? 'claimed via redemption'
                : 'Earn from util + commit fees'
            }
          />
        </div>

        {/* Two-column: positions + activity feed */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* My positions */}
          <div className="defa-card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold flex items-center gap-2">
                <Layers className="w-4 h-4" /> My Positions
              </h3>
              <button onClick={() => navigate('/lender/my-investments')} className="text-xs text-white/70 hover:text-white">
                View all →
              </button>
            </div>
            {loading && !portfolio ? (
              <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-white/70" /></div>
            ) : !portfolio?.positions?.length ? (
              <div className="text-center py-8">
                <p className="text-white/60 text-sm mb-3">You haven't deposited into any pool yet.</p>
                <button onClick={() => navigate('/lender/facilities')} className="defa-btn-primary">
                  Browse Facilities
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {portfolio.positions.slice(0, 5).map((p) => (
                  <button
                    key={p.pool}
                    onClick={() => navigate(`/lender/facilities/${p.pool}`)}
                    className="w-full p-3 rounded-lg hover:bg-white/10 transition-colors flex items-center gap-3 text-left"
                  >
                    <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-400 to-fuchsia-400 flex items-center justify-center font-bold text-sm">
                      {(p.pspName || 'P').slice(0, 1).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{p.pspName}</div>
                      <div className="text-xs text-white/60">
                        {p.sharePctNum.toFixed(2)}% share · deposited {fmt(p.deposited)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold">{fmt(p.redeemable)}</div>
                      <div className={`text-[10px] ${BigInt(p.yield) > 0n ? 'text-emerald-300' : 'text-white/50'}`}>
                        {BigInt(p.yield) > 0n ? `+${fmt(p.yield)} yield` : '— yield'}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Recent activity */}
          <div className="defa-card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">Recent Activity</h3>
              <span className="text-xs text-white/60">Across your pools</span>
            </div>
            {loading && activity.length === 0 ? (
              <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-white/70" /></div>
            ) : activity.length === 0 ? (
              <div className="text-center py-8 text-sm text-white/60">No activity yet.</div>
            ) : (
              <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
                {activity.map((ev, i) => <ActivityRow key={i} ev={ev} navigate={navigate} />)}
              </div>
            )}
          </div>
        </div>
      </div>
    </LenderLayout>
  );
};

const Stat = ({ icon, label, value, sub }) => (
  <div className="defa-card p-4">
    <div className="flex items-center justify-between">
      <div className="defa-label">{label}</div>
      {icon}
    </div>
    <div className="text-2xl font-bold tabular-nums mt-1">{value}</div>
    {sub && <div className="text-[11px] text-white/60 mt-1">{sub}</div>}
  </div>
);

const EVENT_LABELS = {
  Deposited: 'Deposit',
  WithdrawnFunding: 'Withdraw',
  FacilityExecuted: 'Facility Activated',
  DrawdownExecuted: 'PSP Drew',
  RepaymentProcessed: 'PSP Repaid',
  CommitFeeSettled: 'Commit Fee Settled',
  LpRedeemed: 'LP Redeemed',
  FundingCancelledEvent: 'Funding Cancelled',
  DefaultDeclared: 'Default Declared',
  ProtocolFeesClaimed: 'Protocol Fees Claimed',
  PoolInitialized: 'Pool Created',
};
const ActivityRow = ({ ev, navigate }) => {
  const d = ev.data || {};
  let detail = '';
  switch (ev.name) {
    case 'Deposited':         detail = fmt(d.amount); break;
    case 'WithdrawnFunding':  detail = fmt(d.amount); break;
    case 'DrawdownExecuted':  detail = `${fmt(d.amount)} for ${d.tenorDays}d`; break;
    case 'RepaymentProcessed':detail = `Principal ${fmt(d.principal)} · yield ${fmt(BigInt(d.utilFee || 0n) + BigInt(d.penaltyFee || 0n))}`; break;
    case 'CommitFeeSettled':  detail = fmt(d.amount); break;
    case 'LpRedeemed':        detail = `${fmt(d.usdcPaid)} for ${fmt(d.lpBurned)} LP`; break;
    case 'FacilityExecuted':  detail = `Activated with ${fmt(d.totalCapital)}`; break;
    default: detail = '';
  }
  return (
    <button
      onClick={() => navigate(`/lender/facilities/${ev.pool}`)}
      className="w-full p-2.5 rounded-lg hover:bg-white/10 transition-colors flex items-center gap-3 text-left"
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{EVENT_LABELS[ev.name] || ev.name}</div>
        <div className="text-xs text-white/60 truncate">
          {ev.poolName} {detail && '· '} {detail}
        </div>
      </div>
      <div className="text-[10px] text-white/50">{fmtTime(ev.blockTime)}</div>
    </button>
  );
};

export default LenderDashboard;
