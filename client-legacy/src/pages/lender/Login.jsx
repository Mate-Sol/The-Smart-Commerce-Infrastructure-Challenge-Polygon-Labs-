import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { Loader2, ArrowLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import { walletLogin } from '../../services/solana';
import '../../styles/defa.css';

const LOGO_URL  = 'https://cdn.prod.website-files.com/68f87cc37a7594fc8a44e89b/693054518ad883eb5a10324c_defa_updated_logo.svg';
// Transparent SVG version of the "Yield Time!" hand — blends natively with
// the page gradient, no rectangular background to fight.
const YT_HERO   = 'https://defas3.invoicemate.net/assets/yieldHand-CGDjTsYy.svg';

// Lender sign-in. Wallet-only (Sign-in-with-Solana via tweetnacl ed25519).
// Two-column hero — left: brand + connect wallet, right: "Yield Time!" sign.
const LenderLogin = () => {
  const wallet = useWallet();
  const navigate = useNavigate();
  const [loggingIn, setLoggingIn] = useState(false);
  const [tried, setTried] = useState(false);
  const alreadySignedIn = !!localStorage.getItem('token');

  const signOut = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('lender');
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('user');
    navigate('/');
  };

  // Reset the auto-sign guard whenever the wallet disconnects so a
  // user who hits an error and reconnects gets another attempt.
  useEffect(() => {
    if (!wallet.connected) setTried(false);
  }, [wallet.connected]);

  useEffect(() => {
    if (!wallet.connected || tried) return;
    setTried(true);
    setLoggingIn(true);
    (async () => {
      try {
        await walletLogin(wallet);
        toast.success('Signed in');
        navigate('/lender/dashboard');
      } catch (e) {
        // Server returns 403 + code 'WALLET_NOT_REGISTERED' when the wallet
        // hasn't redeemed an access code yet. Route them to /apply-access
        // so onboarding is one click away instead of a dead-end toast.
        const code = e.response?.data?.code;
        const status = e.response?.status;
        if (status === 403 && code === 'WALLET_NOT_REGISTERED') {
          toast.error('This wallet isn\'t registered. Redeem an access code to continue.');
          navigate('/apply-access');
        } else {
          toast.error(e.response?.data?.message || e.message);
        }
      } finally {
        setLoggingIn(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.connected, wallet.publicKey?.toBase58()]);

  return (
    <div className="defa-shell">
      {/* Top nav with back-to-landing */}
      <header className="max-w-7xl mx-auto px-6 lg:px-8 pt-6 flex items-center justify-between">
        <Link to="/" className="text-white/80 hover:text-white inline-flex items-center gap-1.5 text-sm">
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>
        <Link to="/" className="flex items-center" aria-label="DeFa home">
          <img src={LOGO_URL} alt="DeFa" className="h-10 w-auto" />
        </Link>
        <div className="w-12" />
      </header>

      <main className="max-w-7xl mx-auto px-6 lg:px-8 grid lg:grid-cols-2 items-center gap-10 mt-12 lg:mt-20">
        {/* Left: sign-in card */}
        <div className="max-w-md w-full mx-auto lg:mx-0">
          <div className="mb-2 text-sm text-white/70 tracking-widest uppercase">Lender Portal</div>
          <h1 className="defa-headline mb-3" style={{ fontSize: 'clamp(2rem, 4vw, 3.2rem)' }}>
            Sign in &<br />earn yield
          </h1>
          <p className="defa-subhead mb-8 max-w-sm">
            Connect your Solana wallet to deposit USDC into open facilities and earn from
            utilization &amp; commitment fees.
          </p>

          <div className="space-y-4">
            {alreadySignedIn && (
              <div
                className="defa-card p-4 flex items-center justify-between gap-3"
                style={{ background: 'rgba(34,197,94,0.18)', borderColor: 'rgba(167,243,208,0.45)' }}
              >
                <div className="text-sm text-white/90">
                  You're already signed in.
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => navigate('/lender/dashboard')} className="defa-btn-primary text-xs">
                    Open Dashboard
                  </button>
                  <button onClick={signOut} className="defa-btn-ghost text-xs">
                    Sign out
                  </button>
                </div>
              </div>
            )}

            <div className="defa-label">Wallet</div>
            <div className="defa-card p-4 flex items-center justify-between gap-3">
              <div className="text-sm text-white/80">
                {wallet.connected
                  ? <>Connected <span className="font-mono">{wallet.publicKey?.toBase58().slice(0, 6)}…{wallet.publicKey?.toBase58().slice(-4)}</span></>
                  : 'No wallet connected'}
              </div>
              <WalletMultiButton />
            </div>

            {loggingIn && (
              <div className="text-white/85 text-sm flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Verifying signature…
              </div>
            )}

            {wallet.connected && !loggingIn && (
              <p className="text-white/60 text-xs font-mono break-all">
                {wallet.publicKey?.toBase58()}
              </p>
            )}

            <div className="defa-divider my-2" />

            <div className="text-xs text-white/65">
              Don't have a wallet? Install{' '}
              <a href="https://phantom.app" className="underline hover:text-white" target="_blank" rel="noreferrer">Phantom</a>
              {' '}or{' '}
              <a href="https://www.backpack.app" className="underline hover:text-white" target="_blank" rel="noreferrer">Backpack</a>,
              fund it with devnet SOL, and come back here.
            </div>
            <div className="text-xs text-white/65">
              Looking for a different role?{' '}
              <Link to="/" className="underline hover:text-white">Back to portal chooser</Link>.
            </div>
          </div>
        </div>

        {/* Right: hero illustration */}
        <YieldTimeHero />
      </main>
    </div>
  );
};

// Transparent SVG hero — sits directly on the page gradient with a soft
// glow halo behind it for lift. No frame needed.
const YieldTimeHero = () => (
  <div className="relative h-[560px] hidden lg:flex items-center justify-center select-none">
    <div
      aria-hidden
      className="absolute"
      style={{
        inset: '12% 10%',
        background: 'radial-gradient(ellipse at center, rgba(255,255,255,0.40) 0%, rgba(255,255,255,0) 70%)',
        filter: 'blur(50px)',
      }}
    />
    <img
      src={YT_HERO}
      alt="Yield Time — earn from on-chain receivables"
      className="relative max-h-full w-auto"
      draggable={false}
      style={{ filter: 'drop-shadow(0 40px 60px rgba(15, 23, 42, 0.28))' }}
    />
  </div>
);

export default LenderLogin;
