/**
 * Lender dashboard — Chunk D2 wire-up.
 *
 * Replaces the mock BASE_WALLET_CARDS / WALLET_CARD_OPTIONS with real
 * data pulled from GET /lender/portfolio + wallet-side USDC balance
 * (via useWalletConnect). The "add card" affordance stays as a stub
 * because the underlying concept (extra chain cards) doesn't apply to
 * a single-chain deployment.
 *
 * KPI cards rendered:
 *   · Wallet Balance      USDC in the connected wallet
 *   · Total Deposited     sum of open-position principal
 *   · Realized Yield      cumulative claimedYield across pools
 */

import React, { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { toast } from "react-toastify";

import WalletCard from "../components/ui/WalletCard";
import LoanPage from "./LoanPage";
import { useWalletConnect } from "../hooks/useWalletConnect";
import { api } from "../../services/evm";
import { usdcFromBase } from "../libs/poolAdapter";

const fmt = (n) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

const DashboardPage = () => {
  const { isConnected } = useAccount();
  const { usdcBalance } = useWalletConnect();

  const [portfolio, setPortfolio] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!isConnected) { setPortfolio(null); return; }
      try {
        setLoading(true);
        const { data } = await api().get("/lender/portfolio");
        if (!cancelled) setPortfolio(data);
      } catch (err) {
        if (err?.response?.status === 401) return; // silent — user needs to sign in
        toast.error(err?.response?.data?.message || err?.message || "Portfolio load failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [isConnected]);

  // Aggregate open-position stats from the portfolio positions[] payload
  const positions = portfolio?.positions || [];
  const totalPrincipal   = positions.reduce((acc, p) => acc + usdcFromBase(p.principal), 0);
  const totalRealizedYld = positions.reduce((acc, p) => acc + usdcFromBase(p.claimedYield), 0);
  const totalRealizedPri = positions.reduce((acc, p) => acc + usdcFromBase(p.claimedPrincipal), 0);

  const walletCards = [
    {
      key: "wallet-usdc",
      label: "Wallet Balance",
      balance: `$ ${fmt(usdcBalance || 0)}`,
      // date left blank — the underlying WalletCard renders it optionally
    },
    {
      key: "total-deposited",
      label: "Total Deposited",
      balance: `$ ${fmt(totalPrincipal)}`,
    },
    {
      key: "realized-yield",
      label: "Realized Yield",
      balance: `$ ${fmt(totalRealizedYld)}`,
    },
    {
      key: "realized-principal",
      label: "Principal Redeemed",
      balance: `$ ${fmt(totalRealizedPri)}`,
    },
  ];

  return (
    <div className="min-h-screen px-4 py-6 md:px-6 md:py-8 lg:px-12 overflow-x-hidden overflow-y-auto no-scrollbar">
      <h1 className="text-2xl md:text-4xl font-semibold text-white mb-6 md:mb-8">
        Dashboard
      </h1>

      {loading && (
        <div className="text-white/60 text-sm mb-4">Loading portfolio…</div>
      )}
      {!isConnected && (
        <div className="text-white/70 text-sm mb-6">
          Connect your wallet to see live balances and positions.
        </div>
      )}

      {/* KPI Cards Container */}
      <div className="flex items-start gap-4 mb-8 md:mb-10">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 flex-1">
          {walletCards.map((card) => (
            <WalletCard key={card.key} data={card} className="w-full" />
          ))}
        </div>
      </div>

      <div className="border-t border-white/10 mb-6 md:mb-8" />
      {/* Portfolio positions table (LoanPage repurposed) */}
      <LoanPage pagination={false} wrapperClassName="p-0" portfolio={portfolio} />
    </div>
  );
};

export default DashboardPage;
