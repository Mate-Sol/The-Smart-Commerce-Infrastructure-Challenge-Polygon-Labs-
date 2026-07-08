import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider as ReduxProvider } from 'react-redux'
import './index.css'
import App from './App.jsx'
// Legacy Solana wallet stack — still wraps the tree so existing PSP /
// admin / onchain-admin / /lender/* pages that useWallet() from
// @solana/wallet-adapter-react keep rendering during the Chunk C→D swap.
// Removed once every page is on wagmi.
import SolanaWalletProvider from './context/SolanaWalletProvider.jsx'
// New EVM wallet stack — wagmi + RainbowKit + @tanstack/react-query.
// Every new page (lender-v2 and the retargeted PSP/admin flows) uses this.
import EvmWalletProvider from './context/EvmWalletProvider.jsx'
// Redux store lives inside the defa_v2 lender-v2 drop-in. Both the legacy
// portals (which don't need Redux) and the new lender-v2 pages (which do)
// wrap under the same Provider so useSelector/useDispatch resolve everywhere.
import { store } from './lender-v2/store/store.js'

// Sentry — only initialised when VITE_SENTRY_DSN is set so dev builds
// stay quiet. Browser tracer + replay are skipped to keep the bundle
// small; we just want unhandled-error capture for the beta.
if (import.meta.env.VITE_SENTRY_DSN) {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  import('@sentry/react').then(({ init }) => {
    init({
      dsn: import.meta.env.VITE_SENTRY_DSN,
      environment: import.meta.env.VITE_SENTRY_ENV || 'devnet-beta',
      tracesSampleRate: 0,
    })
  })
}

// Some wallet-adapter dependencies expect a `Buffer` global at runtime.
// Polyfill it before any wallet code initializes.
import { Buffer } from 'buffer'
if (typeof window !== 'undefined' && !window.Buffer) window.Buffer = Buffer

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ReduxProvider store={store}>
      <EvmWalletProvider>
        <SolanaWalletProvider>
          <App />
        </SolanaWalletProvider>
      </EvmWalletProvider>
    </ReduxProvider>
  </StrictMode>,
)
