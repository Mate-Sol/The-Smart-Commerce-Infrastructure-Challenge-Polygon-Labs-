import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, RefreshCw, Layers } from 'lucide-react';
import toast from 'react-hot-toast';
import LenderLayout from './Layout';
import FacilityCard from '../../components/defa/FacilityCard';
import { api } from '../../services/solana';

const STATE_FILTERS = [
  { id: 'all',       label: 'All' },
  { id: 'funding',   label: 'Funding' },
  { id: 'active',    label: 'Active' },
  { id: 'cancelled', label: 'Cancelled' },
  { id: 'defaulted', label: 'Defaulted' },
];

const Facilities = () => {
  const navigate = useNavigate();
  const [pools, setPools] = useState([]);
  const [portfolio, setPortfolio] = useState(null);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      setLoading(true);
      const [pRes, pfRes] = await Promise.all([
        api().get('/pool/pools', { params: { state: filter } }),
        api().get('/pool/lender/portfolio').catch(() => ({ data: { positions: [] } })),
      ]);
      setPools(pRes.data);
      setPortfolio(pfRes.data);
    } catch (e) {
      toast.error(e.response?.data?.message || e.message);
    } finally { setLoading(false); }
  };

  useEffect(() => { refresh(); }, [filter]);

  const positionMap = useMemo(() => {
    const m = new Map();
    for (const p of portfolio?.positions || []) m.set(p.pool, p);
    return m;
  }, [portfolio]);

  return (
    <LenderLayout>
      <div className="max-w-7xl mx-auto">
        <div className="flex items-end justify-between mb-6 mt-4">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">All Facilities</h1>
            <p className="text-white/70 mt-1">Browse open and historical credit facilities. Click to deposit or view details.</p>
          </div>
          <button onClick={refresh} className="defa-btn-ghost">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>

        <div className="flex flex-wrap gap-2 mb-8">
          {STATE_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`defa-pill ${filter === f.id ? 'defa-pill-active' : ''}`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading && pools.length === 0 ? (
          <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-white/70" /></div>
        ) : pools.length === 0 ? (
          <div className="defa-card p-16 text-center">
            <Layers className="w-12 h-12 text-white/40 mx-auto mb-3" />
            <p className="text-lg font-semibold">No facilities</p>
            <p className="text-sm text-white/60 mt-1">Once an admin initializes a pool it'll appear here.</p>
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

export default Facilities;
