import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import {
  Loader2, RefreshCw, TrendingUp, Wallet, Layers, PiggyBank, ArrowUpRight,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../services/solana';
import DepositModal from '../../components/lender/DepositModal';
import RedeemModal from '../../components/lender/RedeemModal';
import PoolRow from '../../components/lender/PoolRow';

const fmtUsdc = (base) => {
  if (base === undefined || base === null) return '$0';
  const n = Number(BigInt(base) / 1_000_000n);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
};

const LenderPools = () => {
  const wallet = useWallet();
  const navigate = useNavigate();
  const [pools, setPools] = useState([]);
  const [portfolio, setPortfolio] = useState(null);
  const [loading, setLoading] = useState(true);
  const [stateFilter, setStateFilter] = useState('all');
  const [depositPool, setDepositPool] = useState(null);
  const [redeemPool, setRedeemPool] = useState(null);

  const refresh = async () => {
    try {
      setLoading(true);
      const [poolsRes, portfolioRes] = await Promise.all([
        api().get('/pool/pools', { params: { state: stateFilter } }),
        api().get('/pool/lender/portfolio').catch(() => ({ data: null })),
      ]);
      setPools(poolsRes.data);
      setPortfolio(portfolioRes.data);
    } catch (e) {
      toast.error(e.response?.data?.message || e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const hasToken = !!(sessionStorage.getItem('token') || localStorage.getItem('token'));
    if (!hasToken) { navigate('/lender/login'); return; }
    refresh();
  }, [stateFilter]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('lender');
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('user');
    wallet.disconnect();
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-slate-100">
      {/* Top bar */}
      <header className="border-b border-slate-800/50 backdrop-blur sticky top-0 z-30 bg-slate-950/70">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="https://cdn.prod.website-files.com/68f87cc37a7594fc8a44e89b/693054518ad883eb5a10324c_defa_updated_logo.svg"
              alt="DeFa"
              className="h-8 w-auto"
              draggable={false}
            />
            <div className="text-[10px] uppercase tracking-widest text-slate-400 leading-none">
              Lender · Devnet · {wallet.publicKey ? wallet.publicKey.toBase58().slice(0, 6) + '…' + wallet.publicKey.toBase58().slice(-4) : 'not connected'}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={refresh} className="p-2 text-slate-400 hover:text-white" title="Refresh">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <WalletMultiButton />
            <button onClick={handleLogout} className="text-xs text-slate-500 hover:text-slate-300">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* Portfolio hero */}
        <section>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <StatCard
              icon={<Wallet className="w-5 h-5" />}
              label="Wallet USDC-DF"
              value={fmtUsdc(portfolio?.walletUsdc || '0')}
              hint="Available to deposit"
              accent="from-emerald-500/20 to-emerald-500/0"
              border="border-emerald-500/20"
            />
            <StatCard
              icon={<PiggyBank className="w-5 h-5" />}
              label="Total Deposited"
              value={fmtUsdc(portfolio?.totalDeposited || '0')}
              hint={`${portfolio?.poolsJoined || 0} pool${portfolio?.poolsJoined === 1 ? '' : 's'} joined`}
              accent="from-indigo-500/20 to-indigo-500/0"
              border="border-indigo-500/20"
            />
            <StatCard
              icon={<TrendingUp className="w-5 h-5" />}
              label="Redeemable Now"
              value={fmtUsdc(portfolio?.totalRedeemable || '0')}
              hint="Pro-rata vault share"
              accent="from-fuchsia-500/20 to-fuchsia-500/0"
              border="border-fuchsia-500/20"
            />
            <StatCard
              icon={<ArrowUpRight className="w-5 h-5" />}
              label="Yield (Unrealized)"
              value={fmtUsdc(portfolio?.totalYield || '0')}
              hint={
                portfolio && BigInt(portfolio.totalDeposited || '0') > 0n
                  ? `${(Number(portfolio.totalYield) / Number(portfolio.totalDeposited) * 100).toFixed(2)}% on capital`
                  : 'Earn from utilization + commit fees'
              }
              accent="from-amber-500/20 to-amber-500/0"
              border="border-amber-500/20"
            />
          </div>
        </section>

        {/* Pool list header */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-2xl font-bold text-white">Pools</h2>
              <p className="text-sm text-slate-400">Click a pool to expand details, drawdowns, and on-chain activity.</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-1 flex gap-1 text-xs">
                {[
                  { id: 'all', label: 'All' },
                  { id: 'funding', label: 'Funding' },
                  { id: 'active', label: 'Active' },
                  { id: 'cancelled', label: 'Cancelled' },
                  { id: 'defaulted', label: 'Defaulted' },
                ].map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setStateFilter(f.id)}
                    className={`px-3 py-1.5 rounded-md transition-colors ${
                      stateFilter === f.id
                        ? 'bg-indigo-600 text-white shadow'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {loading && pools.length === 0 ? (
            <div className="flex justify-center py-16">
              <Loader2 className="w-7 h-7 animate-spin text-indigo-400" />
            </div>
          ) : pools.length === 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-16 text-center text-slate-400">
              <Layers className="w-10 h-10 text-slate-700 mx-auto mb-3" />
              <p className="font-medium text-slate-300">No pools yet</p>
              <p className="text-sm mt-1">Once an admin initializes a facility for a PSP it'll appear here.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pools.map((pool) => {
                const myPosition = portfolio?.positions?.find((p) => p.pool === pool.pubkey);
                return (
                  <PoolRow
                    key={pool.pubkey}
                    pool={pool}
                    myPosition={myPosition}
                    onDeposit={() => setDepositPool(pool)}
                    onRedeem={() => setRedeemPool(pool)}
                  />
                );
              })}
            </div>
          )}
        </section>
      </main>

      {depositPool && (
        <DepositModal
          pool={depositPool}
          onClose={() => setDepositPool(null)}
          onSuccess={() => { setDepositPool(null); refresh(); }}
        />
      )}
      {redeemPool && (
        <RedeemModal
          pool={redeemPool}
          onClose={() => setRedeemPool(null)}
          onSuccess={() => { setRedeemPool(null); refresh(); }}
        />
      )}
    </div>
  );
};

const StatCard = ({ icon, label, value, hint, accent, border }) => (
  <div className={`relative overflow-hidden rounded-2xl border ${border} bg-slate-900/60 backdrop-blur p-5`}>
    <div className={`absolute inset-0 bg-gradient-to-br ${accent} pointer-events-none`} />
    <div className="relative">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs uppercase tracking-wider text-slate-400 font-medium">{label}</span>
        <div className="p-1.5 rounded-md bg-white/5 text-slate-300">{icon}</div>
      </div>
      <div className="text-3xl font-bold text-white mb-1 tabular-nums">{value}</div>
      <div className="text-xs text-slate-400">{hint}</div>
    </div>
  </div>
);

export default LenderPools;
