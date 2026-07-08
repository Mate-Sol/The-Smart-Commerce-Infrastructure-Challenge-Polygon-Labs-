import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { Loader2, ArrowRight, CheckCircle2 } from 'lucide-react';
import bs58 from 'bs58';
import axios from 'axios';
import toast from 'react-hot-toast';
import '../styles/defa.css';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5050';
const LOGO_URL = 'https://cdn.prod.website-files.com/68f87cc37a7594fc8a44e89b/693054518ad883eb5a10324c_defa_updated_logo.svg';
const HERO_URL = 'https://defas3.invoicemate.net/assets/yieldHand-CGDjTsYy.svg';

// Multi-step lender onboarding gated by a one-time access code minted by
// an on-chain admin. Steps:
//   1. CODE   — 12-char code in 3 groups, auto-uppercase, /access-code/check
//   2. PROFILE — name + email
//   3. WALLET — connect Solana wallet, sign nonce, /access-code/redeem
// On success the lender JWT is stored in localStorage (matching the
// existing /lender/login flow) and we route to /lender/dashboard.
const CODE_LEN = 12; // three groups of 4

const ApplyAccess = () => {
  const navigate = useNavigate();
  const wallet = useWallet();
  const [step, setStep] = useState('CODE'); // CODE | PROFILE | WALLET | DONE
  const [code, setCode] = useState('');     // raw 12 chars, no dashes
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Already authenticated? offer a quick jump to dashboard.
  const alreadySignedIn = !!localStorage.getItem('token');

  const checkCode = async () => {
    if (code.length !== CODE_LEN) {
      setError('Enter the full 12-character code.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const formatted = formatCode(code);
      const { data } = await axios.post(`${API_BASE}/access-code/check`, { code: formatted });
      if (!data.valid) {
        setError(data.reason || 'Invalid code.');
        return;
      }
      setStep('PROFILE');
    } catch (e) {
      setError(e.response?.data?.reason || e.message);
    } finally { setBusy(false); }
  };

  const goToWalletStep = () => {
    if (!name.trim()) { setError('Enter your name.'); return; }
    if (!/^\S+@\S+\.\S+$/.test(email)) { setError('Enter a valid email.'); return; }
    setError('');
    setStep('WALLET');
  };

  const redeem = async () => {
    if (!wallet.connected || !wallet.publicKey) {
      setError('Connect your wallet first.');
      return;
    }
    if (!wallet.signMessage) {
      setError('Connected wallet does not support signMessage.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const walletStr = wallet.publicKey.toBase58();
      const { data: nonceData } = await axios.post(`${API_BASE}/auth/wallet/nonce`, {
        wallet: walletStr, purpose: 'login',
      });
      const sigBytes = await wallet.signMessage(new TextEncoder().encode(nonceData.message));
      const signature = bs58.encode(sigBytes);
      const { data } = await axios.post(`${API_BASE}/access-code/redeem`, {
        code: formatCode(code),
        name: name.trim(),
        email: email.trim(),
        wallet: walletStr,
        nonce: nonceData.nonce,
        signature,
      });
      localStorage.setItem('token', data.token);
      localStorage.setItem('lender', JSON.stringify(data.lender));
      setStep('DONE');
      toast.success('Access granted — welcome aboard.');
      setTimeout(() => navigate('/lender/dashboard'), 800);
    } catch (e) {
      setError(e.response?.data?.message || e.message);
    } finally { setBusy(false); }
  };

  return (
    <div
      className="defa-shell relative overflow-x-hidden"
      style={{ minHeight: '100vh' }}
    >
      {/* Top-right Login link (returning lenders) */}
      <header className="absolute top-0 right-0 px-6 lg:px-10 pt-6 z-10">
        <Link to="/lender/login" className="defa-pill">Login</Link>
      </header>

      <main className="max-w-7xl mx-auto px-6 lg:px-10 grid lg:grid-cols-2 gap-10 items-center min-h-screen">
        {/* Left column — brand + form */}
        <div className="py-16 lg:py-20 w-full max-w-[460px]">
          <img src={LOGO_URL} alt="DeFa" className="h-12 w-auto mb-3" draggable={false} />
          <div className="text-2xl font-bold tracking-tight mb-2">Private Mainnet</div>
          <div className="text-sm text-white/70 mb-8">
            Lender access is invite-only during the pilot. Enter the access code an on-chain
            admin shared with you to get started.
          </div>

          {alreadySignedIn && (
            <div
              className="defa-card p-4 mb-6 flex items-center justify-between gap-3"
              style={{ background: 'rgba(34,197,94,0.18)', borderColor: 'rgba(167,243,208,0.45)' }}
            >
              <div className="text-sm text-white/90">You're already signed in.</div>
              <Link to="/lender/dashboard" className="defa-btn-primary text-xs">Open Dashboard</Link>
            </div>
          )}

          {step === 'CODE' && (
            <CodePanel
              code={code} setCode={setCode} onContinue={checkCode}
              busy={busy} error={error}
            />
          )}

          {step === 'PROFILE' && (
            <ProfilePanel
              code={code}
              name={name} setName={setName}
              email={email} setEmail={setEmail}
              onBack={() => { setStep('CODE'); setError(''); }}
              onContinue={goToWalletStep}
              error={error}
            />
          )}

          {step === 'WALLET' && (
            <WalletPanel
              wallet={wallet}
              onBack={() => { setStep('PROFILE'); setError(''); }}
              onRedeem={redeem}
              busy={busy} error={error}
              name={name}
            />
          )}

          {step === 'DONE' && (
            <div className="defa-card p-6 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-300 mx-auto mb-2" />
              <div className="font-semibold text-lg">You're in.</div>
              <div className="text-sm text-white/70 mt-1">Loading your dashboard…</div>
            </div>
          )}

          <div className="text-xs text-white/55 mt-8">
            Don't have a code yet? Reach out to your DeFa contact —
            access codes are minted by on-chain admins on request.
          </div>
        </div>

        {/* Right column — illustration. min-w-0 lets the flex/grid item
            shrink below its natural size; without it the SVG can push the
            column wider than the grid track and collapse the left column. */}
        <div className="relative h-[560px] min-w-0 hidden lg:flex items-center justify-center select-none">
          <div
            aria-hidden
            className="absolute"
            style={{
              inset: '8% 6%',
              background: 'radial-gradient(ellipse at center, rgba(255,255,255,0.40) 0%, rgba(255,255,255,0) 70%)',
              filter: 'blur(50px)',
            }}
          />
          <img
            src={HERO_URL}
            alt="DeFa private mainnet"
            className="relative max-h-full max-w-full w-auto object-contain"
            draggable={false}
            style={{ filter: 'drop-shadow(0 40px 60px rgba(15, 23, 42, 0.28))' }}
          />
        </div>
      </main>
    </div>
  );
};

// === step components ===

const CodePanel = ({ code, setCode, onContinue, busy, error }) => {
  const inputs = useRef([]);
  useEffect(() => { inputs.current[0]?.focus(); }, []);

  const setChar = (idx, ch) => {
    const upper = ch.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 1);
    const arr = code.padEnd(CODE_LEN, ' ').split('');
    arr[idx] = upper || ' ';
    const next = arr.join('').replace(/ +$/, '');
    setCode(next.replace(/ /g, ''));
    if (upper && idx < CODE_LEN - 1) inputs.current[idx + 1]?.focus();
  };
  const onKeyDown = (idx, e) => {
    if (e.key === 'Backspace' && !code[idx] && idx > 0) {
      inputs.current[idx - 1]?.focus();
    }
    if (e.key === 'Enter') onContinue();
  };
  const onPaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LEN);
    setCode(pasted);
    setTimeout(() => inputs.current[Math.min(pasted.length, CODE_LEN - 1)]?.focus(), 0);
  };

  // Render as three groups of 4 inputs with a small gap between groups.
  // Removes the inline em-dash separators that were forcing the row past
  // the card's max-width — visual grouping carries the same meaning.
  const groups = [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11]];

  return (
    <div className="defa-card p-6 lg:p-7">
      <div className="defa-label mb-3">Enter Access Code</div>
      <div className="flex items-center justify-between gap-3 mb-4" onPaste={onPaste}>
        {groups.map((g, gi) => (
          <div key={gi} className="flex items-center gap-1.5 flex-1">
            {g.map((i) => (
              <input
                key={i}
                ref={(el) => (inputs.current[i] = el)}
                value={code[i] || ''}
                onChange={(e) => setChar(i, e.target.value.slice(-1))}
                onKeyDown={(e) => onKeyDown(i, e)}
                className="w-full aspect-square min-w-0 max-w-[40px] text-center text-base font-mono tabular-nums uppercase rounded-lg
                           bg-white/10 border border-white/25 text-white outline-none
                           focus:border-white/55"
                maxLength={1}
                inputMode="text"
                autoComplete="off"
              />
            ))}
          </div>
        ))}
      </div>

      {error && <div className="text-xs text-red-200 mb-3">{error}</div>}

      <button
        onClick={onContinue}
        disabled={busy || code.length !== CODE_LEN}
        className="defa-btn-primary w-full justify-center"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
        Continue
      </button>

      <div className="text-[11px] text-white/55 mt-3">
        Codes are case-insensitive and one-time-use. Once redeemed they bind to your wallet.
      </div>
    </div>
  );
};

