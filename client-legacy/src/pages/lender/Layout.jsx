import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { LogOut, Loader2, Coins } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../services/solana';
import '../../styles/defa.css';

/**
 * Lender shell layout — same DeFa cobalt-blue theme as on-chain admin.
 * Auth gate: if no JWT in localStorage (lender-side stores there),
 * bounce to /lender/login.
 */
const LenderLayout = ({ children, requireAuth = true }) => {
  const navigate = useNavigate();
  const wallet = useWallet();
  const [me, setMe] = useState(null);
  const [minting, setMinting] = useState(false);

  // Fake-USDC faucet for the demo. Mints 1M USDC-DF per call to the
  // connected wallet (per-wallet 10M lifetime cap, 1 min cooldown — both
  // enforced server-side in /faucet/usdc-df). Lender refresh on the
  // dashboard / facilities pages picks up the new balance automatically.
  const handleMintUsdc = async () => {
    if (!wallet.connected || !wallet.publicKey) {
      toast.error('Connect a wallet first');
      return;
    }
    setMinting(true);
    try {
      const { data } = await api().post('/faucet/usdc-df', {
        wallet: wallet.publicKey.toBase58(),
      });
      // amount is in base units (6 decimals). Show whole USDC.
      const minted = Number(BigInt(data.amount)) / 1_000_000;
      toast.success(`Minted ${minted.toLocaleString()} USDC-DF`);
    } catch (e) {
      const msg = e.response?.data?.message || e.message;
      // Cooldown / lifetime cap → 429 with a clear message; surface as-is.
      toast.error(msg);
    } finally {
      setMinting(false);
    }
  };

  useEffect(() => {
    if (!requireAuth) return;
    const tok = localStorage.getItem('token');
    const stored = localStorage.getItem('lender');
    // Validate the token is actually a lender token. A leftover PSP/admin
    // token in localStorage would otherwise pass the gate and 401 every API call.
    if (!tok || !isLenderToken(tok)) {
      localStorage.removeItem('token');
      localStorage.removeItem('lender');
      navigate('/lender/login');
      return;
    }
    if (stored) {
      try { setMe(JSON.parse(stored)); } catch {}
    }
  }, [requireAuth]);

  // Decode a JWT payload (no signature check — server still validates).
  function isLenderToken(tok) {
    try {
      const payload = JSON.parse(atob(tok.split('.')[1]));
      return payload?.kind === 'lender';
    } catch { return false; }
  }

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('lender');
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('user');
    wallet.disconnect();
    navigate('/');
  };

  const tabs = [
    { to: '/lender/dashboard', label: 'Dashboard' },
    { to: '/lender/facilities', label: 'All Facilities' },
    { to: '/lender/my-investments', label: 'My Investments' },
  ];

  return (
    <div className="defa-shell">
      <header className="px-6 lg:px-12 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img
            src="https://cdn.prod.website-files.com/68f87cc37a7594fc8a44e89b/693054518ad883eb5a10324c_defa_updated_logo.svg"
            alt="DeFa"
            className="h-9 w-auto"
            draggable={false}
          />
          <div className="text-[10px] uppercase tracking-widest text-white/60 leading-none">
            Lender · Devnet
          </div>
        </div>

        {requireAuth && (
          <nav className="hidden md:flex items-center gap-2">
            {tabs.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                className={({ isActive }) =>
                  `defa-pill ${isActive ? 'defa-pill-active' : ''}`
                }
              >
                {t.label}
              </NavLink>
            ))}
          </nav>
        )}

        <div className="flex items-center gap-3">
          {requireAuth && wallet.connected && (
            <button
              onClick={handleMintUsdc}
              disabled={minting}
              className="defa-btn-ghost"
              title="Mint 1M test USDC-DF to your connected wallet"
            >
              {minting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Coins className="w-4 h-4" />}
              Mint USDC
            </button>
          )}
          <WalletMultiButton />
          {requireAuth && me && (
            <button onClick={handleLogout} className="defa-btn-ghost" title="Sign out">
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      <main className="px-6 lg:px-12 pb-16">{children}</main>
    </div>
  );
};

export default LenderLayout;
