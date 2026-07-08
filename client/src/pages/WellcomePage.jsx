import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import img16 from "../assets/multiChain-ui/img16.svg";
import img25 from "../assets/multiChain-ui/img25.svg";
import img85 from "../assets/multiChain-ui/img85.svg";
import Button from "../components/ui/Button";
import Typography from "../components/ui/Typography";

const WellcomePage = () => {
  const navigate = useNavigate();

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  return (
    <div className="relative min-h-[calc(100vh-120px)] w-full overflow-hidden flex items-center">
      {/* Left content */}
      <div className="relative z-10 flex flex-col gap-8 px-6 sm:px-16 max-w-xl w-full sm:w-auto text-center sm:text-left items-center sm:items-start">
        <Typography variant="h1" className="leading-tight">
          Start earning yields backed by real economic activities
        </Typography>
        <div>
          <Button
            variant="gradient"
            color="primary"
            onClick={() => navigate("/pools")}
            className="px-8 py-3 rounded-full text-white border border-white/30 bg-blue-500/40! backdrop-blur-sm hover:bg-white/20 transition-all"
          >
            Pools
          </Button>
        </div>
      </div>

      {/* img85 — large dashed circle, bottom-right behind */}
      <img
        src={img85}
        alt="85% Average Yield"
        className="absolute object-contain"
        style={{
          width: "clamp(280px, 50vw, 600px)",
          height: "clamp(280px, 50vw, 600px)",
          right: "-60px",
          bottom: "-120px",
          zIndex: 1,
        }}
      />

      {/* img16 — solid circle, overlaps top-left of img85 */}
      <img
        src={img16}
        alt="16 Total Active Loans"
        className="absolute object-contain hidden sm:block"
        style={{
          width: "clamp(140px, 22vw, 280px)",
          height: "clamp(140px, 22vw, 280px)",
          right: "clamp(160px, 25vw, 320px)",
          top: "18%",
          zIndex: 2,
        }}
      />

      {/* img25 — small circle, top-right */}
      <img
        src={img25}
        alt="25 Total Number of Loans"
        className="absolute object-contain hidden sm:block"
        style={{
          width: "clamp(80px, 12vw, 150px)",
          height: "clamp(80px, 12vw, 150px)",
          right: "clamp(50px, 8vw, 100px)",
          top: "5%",
          zIndex: 2,
        }}
      />
    </div>
  );
};

export default WellcomePage;
