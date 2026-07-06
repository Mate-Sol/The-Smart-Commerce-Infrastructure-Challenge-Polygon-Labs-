/**
 * Access code redemption — combined OTP + wallet-connect + SIWE redeem.
 *
 * Chunk D1 rewrite: replaces the two-step (redeem code → /register/:code)
 * flow with a single-page atomic redeem against the Colosseum
 * /access-code/redeem endpoint. On success the server:
 *   - marks the code consumed,
 *   - creates the Lender record with the SIWE-verified wallet + email,
 *   - issues a lender JWT.
 *
 * Flow (top to bottom on screen):
 *   1. Enter 6-digit code (OtpBox)
 *   2. Enter display name + email
 *   3. Connect wallet (RainbowKit)
 *   4. Redeem → server issues SIWE nonce → wallet signs → server verifies
 *      + claims code atomically + creates Lender + returns JWT
 *   5. Navigate to /lender-v2/wellcome
 */

import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { useAccount, useSignMessage } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { toast } from 'react-toastify';
import axios from 'axios';

import mainLogo from '@/assets/multiChain-ui/main-defa-logo.svg';
import accessBg from '@/assets/multiChain-ui/access-bg.jpg';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Typography from '@/components/ui/Typography';
import OtpBox from '@/components/ui/OtpBox';
import InputField from '@/components/ui/InputField';
import LoadingOverlay from '@/components/loading/LoadingOverlay';

import { loginSuccess } from '@/store/loginSlice';

const OTP_LENGTH = 6;
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5050';

const GrantAccessPage = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [otp, setOtp] = useState(Array(OTP_LENGTH).fill(''));
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const validateCode = () => {
    const isIncomplete = otp.some((c) => c === '');
    if (isIncomplete) return 'Please enter the complete 6-digit access code.';
    return null;
  };
  const validateProfile = () => {
    if (!displayName.trim()) return 'Display name required.';
    if (!email.trim()) return 'Email required.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return 'Email is invalid.';
    return null;
  };

  const handleRedeem = async () => {
    const codeErr = validateCode();
    if (codeErr) { setError(codeErr); toast.error(codeErr); return; }
    const profileErr = validateProfile();
    if (profileErr) { setError(profileErr); toast.error(profileErr); return; }
    if (!isConnected || !address) {
      const msg = 'Connect a wallet before redeeming.';
      setError(msg); toast.error(msg); return;
    }
    setError('');

    try {
      setLoading(true);
      const code = otp.join('');

      // 1. Get a SIWE nonce for this wallet + purpose=login
      const nonceRes = await axios.post(`${API_BASE}/auth/wallet/nonce`, {
        wallet: address, purpose: 'login',
      });
      const { nonce, message } = nonceRes.data;

      // 2. Sign it in the browser wallet
      const signature = await signMessageAsync({ message });

      // 3. Atomic redeem — server verifies SIWE, claims the code, creates
      //    the Lender record, and returns the JWT.
      const redeemRes = await axios.post(`${API_BASE}/access-code/redeem`, {
        code,
        name: displayName.trim(),
        email: email.trim(),
        wallet: address,
        nonce,
        signature,
        message,
      });
      const { token, lender } = redeemRes.data || {};
      if (!token) throw new Error('Server did not return a token');

      localStorage.setItem('token', token);
      localStorage.setItem('lender', JSON.stringify(lender));
      dispatch(loginSuccess(lender));
      toast.success('Welcome to DeFa.');
      navigate('/lender-v2/wellcome');
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Redemption failed';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <LoadingOverlay isLoading={loading} status="Verifying…" />
      <div
        className="relative min-h-screen w-full flex items-center justify-center overflow-hidden"
        style={{
          backgroundImage: `url(${accessBg})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      >
        <div className="absolute top-5 right-6 z-20">
          <Link to="/lender-v2">
            <Button variant="gradient" color="secondary" className="px-6! py-2! text-sm">
              Login
            </Button>
          </Link>
        </div>

        <div className="relative z-10 w-full max-w-6xl mx-auto px-5 sm:px-10 flex flex-col items-center sm:items-start">
          <div className="mb-3">
            <img src={mainLogo} alt="DeFa Logo" className="h-8 sm:h-9 w-auto" />
          </div>

          <Typography
            variant="h5"
            className="text-white font-bold mb-6 sm:mb-8 text-base sm:text-xl md:text-2xl"
          >
            Private Mainnet — Invite Only
          </Typography>

          <div className="flex flex-col gap-4 w-full sm:max-w-md">
            <Card className="rounded-2xl! border-white/20!">
              <div className="flex flex-col gap-4">
                <OtpBox
                  label="Access Code"
                  length={OTP_LENGTH}
                  value={otp}
                  onChange={(val) => { setError(''); setOtp(val); }}
                  onKeyDownForSubmit={handleRedeem}
                />
                <InputField
                  label="Display name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. Acme Capital"
                />
                <InputField
                  label="Email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
                <div>
                  <Typography as="span" variant="body2" className="text-white/80 mb-2 block">
                    Wallet
                  </Typography>
                  <ConnectButton showBalance={false} chainStatus="icon" />
                </div>
                {error && <p className="text-red-400 text-sm mt-1">{error}</p>}
              </div>
            </Card>

            <Button
              variant="gradient"
              color="secondary"
              onClick={handleRedeem}
              disabled={loading}
              className="w-full sm:w-1/2"
            >
              {loading ? 'Please wait…' : 'Redeem & Continue'}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
};

export default GrantAccessPage;