const ProfilePanel = ({ code, name, setName, email, setEmail, onBack, onContinue, error }) => (
  <div className="defa-card p-6 lg:p-7">
    <div className="defa-label mb-3">Tell us who you are</div>
    <div className="text-xs text-white/65 mb-4">
      Code <span className="font-mono text-white/85">{formatCode(code)}</span> verified.
    </div>

    <label className="defa-label block mb-1.5">Full name</label>
    <input
      type="text"
      value={name}
      onChange={(e) => setName(e.target.value)}
      placeholder="Jane Doe"
      className="defa-input mb-4"
    />

    <label className="defa-label block mb-1.5">Email</label>
    <input
      type="email"
      value={email}
      onChange={(e) => setEmail(e.target.value)}
      placeholder="jane@example.com"
      className="defa-input mb-2"
    />
    <div className="text-[11px] text-white/55 mb-4">
      Used for close-out + repayment notifications. We will not spam you.
    </div>

    {error && <div className="text-xs text-red-200 mb-3">{error}</div>}

    <div className="flex gap-2">
      <button onClick={onBack} className="defa-btn-ghost flex-1 justify-center">Back</button>
      <button onClick={onContinue} className="defa-btn-primary flex-[2] justify-center">
        Continue <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  </div>
);

const WalletPanel = ({ wallet, onBack, onRedeem, busy, error, name }) => (
  <div className="defa-card p-6 lg:p-7">
    <div className="defa-label mb-3">Connect your wallet, {name.split(' ')[0] || 'lender'}</div>
    <div className="text-xs text-white/65 mb-4">
      Sign a one-time message so we can bind this access code to your Solana wallet.
      We never see your private key.
    </div>

    <div className="defa-card p-4 flex items-center justify-between gap-3 mb-4" style={{ background: 'rgba(255,255,255,0.06)' }}>
      <div className="text-sm text-white/80">
        {wallet.connected
          ? <>Connected <span className="font-mono">{wallet.publicKey?.toBase58().slice(0, 6)}…{wallet.publicKey?.toBase58().slice(-4)}</span></>
          : 'No wallet connected'}
      </div>
      <WalletMultiButton />
    </div>

    {error && <div className="text-xs text-red-200 mb-3">{error}</div>}

    <div className="flex gap-2">
      <button onClick={onBack} disabled={busy} className="defa-btn-ghost flex-1 justify-center">Back</button>
      <button
        onClick={onRedeem}
        disabled={busy || !wallet.connected}
        className="defa-btn-primary flex-[2] justify-center"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
        Redeem & Sign In
      </button>
    </div>
  </div>
);

// 'ABCD1234EFGH' → 'ABCD-1234-EFGH'
function formatCode(raw) {
  const c = (raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LEN);
  return [c.slice(0, 4), c.slice(4, 8), c.slice(8, 12)].filter(Boolean).join('-');
}

export default ApplyAccess;
