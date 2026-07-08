import React from "react";
import Card from "../components/ui/Card";
import Typography from "../components/ui/Typography";
import { FileText } from "lucide-react";

const Row = ({ label, value }) => (
  <div className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
    <span className="text-white/90 text-sm">{label}</span>
    <span className="text-white text-sm text-right max-w-[55%]">{value}</span>
  </div>
);

const BusinessOverview = ({
  established = "A 2012",
  industry = "Security Systems",
  focus = "Infrastructure & Surveillance",
  specialization = "Large-scale project integration",
  market = "SME construction sector",
  about = "360Data is a commercial-grade solution running modern that connects manufacturers to facility for bringing from behind the currency sector.",
  financials = {
    revenue: "$ 4.1664",
    netProfit: "$ 0.08",
    equity: "$ 0.3664",
    debtToEquity: "0.7921",
  },
  purposeOfFacility = [
    { left: "Procurement", right: "Security components" },
    { left: "Executive Capacity", right: "Multi-site execution" },
    { left: "Financial Structuring", right: "Payment cycle bridging" },
  ],
}) => {
  return (
    <Card variant="simple" className="flex flex-col gap-6">
      <Typography variant="h5">Business Overview</Typography>

      {/* Info rows */}
      <div className="flex flex-col">
        <Row label="Established" value={established} />
        <Row label="Industry" value={industry} />
        <Row label="Focus" value={focus} />
        <Row label="Specialization" value={specialization} />
        <Row label="Market" value={market} />
      </div>

      {/* About */}
      <div>
        <Typography
          variant="caption"
          className="mb-1 block text-sm! text-white"
        >
          About 360Data
        </Typography>
        <Typography
          variant="body2"
          className="text-white/90 text-xs leading-relaxed"
        >
          {about}
        </Typography>
      </div>

      {/* Two-column section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Financial Strength */}
        <div>
          <Typography
            variant="caption"
            className="mb-3 block text-2xl! text-white!"
          >
            Financial Strength (USDC)
          </Typography>
          <div className="flex flex-col gap-1">
            <Row label="Revenue (ESGR)" value={financials.revenue} />
            <Row label="Net Profit (USDC)" value={financials.netProfit} />
            <Row label="Equity (USDC YTD)" value={financials.equity} />
            <Row label="Debt-to-Equity" value={financials.debtToEquity} />
          </div>
          {/* PDF Report */}
          <div className="flex items-center gap-2 mt-3 p-2 rounded-xl bg-white/5 border border-white/10 w-fit">
            <FileText size={20} className="text-rose-400" />
            <span className="text-xs text-white/60">KYI Report</span>
            <span className="text-xs text-white/30">View</span>
          </div>
        </div>

        {/* Purpose of Facility */}
        <div>
          <Typography
            variant="caption"
            className="mb-3 block text-2xl! text-white!"
          >
            Purpose of Facility
          </Typography>
          <div className="flex flex-col gap-1">
            {purposeOfFacility.map((item, i) => (
              <div
                key={i}
                className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0"
              >
                <span className="text-white text-xs">{item.left}</span>
                <span className="text-white text-xs">{item.right}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
};

export default BusinessOverview;
