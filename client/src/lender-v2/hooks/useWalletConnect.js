/**
 * Wallet-connect hook — Chunk D1 swap: Freighter (Stellar) → wagmi (EVM).
 *
 * Same public API as the pre-swap version so pages that consumed it
 * (Dashboard, PoolDetails, Layout) keep working:
 *
 *   { connect, disconnect,
 *     walletAddress, walletStatus, walletError,
 *     usdcBalance,
 *     isConnected, isConnecting }
 *
 * Internally, this now bridges wagmi's `useAccount / useConnect /
 * useDisconnect / useReadContract` into the same Redux chainSlice
 * shape the rest of the lender-v2 UI reads.
 */

import { useEffect, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  useAccount,
  useConnect,
  useDisconnect,
  useReadContract,
} from 'wagmi';
import { formatUnits } from 'viem';
import { toast } from 'react-toastify';

import {
  setWalletConnecting,
  setWalletConnected,
  setWalletError,
  setUsdcBalance,
  disconnectWallet,
} from '@/store/chainSlice';

// Minimal ERC-20 fragment for balance reads.
const ERC20_BALANCE_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }],
  },
];

// Stablecoin address is env-driven per repo (see .env.example).
const STABLECOIN_ADDRESS = import.meta.env.VITE_STABLECOIN_ADDRESS || '';

export function useWalletConnect() {
  const dispatch = useDispatch();
  const chainState = useSelector((s) => s.chain);

  // ── wagmi hooks ──────────────────────────────────────────────────
  const { address, isConnected, isConnecting: wagmiConnecting, status } = useAccount();
  const { connectors, connectAsync, isPending: connectorPending } = useConnect();
  const { disconnectAsync } = useDisconnect();

  // ── Sync wagmi state → Redux ────────────────────────────────────
  // Redux keeps the historical shape { walletAddress, walletStatus, ... }
  // so other pages can useSelector without refactoring.
  useEffect(() => {
    if (isConnected && address) {
      dispatch(setWalletConnected(address));
    } else if (wagmiConnecting || connectorPending) {
      dispatch(setWalletConnecting());
    } else if (status === 'disconnected') {
      // Only reset if we had a wallet before — avoids stomping initial state.
      if (chainState.walletAddress) dispatch(disconnectWallet());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, address, wagmiConnecting, connectorPending, status, dispatch]);

  // ── USDC balance ────────────────────────────────────────────────
  const {
    data: usdcBalanceRaw,
    refetch: refetchBalance,
  } = useReadContract({
    address: STABLECOIN_ADDRESS || undefined,
    abi: ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: {
      enabled: !!(address && STABLECOIN_ADDRESS),
      // Refresh every ~15s while page is open so the wallet card doesn't
      // go stale after a deposit.
      refetchInterval: 15_000,
    },
  });

  useEffect(() => {
    if (usdcBalanceRaw !== undefined) {
      // USDC has 6 decimals on payfi_v1's MockStablecoin (matches real USDC).
      const formatted = Number(formatUnits(usdcBalanceRaw, 6));
      dispatch(setUsdcBalance(formatted < 0.000001 ? 0 : formatted));
    }
  }, [usdcBalanceRaw, dispatch]);

  // ── Actions ─────────────────────────────────────────────────────
  const connect = async () => {
    try {
      // Prefer the injected connector (MetaMask, Rabby, etc.) — RainbowKit
      // handles the modal separately if the caller wants the full UI.
      const injected = connectors.find((c) => c.type === 'injected') || connectors[0];
      if (!injected) throw new Error('No wallet connectors available');
      dispatch(setWalletConnecting());
      await connectAsync({ connector: injected });
      toast.success('Wallet connected.');
    } catch (err) {
      const msg = err?.shortMessage || err?.message || 'Wallet connection failed';
      dispatch(setWalletError(msg));
      toast.error(msg);
    }
  };

  const disconnect = async () => {
    try { await disconnectAsync(); } catch { /* wagmi throws if not connected */ }
    dispatch(disconnectWallet());
  };

  return useMemo(
    () => ({
      connect,
      disconnect,
      refetchBalance,
      walletAddress: chainState.walletAddress || address || null,
      walletStatus: chainState.walletStatus,
      walletError: chainState.walletError,
      usdcBalance: chainState.usdcBalance,
      isConnected,
      isConnecting: wagmiConnecting || connectorPending,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      chainState.walletAddress, chainState.walletStatus, chainState.walletError,
      chainState.usdcBalance, address, isConnected, wagmiConnecting, connectorPending,
    ]
  );
}
