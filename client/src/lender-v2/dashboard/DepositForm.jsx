import React, { useState } from "react";
import Button from "../components/ui/Button";
import Typography from "../components/ui/Typography";
import { Zap } from "lucide-react";
import { useWalletConnect } from "@/hooks/useWalletConnect";
import { validateWalletMatch } from "@/libs/utils/utils";
import { toast } from "react-toastify";
import { useSelector } from "react-redux";

const DepositForm = ({ walletBalance, currency, apy = "3.63", deal }) => {
  // const userData = useSelector((s) => s.auth.user);
  const { connect, walletAddress, usdcBalance } = useWalletConnect();

  const [usdcAmount, setUsdcAmount] = useState("");

  const maxBalance = parseFloat(walletBalance.replace(/,/g, "")) || 0;
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
      // connect user selected block chain wallet
      await connect();
      if (!walletAddress) {
        toast.error("Please connect your wallet first");
        return;
      }
      const remainingAmount = Number(
        Number(deal?.overview?.loanAmount) - Number(deal?.poolAmountRaised),
      ).toFixed(2);

      if (remainingAmount >= 100 && Number(usdcAmount) < 100) {
        toast.warning("A minimum of 100 USDC can be deposited");
        return;
      }

      if (remainingAmount < 100) {
        if (Number(usdcAmount) < remainingAmount) {
          toast.warning(`You can deposit only ${remainingAmount} USDC`);
          return;
        }
      }

      // const userActiveAddress = userData?.address;
      const userActiveAddress = walletAddress;

      const bcType = validateWalletMatch(walletAddress);
      if (bcType === "Stellar") {
      }
      // if (!parsedAmount || parsedAmount <= 0) return;
      // alert(`Depositing ${parsedAmount} ${currency}`);
    } catch (error) {
      console.log("🚀 ~ handleSubmit ~ error:", error);
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
