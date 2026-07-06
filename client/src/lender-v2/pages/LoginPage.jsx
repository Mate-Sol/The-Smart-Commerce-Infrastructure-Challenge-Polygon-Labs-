/**
 * Lender login — wallet-based SIWE flow.
 *
 * Chunk D1 swap: dropped the email/password form (which hit /users/login
 * and never matched the wallet-only Lender model), replaced with a
 * connect-wallet → sign SIWE message → JWT flow via services/evm.
 * Preserved the DeFa visual layout (mainLogo + yieldHand + coins) so the
 * user-facing screen looks identical.
 */

import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAccount, useSignMessage } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useDispatch } from 'react-redux';
import { toast } from 'react-toastify';

import LoadingOverlay from '@/components/loading/LoadingOverlay';
import Button from '@/components/ui/Button';
import Typography from '@/components/ui/Typography';
import yieldHand from '../assets/multiChain-ui/yieldHand.svg';
import leftCoin from '../assets/multiChain-ui/left-defa-coin.svg';
import rightCoin from '../assets/multiChain-ui/right-defa-coin.svg';
import mainLogo from '../assets/multiChain-ui/main-defa-logo.svg';

import { walletLogin } from '../../services/evm';
import { loginSuccess } from '@/store/loginSlice';

const LoginPage = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const handleSignInWithWallet = async () => {
    if (!address) {
      toast.error('Connect a wallet first');
      return;
    }
    try {
      setLoading(true);
      const { lender } = await walletLogin(address, signMessageAsync);
      dispatch(loginSuccess(lender));
      toast.success('Signed in.');
      navigate('/lender-v2/wellcome');
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Sign-in failed';
      if (err?.response?.data?.code === 'WALLET_NOT_REGISTERED') {
        toast.error('This wallet has no account yet. Redeem an access code first.');
        navigate('/lender-v2/enter-access-code');
        return;
      }
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const authCard = (
    <div className="w-full lg:w-1/2 flex items-center justify-center px-6 sm:px-8 md:px-10 lg:px-16 z-10 py-10 lg:py-0 min-h-screen lg:min-h-0">
      <div className="w-full max-w-[420px]">
        <div className="mb-8 sm:mb-10">
          <img src={mainLogo} alt="DeFa Logo" className="h-8 sm:h-9 md:h-10 w-auto" />
        </div>

        <div className="mb-6 sm:mb-8">
          <h1 className="text-[26px] sm:text-[28px] font-semibold text-white mb-1">
            Sign in
          </h1>
          <p className="text-white/90 text-[14px] sm:text-[15px] font-normal">
            Connect your wallet to access your lender dashboard.
          </p>
        </div>

        <div className="space-y-5">
          {/* RainbowKit connect button — handles connector modal, network switch, etc. */}
          <div className="flex justify-center">
            <ConnectButton showBalance={false} accountStatus="address" chainStatus="icon" />
          </div>

          <Button
            type="button"
            variant="gradient"
            color="primary"
            disabled={!isConnected || loading}
            onClick={handleSignInWithWallet}
            className="w-full h-[46px] sm:h-[50px] text-[14px] sm:text-[15px] mt-2 !bg-blue-500/50"
          >
            {loading
              ? 'Signing…'
              : isConnected
                ? 'Sign message to log in'
                : 'Connect wallet first'}
          </Button>

          <div className="text-center pt-2">
            <Typography as="p" variant="body2" className="text-white/70">
              First time? You'll need an invite code from your on-chain admin.
            </Typography>
            <Link
              to="/lender-v2/enter-access-code"
              className="text-white hover:underline font-semibold text-[13px] sm:text-[14px]"
            >
              I have an access code
            </Link>
          </div>
        </div>
      </div>
    </div>
  );

  const rightSection = (
    <div className="hidden lg:block lg:w-1/2 relative">
      <div className="absolute left-[5%] top-[15%] z-20">
        <img src={leftCoin} alt="Defa Coin" className="w-[80px] xl:w-[100px] h-auto" />
      </div>
      <div className="absolute right-[10%] bottom-[28%] z-20">
        <img src={rightCoin} alt="Defa Coin" className="w-[90px] xl:w-[110px] h-auto" />
      </div>
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-10 w-[420px] xl:w-[520px] 2xl:w-[580px]">
        <img
          src={yieldHand}
          alt="Yield Time"
          className="w-full h-auto object-contain object-bottom"
          style={{ maxHeight: '95vh' }}
        />
      </div>
    </div>
  );

  const mobileCoins = (
    <div className="lg:hidden absolute inset-0 pointer-events-none overflow-hidden">
      <img src={leftCoin} alt="" className="absolute top-4 right-4 w-12 sm:w-14 opacity-40" />
      <img src={rightCoin} alt="" className="absolute bottom-6 left-4 w-12 sm:w-14 opacity-40" />
    </div>
  );

  return (
    <>
      <LoadingOverlay isLoading={loading} status="Please Wait..." />
      <div className="relative min-h-screen w-full flex flex-col lg:flex-row overflow-hidden">
        {mobileCoins}
        {authCard}
        {rightSection}
      </div>
    </>
  );
};

export default LoginPage;
