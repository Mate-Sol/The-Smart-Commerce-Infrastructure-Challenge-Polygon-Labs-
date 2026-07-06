import React, { useState } from "react";
import Button from "../components/ui/Button";
import Typography from "../components/ui/Typography";
import { Zap } from "lucide-react";
import { useAccount, useSendTransaction } from "wagmi";
import { toast } from "react-toastify";
// Chunk D2: real deposit path via services/evm.buildAndSendSteps
// (approve + deposit sequence against payfi_v1 pool contract).
import { buildAndSendSteps } from "../../services/evm";

const DepositForm = ({ walletBalance, currency, apy = "3.63", deal }) => {
  const { address, isConnected } = useAccount();
  const { sendTransactionAsync } = useSendTransaction();

  const [usdcAmount, setUsdcAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const maxBalance = parseFloat(String(walletBalance || '0').replace(/,/g, "")) || 0;
  const apyRate = parseFloat(apy) / 100;
  const parsedAmount = parseFloat(usdcAmount) || 0;
  const projectedEarnings = (parsedAmount * apyRate).toFixed(2);

  const handleChange = (e) => {
    const val = e.target.value;
    if (/^\d*\.?\d*$/.test(val)) setUsdcAmount(val);
  };

  const handleMax = () => setUsdcAmount(maxBalance.toString());

  const handleSubmit = async () => {
    try {
      if (!isConnected || !address) {
        toast.error("Connect your wallet first");
        return;
      }
      if (!deal?.pubkey && !deal?._id) {
        toast.error("Pool address missing on this view");
        return;
      }
      if (parsedAmount <= 0) {
        toast.warning("Enter a positive USDC amount");
        return;
      }
      const remainingAmount =
        Number(deal?.overview?.loanAmount || 0) - Number(deal?.poolAmountRaised || 0);
      if (remainingAmount >= 100 && parsedAmount < 100) {
        toast.warning("A minimum of 100 USDC can be deposited");
        return;
      }
      if (remainingAmount > 0 && remainingAmount < 100 && parsedAmount > remainingAmount) {
        toast.warning(`You can deposit only ${remainingAmount.toFixed(2)} USDC`);
        return;
      }

      setSubmitting(true);
      // The BE returns { steps: [approve, deposit] } for /lender/build-tx/deposit
      // — buildAndSendSteps sequentially prompts the wallet for each.
      const { hashes } = await buildAndSendSteps(
        address, sendTransactionAsync,
        "/pool/lender/build-tx/deposit",
        {
          pool: deal.pubkey || deal._id,
          // parsedAmount is a decimal; the BE accepts decimal strings.
          amount: usdcAmount,
        }
      );
      toast.success(`Deposited ${parsedAmount} ${currency}. tx: ${hashes[hashes.length - 1].slice(0, 10)}…`);
      setUsdcAmount("");
    } catch (error) {
      console.log("🚀 ~ handleSubmit ~ error:", error);
      toast.error(
        error?.response?.data?.message ||
        error?.shortMessage ||
        error?.message ||
        "Deposit failed"
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col  gap-3">
      {/* Main Card */}
      <div className="rounded-2xl bg-primary-card/40 backdrop-blur-md border border-white/20 p-5 flex flex-col gap-4 shadow-lg">
        {/* Title + Balance */}
        <div className="flex flex-col gap-0.5">
          <span className="text-white/60 text-xs">Deposit {currency}</span>
          <span className="text-white font-bold text-2xl leading-tight">
            {walletBalance} {currency}
          </span>
        </div>

        {/* Input row */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-white text-sm shrink-0">$99.99k</span>
          <div className="flex items-center gap-2 ml-auto">
            <input
              type="text"
              value={usdcAmount}
              onChange={handleChange}
              placeholder={`0.27 ${currency}`}
              className="bg-transparent text-white/70 text-sm text-right outline-none w-24 placeholder-white/40"
            />
            <button
              onClick={handleMax}
              className="border border-white/40 rounded-full px-3 py-1 text-xs text-white hover:bg-white/10 transition-all whitespace-nowrap"
            >
              Max
            </button>
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-white/15" />

        {/* Stats */}
        <div className="flex flex-col gap-3">
          {/* Deposit row */}
          <div className="flex items-start justify-between gap-2">
            <span className="text-white text-sm font-medium shrink-0">
              Deposit {currency}
            </span>
            <span className="text-white/70 text-sm text-right">
              {usdcAmount || "0.00"} <span className="mx-1">→</span> 99.99k
            </span>
          </div>

          {/* APY row */}
          <div className="flex items-center justify-between">
            <span className="text-white text-sm font-medium">APY</span>
            <div className="flex items-center gap-1 text-white/70 text-sm">
              <Zap size={13} className="text-yellow-300 fill-yellow-300" />
              <span>{apy}%</span>
            </div>
          </div>

          {/* Projected Earnings row */}
          <div className="flex items-start justify-between gap-2">
            <span className="text-white text-sm font-medium shrink-0">
              Projected Earnings
            </span>
            <span className="text-white/70 text-sm text-right">
              {parsedAmount > 0
                ? `+${projectedEarnings} ${currency}`
                : `0.00 → 99.99k`}
            </span>
          </div>
        </div>
      </div>

      {/* Submit Button */}
      <Button
        variant="gradient"
        color="primary"
        onClick={handleSubmit}
        disabled={!parsedAmount || parsedAmount <= 0}
        className="w-full py-3.5 rounded-2xl text-base font-semibold shadow-[0_4px_24px_rgba(107,92,231,0.4)] bg-accent-alt! disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Submit
      </Button>
    </div>
  );
};

export default DepositForm;
