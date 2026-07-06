require('dotenv').config();

// Sentry must be initialised BEFORE express is required so its
// instrumentation can wrap the framework. No-op if SENTRY_DSN is unset
// (so local dev / tests aren't affected).
if (process.env.SENTRY_DSN) {
  // eslint-disable-next-line global-require
  const Sentry = require('@sentry/node');
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENV || process.env.NODE_ENV || 'devnet-beta',
    tracesSampleRate: 0.1,
  });
}

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const connectDB = require('./config/database');

// Initialize express app
const app = express();

// Connect to MongoDB
connectDB();

// Initialize scheduled jobs (credit maintenance)
const { initializeScheduledJobs } = require('./config/scheduler');
const { startOverdueWatcher } = require('./workers/overdueWatcher');
// Chunk B3c: swap Solana indexer → EVM indexer. The EVM indexer refuses
// to boot until PAYFI_FACTORY_ADDRESS is set (guarded start), so dev envs
// without a deploy stay quiet instead of stack-tracing every 30s.
const { start: startEvmIndexer } = require('./workers/evmIndexer');
const { start: startPoolAggregatesIndexer } = require('./workers/poolAggregatesIndexer');

// CORS — accepts the configured production frontend AND any localhost
// origin so a local dev client (Vite on :5173 / :5174) can hit a
// server that's also configured for the deployed FRONTEND_URL. The
// dynamic `origin` callback whitelists per-request instead of using
// a single static string.
const allowedOrigins = new Set([
  process.env.FRONTEND_URL,
  // Extra allowed origins (comma-separated) for staging / preview deploys.
  ...(process.env.EXTRA_CORS_ORIGINS || '').split(',').map((s) => s.trim()),
].filter(Boolean));
app.use(cors({
  credentials: true,
  origin(origin, cb) {
    // No Origin header (curl, same-origin, server-to-server) — let it through.
    if (!origin) return cb(null, true);
    if (allowedOrigins.has(origin)) return cb(null, true);
    // Permissive for any localhost / 127.0.0.1 during dev.
    if (/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/.test(origin)) {
      return cb(null, true);
    }
    // Permissive for Vercel preview deploys (`*.vercel.app`). Production
    // hits the exact FRONTEND_URL above; previews get the wildcard.
    if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)) {
      return cb(null, true);
    }
    return cb(new Error(`CORS blocked: ${origin}`));
  },
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/public', express.static('public'));

// Rate limiting on the abuse-prone surfaces. 30 req/min/IP per group.
// Tune if legitimate users start hitting it. The `standardHeaders` flag
// emits RateLimit-* headers so the frontend can surface a friendly
// "slow down" UI if it ever wants to.
const sensitiveLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/auth', sensitiveLimiter);                 // login + nonce spam
app.use('/auth/wallet', sensitiveLimiter);          // SIWS spam
app.use('/faucet', sensitiveLimiter);               // mint abuse
app.use('/access-code/check', sensitiveLimiter);    // code-guess attempts
app.use('/access-code/redeem', sensitiveLimiter);   // race attempts

// Routes
app.use('/auth', require('./routes/auth'));
app.use('/auth/wallet', require('./routes/walletAuth'));
app.use('/psp', require('./routes/psp'));
app.use('/admin', require('./routes/admin'));
app.use('/maintenance', require('./routes/maintenance'));
app.use('/cfo', require('./routes/cfo'));
app.use('/external-psp', require('./routes/externalPsp'));
app.use('/webhook', require('./routes/webhook'));
app.use('/notifications', require('./routes/notification'));
app.use('/segment', require('./routes/segment'));
app.use('/support', require('./routes/support'));

// SAFE-Observer reconciliation integration (added 2026-04-11, see
// feat/observer-lifecycle-integration). Both mounts are additive — they
// do not modify any existing route or middleware.
//   /observer/*                     → service-key auth, called BY the
//                                     SAFE-Observer service to ingest
//                                     PayMate data.
//   /admin/credit-lines/.../lifecycle → JWT auth, called BY the admin UI
//                                     to render the reconciled lifecycle
//                                     view. Lives in its own router file
//                                     (routes/lifecycle.js); Express
//                                     merges it with the existing /admin
//                                     namespace cleanly.
app.use('/observer', require('./routes/observer'));
app.use('/admin', require('./routes/lifecycle'));
app.use('/faucet', require('./routes/faucet'));
app.use('/relay', require('./routes/relay'));
app.use('/pool', require('./routes/poolTx'));
app.use('/', require('./routes/facility'));
app.use('/', require('./routes/accessCode'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'CredMate PSP Backend is running' });
});

// Sentry error handler (must come AFTER all routes, BEFORE the generic
// fallback middleware below). No-op when SENTRY_DSN isn't set.
if (process.env.SENTRY_DSN) {
  // eslint-disable-next-line global-require
  const Sentry = require('@sentry/node');
  Sentry.setupExpressErrorHandler(app);
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Start server
const PORT = process.env.PORT || 5050;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

  // Start background workers
  startOverdueWatcher();
  initializeScheduledJobs();
  startEvmIndexer();
  // Chunk B3c: poolAggregatesIndexer is still Solana-only (uses
  // getConnection() + Anchor scans). Disabled until it's ported to EVM
  // events — the primary evmIndexer already keeps PoolState + DrawdownState
  // fresh, which is all the lender-v2 UI needs. Re-enable in a later
  // batch that ports it to ethers.
  // startPoolAggregatesIndexer();
});

module.exports = app;
