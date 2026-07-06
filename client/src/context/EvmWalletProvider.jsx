import { useMemo } from 'react';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { defineChain } from 'viem';
import { RainbowKitProvider, getDefaultConfig } from '@rainbow-me/rainbowkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@rainbow-me/rainbowkit/styles.css';

/**
 * EvmWalletProvider — wraps the tree with wagmi + RainbowKit so any
 * descendant can call `useAccount()`, `useSignMessage()`,
 * `useSendTransaction()`, `useWriteContract()`, etc.
 *
 * The chain (Polygon Amoy / Arc testnet / anything else) is env-driven so
 * the SAME client code deploys to both hackathon repos. Set:
 *   VITE_CHAIN_ID              80002 (Polygon Amoy) | Arc testnet id
 *   VITE_RPC_URL               json-rpc endpoint
 *   VITE_CHAIN_NAME            display name
 *   VITE_CHAIN_NATIVE_SYMBOL   defaults to ETH
 *   VITE_CHAIN_EXPLORER_URL    optional
 *   VITE_WALLETCONNECT_PROJECT_ID  from WalletConnect Cloud (free tier)
 *
 * Note: this provider lives alongside the legacy SolanaWalletProvider in
 * main.jsx during the Solana → EVM swap. Legacy pages that still call
 * useWallet() from @solana/wallet-adapter-react continue to work; new
 * pages (lender-v2 + everything wired in Chunks C/D onward) use wagmi.
 */

const CHAIN_ID   = parseInt(import.meta.env.VITE_CHAIN_ID || '80002', 10);
const RPC_URL    = import.meta.env.VITE_RPC_URL || 'https://rpc-amoy.polygon.technology';
const CHAIN_NAME = import.meta.env.VITE_CHAIN_NAME || 'Polygon Amoy';
const NATIVE_SYMBOL = import.meta.env.VITE_CHAIN_NATIVE_SYMBOL || 'POL';
const NATIVE_DECIMALS = parseInt(import.meta.env.VITE_CHAIN_NATIVE_DECIMALS || '18', 10);
const EXPLORER_URL = import.meta.env.VITE_CHAIN_EXPLORER_URL || 'https://amoy.polygonscan.com';

// Define whichever chain we're pointed at as a viem custom chain. This
// works for Polygon Amoy, Arc testnet, or any other EVM-compatible RPC —
// no dependency on wagmi/chains adding native support for Arc.
const activeChain = defineChain({
  id: CHAIN_ID,
  name: CHAIN_NAME,
  nativeCurrency: { name: NATIVE_SYMBOL, symbol: NATIVE_SYMBOL, decimals: NATIVE_DECIMALS },
  rpcUrls: {
    default: { http: [RPC_URL] },
  },
  blockExplorers: {
    default: { name: 'Explorer', url: EXPLORER_URL },
  },
});

const config = getDefaultConfig({
  appName: 'DeFa',
  // Falling back to a demo project id is fine for local dev — WalletConnect
  // Cloud does not require an id for the injected/MetaMask connectors.
  // For production, set VITE_WALLETCONNECT_PROJECT_ID from WC Cloud.
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'defa-hackathon-demo',
  chains: [activeChain],
  transports: {
    [activeChain.id]: http(RPC_URL),
  },
  ssr: false,
});

// One QueryClient for the whole app. Wagmi requires it in the tree for
// its hook-based subscriptions to work.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      // Wallet-side balances shouldn't stay stale for long during a demo.
      staleTime: 15_000,
    },
  },
});

const EvmWalletProvider = ({ children }) => {
  // Freeze the config across renders — createConfig produces a new object
  // each call which would tear down the wagmi state on hot reloads.
  const wagmiConfig = useMemo(() => config, []);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>{children}</RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
};

export default EvmWalletProvider;
export { activeChain, CHAIN_ID, CHAIN_NAME };
