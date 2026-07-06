import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Loader2, Zap } from 'lucide-react';
import toast from 'react-hot-toast';
import { api, buildSignRelay } from '../../services/solana';

/**
 * PSP-side build-sign-relay action button. Three flavours, one component:
 *
 *   <PspSignAction kind="drawdown" financing={fr} amount={fr.amount} tenorDays={fr.drawdownTenor || 5} onSuccess={refresh} />
 *   <PspSignAction kind="repay"    financing={fr} drawdownId={fr.drawdownId} onSuccess={refresh} />
 *   <PspSignAction kind="settle"   onSuccess={refresh} />
 *
 * The amount/drawdownId props are passed through to the corresponding
 * /pool/psp/build-tx/* endpoint. The wallet must be connected (uses the
 * adapter's `useWallet`) and bound to the PSP profile (server enforces).
 */
const KIND_CONFIG = {
  drawdown: {
    label: 'Sign Drawdown',
    endpoint: '/pool/psp/build-tx/drawdown',
    bodyFromProps: ({ amount, tenorDays }) => ({
      amount: BigInt(Math.round(Number(amount) * 1_000_000)).toString(),
      tenorDays: Number(tenorDays),
    }),
    successText: 'Drawdown executed',
  },
  repay: {
    label: 'Sign Repayment',
    endpoint: '/pool/psp/build-tx/repay',
    bodyFromProps: ({ drawdownId }) => ({ drawdownId: Number(drawdownId) }),
    successText: 'Repaid',
  },
  settle: {
    label: 'Settle Commit Fee',
    endpoint: '/pool/psp/build-tx/settle-commit-fee',
    bodyFromProps: () => ({}),
    successText: 'Commit fee settled',
  },
};

const PspSignAction = ({
  kind,
  amount,
  tenorDays,
  drawdownId,
  financingId,   // optional — required for kind="drawdown" to flip the
                 // off-chain FinancingRequest status away from AwaitingDrawdown
  pool,          // optional — required for kind="drawdown" confirm step
  className = '',
  onSuccess,
}) => {
  const wallet = useWallet();
  const [submitting, setSubmitting] = useState(false);
  const config = KIND_CONFIG[kind];
  if (!config) throw new Error(`Unknown PspSignAction kind: ${kind}`);

  const handleClick = async () => {
    if (!wallet.connected) {
      toast.error('Connect your PSP wallet first');
      return;
    }
    setSubmitting(true);
    try {
      const body = config.bodyFromProps({ amount, tenorDays, drawdownId });
      // Drawdown build-tx requires a `pool` body param — pass it through
      // when callers supplied one (NextActionsHero does, ActiveFinancing-
      // Table does NOT because the server resolves the PSP's facility from
      // ownership instead).
      if (kind === 'drawdown' && pool) body.pool = pool;
      const result = await buildSignRelay(wallet, config.endpoint, body);
      toast.success(`${config.successText}: ${result.signature.slice(0, 8)}…`);

      // Drawdown post-confirm: tell the server the on-chain tx landed so
      // it transitions the FinancingRequest off `AwaitingDrawdown`. The
      // build-tx response carries the authoritative drawdownId; the relay
      // returns the signature.
      if (kind === 'drawdown' && financingId) {
        try {
          await api().post(`/pool/psp/financing/${financingId}/mark-disbursed`, {
            drawdownId: result.built?.drawdownId,
            signature:  result.signature,
            poolPda:    result.built?.pool || pool,
          });
        } catch (confirmErr) {
          // Non-fatal — the chain is the source of truth and a worker
          // can backfill — but surface it so the PSP knows to refresh.
          toast.error(`On-chain succeeded but status update failed: ${confirmErr.response?.data?.message || confirmErr.message}`);
        }
      }

      onSuccess?.(result);
    } catch (e) {
      toast.error(e.response?.data?.message || e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={submitting || !wallet.connected}
      className={`inline-flex items-center justify-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-md transition-colors ${className}`}
    >
      {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
      {config.label}
    </button>
  );
};

export default PspSignAction;
