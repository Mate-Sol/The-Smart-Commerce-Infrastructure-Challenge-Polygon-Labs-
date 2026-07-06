import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, RefreshCw, Inbox } from 'lucide-react';
import toast from 'react-hot-toast';
import LenderLayout from './Layout';
import FacilityCard from '../../components/defa/FacilityCard';
import { api } from '../../services/solana';

const fmt = (base) => {
  if (base === undefined || base === null) return '$0';
  const usd = Number(BigInt(base)) / 1_000_000;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(usd);
};

const MyInvestments = () => {
  const navigate = useNavigate();
  const [portfolio, setPortfolio] = useState(null);
  const [pools, setPools] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      setLoading(true);
      const portfolioRes = await api().get('/pool/lender/portfolio');
      setPortfolio(portfolioRes.data);

      // For each position, fetch the latest pool state to render with the
      // shared FacilityCard (which expects the full pool shape).
      const poolList = await Promise.all(
        (portfolioRes.data.positions || []).map((p) =>
          Promise.all([
            api().get(`/pool/pool/${p.pool}/state`),
            // Lifetime aggregates (includes settled commit fees the
            // pool account doesn't accumulate) so Total Yield Paid is
            // borrower-paid in full.
            api().get(`/pool/pool/${p.pool}/fee-aggregates`).catch(() => ({ data: null })),
          ]).then(([r, ag]) => ({
            pubkey: p.pool,
            pspName: p.pspName,
            facilityId: p.facilityId,
            isActive: r.data.isActive,
            isCancelled: r.data.isCancelled,
            isDefaulted: r.data.isDefaulted,
            softCap: r.data.softCap,
            hardCap: r.data.hardCap,
            totalCapital: r.data.totalCapital,
            outstandingPrincipal: r.data.outstandingPrincipal,
            facilityTenorDays: r.data.facilityTenorDays,
            countActiveDrawdowns: r.data.countActiveDrawdowns,
            accruedUtilFee:    r.data.accruedUtilFee,
            accruedPenaltyFee: r.data.accruedPenaltyFee,
            accruedCommitFee:  r.data.accruedCommitFee,
            protocolFeesOwed:  r.data.protocolFeesOwed,
            nextDrawdownId:    r.data.nextDrawdownId,
            earnedYieldGross:        ag.data?.earnedYieldGross,
            settledCommitLifetime:   ag.data?.settledCommitLifetime,
          }))
        )
      );
      setPools(poolList);
    } catch (e) {
      toast.error(e.response?.data?.message || e.message);
    } finally { setLoading(false); }
  };

  useEffect(() => { refresh(); }, []);

  const positionMap = new Map((portfolio?.positions || []).map((p) => [p.pool, p]));

  return (
    <LenderLayout>
      <div className="max-w-7xl mx-auto">
        <div className="flex items-end justify-between mb-6 mt-4">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">My Investments</h1>
            <p className="text-white/70 mt-1">Pools where you currently hold LP tokens.</p>
          </div>
          <button onClick={refresh} className="defa-btn-ghost">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>

        {/* Portfolio summary */}
        {portfolio && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <Stat label="Pools Joined" value={String(portfolio.poolsJoined)} />
            <Stat label="Total Deposited" value={fmt(portfolio.totalDeposited)} />
            <Stat label="Redeemable Now" value={fmt(portfolio.totalRedeemable)} accent />
            <Stat
              label="Total Yield"
              value={fmt(portfolio.totalYield)}
              accent={BigInt(portfolio.totalYield || '0') > 0n}
              sub={
                BigInt(portfolio.totalRealizedYield || '0') > 0n || BigInt(portfolio.totalUnrealizedYield || '0') > 0n
                  ? `realized ${fmt(portfolio.totalRealizedYield || '0')} · unrealized ${fmt(portfolio.totalUnrealizedYield || '0')}`
                  : null
              }
            />
          </div>
        )}

        {loading && pools.length === 0 ? (
          <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-white/70" /></div>
        ) : pools.length === 0 ? (
          <div className="defa-card p-16 text-center">
            <Inbox className="w-12 h-12 text-white/40 mx-auto mb-3" />
            <p className="text-lg font-semibold">No active investments</p>
            <p className="text-sm text-white/60 mt-1 mb-4">Deposit into a Funding-state facility to start earning.</p>
            <button onClick={() => navigate('/lender/facilities')} className="defa-btn-primary">
              Browse Facilities
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {pools.map((pool) => (
              <FacilityCard
                key={pool.pubkey}
                pool={pool}
                position={positionMap.get(pool.pubkey)}
                onOpen={() => navigate(`/lender/facilities/${pool.pubkey}`)}
              />
            ))}
          </div>
        )}
      </div>
    </LenderLayout>
  );
};

const Stat = ({ label, value, sub, accent }) => (
  <div className="defa-card p-4">
    <div className="defa-label">{label}</div>
    <div className={`text-2xl font-bold tabular-nums mt-1 ${accent ? 'text-emerald-200' : ''}`}>{value}</div>
    {sub && <div className="text-[11px] text-white/60 mt-1">{sub}</div>}
  </div>
);

export default MyInvestments;
