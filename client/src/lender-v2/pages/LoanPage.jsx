/**
 * LoanPage — LP positions table.
 *
 * Chunk D3 wire-up: takes a `portfolio` prop (from DashboardPage's
 * /lender/portfolio fetch) and renders each open position as a row. When
 * no portfolio is passed (e.g. the page is opened as a standalone route
 * from the sidebar), it fetches /lender/portfolio itself.
 *
 * Dropped the mock loansData + column-picker UI — for the demo we render
 * a fixed column set that maps 1:1 to the payfi_v1 LpPosition shape.
 */

import CustomPagination from "@/components/navigation/CustomPagination";
import DataTable from "@/components/ui/DataTable";
import MobileDataTable from "@/components/ui/MobileDataTable";
import InputField from "@/components/ui/InputField";
import { cn } from "@/libs/utils/utils";
import { Search } from "lucide-react";
import React, { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { useNavigate } from "react-router-dom";
import { api } from "../../services/evm";
import { usdcFromBase } from "../libs/poolAdapter";

const PAGE_SIZE = 5;

const fmt = (n) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

const COLUMNS = [
  {
    key: "pool",
    label: "Pool",
    render: (row) => (
      <span className="font-mono text-xs">
        {row.pool?.slice(0, 6)}…{row.pool?.slice(-4)}
      </span>
    ),
  },
  {
    key: "principal",
    label: "Principal",
    render: (row) => `$ ${fmt(usdcFromBase(row.principal))}`,
  },
  {
    key: "claimedYield",
    label: "Claimed Yield",
    render: (row) => `$ ${fmt(usdcFromBase(row.claimedYield))}`,
  },
  {
    key: "claimedPrincipal",
    label: "Redeemed",
    render: (row) => `$ ${fmt(usdcFromBase(row.claimedPrincipal))}`,
  },
  {
    key: "finalized",
    label: "Status",
    render: (row) => (row.finalized ? "Finalized" : "Open"),
  },
];

const LoanPage = ({ wrapperClassName, pagination = true, portfolio: portfolioProp }) => {
  const { isConnected } = useAccount();
  const navigate = useNavigate();
  const [portfolio, setPortfolio] = useState(portfolioProp || null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => { setPortfolio(portfolioProp || null); }, [portfolioProp]);

  useEffect(() => {
    // Self-fetch only when caller didn't inject data.
    if (portfolioProp) return;
    if (!isConnected) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const { data } = await api().get("/lender/portfolio");
        if (!cancelled) setPortfolio(data);
      } catch { /* silent — auth or network; parent surfaces */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [portfolioProp, isConnected]);

  const positions = portfolio?.positions || [];
  const filtered = positions.filter((p) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (p.pool || "").toLowerCase().includes(q);
  });
  const totalPage = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className={cn(`p-12`, wrapperClassName)}>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h2 className="text-2xl md:text-3xl font-semibold text-white">Positions</h2>
        <div className="flex items-center gap-2 md:gap-3 w-full sm:w-auto md:mr-14">
          <InputField
            placeholder="Filter by pool address…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leftIcon={<Search size={18} />}
            className="w-full! border-white/90! placeholder:text-white/90! bg-transparent!"
            wrapperClassName="flex-1 sm:flex-none sm:w-56 md:w-full"
          />
          <button
            className="text-white/90 hover:text-white text-sm whitespace-nowrap transition-colors hover:underline underline-offset-2"
            onClick={() => navigate("/lender-v2/pools")}
          >
            Browse Pools
          </button>
        </div>
      </div>

      {loading && (
        <div className="text-white/60 text-sm mb-3">Loading positions…</div>
      )}
      {!loading && positions.length === 0 && (
        <div className="text-white/60 text-sm mb-3">
          No open positions yet. Deposit into a pool from{" "}
          <button
            className="underline hover:text-white"
            onClick={() => navigate("/lender-v2/pools")}
          >Pools</button>.
        </div>
      )}

      {/* Table — desktop */}
      <div className="hidden md:flex items-start gap-3">
        <div className="flex-1 min-w-0 overflow-x-auto">
          <DataTable columns={COLUMNS} data={paginated} />
        </div>
      </div>

      {/* Mobile card view */}
      <div className="md:hidden">
        <MobileDataTable
          columns={COLUMNS}
          data={paginated}
          currentPage={currentPage}
          totalPage={totalPage}
          onPageChange={setCurrentPage}
          showNavigation={pagination}
        />
      </div>

      {pagination === true && totalPage > 1 && (
        <div className="hidden md:block">
          <CustomPagination
            currentPage={currentPage}
            totalPage={totalPage}
            setCurrentPage={setCurrentPage}
          />
        </div>
      )}
    </div>
  );
};

export default LoanPage;
