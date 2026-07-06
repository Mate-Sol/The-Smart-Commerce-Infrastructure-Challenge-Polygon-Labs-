import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import SolanaWalletProvider from './context/SolanaWalletProvider.jsx'

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
    <SolanaWalletProvider>
      <App />
    </SolanaWalletProvider>
  </StrictMode>,
)
