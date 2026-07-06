import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom']
  },
  define: {
    // Some Solana wallet adapter deps reference `process.env.*`; vite doesn't
    // shim that by default. Empty stub keeps them from crashing at import.
    'process.env': {},
    global: 'globalThis',
  },
  optimizeDeps: {
    // Pre-bundle these; otherwise the wallet-adapter ESM/CJS interop blows
    // up at runtime in dev mode.
    include: [
      '@solana/web3.js',
      '@solana/wallet-adapter-base',
      '@solana/wallet-adapter-react',
      '@solana/wallet-adapter-react-ui',
      '@solana/wallet-adapter-wallets',
      'buffer',
    ],
  },
})
