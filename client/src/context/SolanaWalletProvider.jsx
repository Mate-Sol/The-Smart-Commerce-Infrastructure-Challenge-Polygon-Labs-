import { useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { clusterApiUrl } from '@solana/web3.js';
import '@solana/wallet-adapter-react-ui/styles.css';

/**
 * SolanaWalletProvider — wraps the React tree with the wallet-adapter
 * stack so any descendant can call `useWallet()` / `useConnection()`.
 *
 *   <SolanaWalletProvider>
 *     <App />
 *   </SolanaWalletProvider>
 *
 * Cluster is configurable via VITE_SOLANA_CLUSTER (devnet | mainnet-beta).
 * Adapters: Phantom + Solflare. Backpack/Glow can be added by importing
 * their adapters from @solana/wallet-adapter-wallets.
 */
const SolanaWalletProvider = ({ children }) => {
  const cluster = import.meta.env.VITE_SOLANA_CLUSTER || 'devnet';
  const endpoint = useMemo(() => {
    return import.meta.env.VITE_SOLANA_RPC_URL || clusterApiUrl(cluster);
  }, [cluster]);

  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};

export default SolanaWalletProvider;
