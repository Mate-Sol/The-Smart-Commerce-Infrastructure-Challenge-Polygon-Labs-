import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import SolanaWalletProvider from './context/SolanaWalletProvider.jsx'

import { Buffer } from 'buffer'
if (typeof window !== 'undefined' && !window.Buffer) window.Buffer = Buffer

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <SolanaWalletProvider>
      <App />
    </SolanaWalletProvider>
  </StrictMode>,
)
