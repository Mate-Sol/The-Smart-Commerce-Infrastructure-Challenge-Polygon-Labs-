/**
 * Pool transaction-building endpoints. Each route returns a base64-encoded
 * unsigned tx for the authenticated caller. The caller signs in their
 * wallet adapter and submits via /relay/submit (which adds the fee-payer
 * signature so the user never needs SOL).
 *
 * Auth model:
 *   /lender/* — JWT.kind === 'lender'. Uses req.user.wallet directly.
 *   /psp/*    — JWT.role === 'PSP'. Uses PSPProfile.solanaWallet (must be bound).
 *   /admin/*  — JWT.role in {KAM, CAD, CRO, CFO, ...}. Uses User.solanaWallet
 *               (must be bound via /auth/wallet/bind).
 *
 * The actual on-chain authorization is enforced by the program (`has_one`
 * constraints on the pool admin, signer constraint on `psp == pool.psp_wallet`,
 * etc.). This route layer is just a UX/policy gate — building a tx for the
 * wrong role still returns a tx, but submitting it would fail at the program.
 */

const express = require('express');
const router = express.Router();
const { PublicKey } = require('@solana/web3.js');
const { getAccount, getMint, getAssociatedTokenAddressSync } = require('@solana/spl-token');

const { authMiddleware, authorizeRoles } = require('../middleware/auth');
const PSPProfile = require('../models/PSPProfile');
const User = require('../models/User');
const ps = require('../services/poolService');
const { getConnection, getUsdcDfMint } = require('../services/solanaService');

// ─── Lender endpoints ───────────────────────────────────────────────────────

router.post('/lender/build-tx/deposit', authMiddleware, async (req, res) => {
  try {
    if (req.user.kind !== 'lender') {
      return res.status(403).json({ message: 'Lender JWT required' });
    }
    const { pool, amount } = req.body || {};
    if (!pool || !amount) {
      return res.status(400).json({ message: 'pool and amount required' });
    }
    const out = await ps.buildDepositTx({ pool, lender: req.user.wallet, amount });
    res.json(out);
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

router.post('/lender/build-tx/withdraw', authMiddleware, async (req, res) => {
  try {
    if (req.user.kind !== 'lender') {
      return res.status(403).json({ message: 'Lender JWT required' });
    }
    const { pool, amount } = req.body || {};
    if (!pool || !amount) {
      return res.status(400).json({ message: 'pool and amount required' });
    }
    const out = await ps.buildWithdrawFundingTx({ pool, lender: req.user.wallet, amount });
    res.json(out);
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

router.post('/lender/build-tx/redeem', authMiddleware, async (req, res) => {
  try {
    if (req.user.kind !== 'lender') {
      return res.status(403).json({ message: 'Lender JWT required' });
    }
    const { pool, lpAmount } = req.body || {};
    if (!pool || !lpAmount) {
      return res.status(400).json({ message: 'pool and lpAmount required' });
    }
    const out = await ps.buildRedeemLpTx({ pool, lender: req.user.wallet, lpAmount });
    res.json(out);
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

// ─── PSP endpoints ─────────────────────────────────────────────────────────

async function loadPspWallet(req, res) {
  const profile = await PSPProfile.findOne({ userId: req.user.userId });
  if (!profile) {
    res.status(404).json({ message: 'PSP profile not found' });
    return null;
  }
  if (!profile.solanaWallet) {
    res.status(409).json({
      message: 'PSP wallet not bound; call /auth/wallet/bind first',
    });
    return null;
  }
  return profile;
}

// Resolve a Facility from the {pool} passed in the body and confirm the
// caller owns it. Returns null + writes a response on failure.
async function loadOwnedFacility(req, res, profile) {
  const Facility = require('../models/Facility');
  const pool = req.body?.pool;
  if (!pool) {
    res.status(400).json({ message: 'pool (facility poolPda) required' });
    return null;
  }
  const facility = await Facility.findOne({ pspProfileId: profile._id, poolPda: pool });
  if (!facility) {
    res.status(404).json({ message: 'Facility not found for this PSP' });
    return null;
  }
  return facility;
}

router.post(
  '/psp/build-tx/drawdown',
  authMiddleware,
  authorizeRoles('PSP'),
  async (req, res) => {
    try {
      const { amount, tenorDays } = req.body || {};
      if (!amount || !tenorDays) {
        return res.status(400).json({ message: 'amount and tenorDays required' });
      }
      const profile = await loadPspWallet(req, res);
      if (!profile) return;
      const facility = await loadOwnedFacility(req, res, profile);
      if (!facility) return;

      // Authoritative drawdown id from on-chain state.
      const pool = await ps.fetchPool(facility.poolPda);
      const drawdownId = pool.nextDrawdownId.toString();

      const out = await ps.buildRequestDrawdownTx({
        pool: facility.poolPda,
        psp: profile.solanaWallet,
        drawdownId,
        amount,
        tenorDays,
      });
      res.json({ ...out, drawdownId });
    } catch (e) {
      res.status(400).json({ message: e.message });
    }
  }
);

router.post(
  '/psp/build-tx/repay',
  authMiddleware,
  authorizeRoles('PSP'),
  async (req, res) => {
    try {
      const { drawdownId } = req.body || {};
      if (drawdownId === undefined || drawdownId === null) {
        return res.status(400).json({ message: 'drawdownId required' });
      }
      const profile = await loadPspWallet(req, res);
      if (!profile) return;
      const facility = await loadOwnedFacility(req, res, profile);
      if (!facility) return;
      const out = await ps.buildRepayTx({
        pool: facility.poolPda,
        psp: profile.solanaWallet,
        drawdownId,
      });
      res.json(out);
    } catch (e) {
      res.status(400).json({ message: e.message });
    }
  }
);

// Called by the PSP UI immediately after a successful drawdown relay
// to transition the off-chain FinancingRequest from `AwaitingDrawdown`
// to `Disbursed`. Without this, /psp/next-actions keeps surfacing the
// "Sign Drawdown" CTA forever even though the on-chain tx already
// landed.
//
// The on-chain side is authoritative — we don't trust the supplied
// signature alone. We re-fetch the Drawdown PDA (derived from pool +
// drawdownId) and require it to exist; otherwise we refuse to mark
// the financing disbursed.
router.post(
  '/psp/financing/:financingId/mark-disbursed',
  authMiddleware,
  authorizeRoles('PSP'),
  async (req, res) => {
    try {
      const FinancingRequest = require('../models/FinancingRequest');
      const profile = await loadPspWallet(req, res);
      if (!profile) return;

      const { drawdownId, signature, poolPda } = req.body || {};
      if (drawdownId === undefined || drawdownId === null) {
        return res.status(400).json({ message: 'drawdownId required' });
      }
      if (!poolPda) {
        return res.status(400).json({ message: 'poolPda required' });
      }

      const fr = await FinancingRequest.findOne({
        _id: req.params.financingId,
        pspId: profile._id,
      });
      if (!fr) return res.status(404).json({ message: 'Financing request not found' });

      // Idempotent: already moved past AwaitingDrawdown? Just return current.
      if (fr.status !== 'AwaitingDrawdown') {
        return res.json({ ok: true, status: fr.status, alreadyConfirmed: true });
      }

      // Verify the on-chain drawdown actually exists. Refuse to flip
      // status off a forged signature/drawdownId.
      const poolPk = new PublicKey(poolPda);
      const [drawdownPda] = ps.deriveDrawdown(poolPk, drawdownId);
      let dd;
      try {
        dd = await ps.getProgram().account.drawdown.fetch(drawdownPda);
      } catch {
        return res.status(409).json({ message: 'Drawdown PDA not found on-chain — relay may not have confirmed yet' });
      }

      const disbursedAt = new Date();
      disbursedAt.setHours(0, 0, 0, 0);
      const tenor = Number(dd.tenorDays) || Number(fr.drawdownTenor) || 5;

      fr.status        = 'Disbursed';
      fr.drawdownId    = Number(drawdownId);
      fr.drawdownPda   = drawdownPda.toBase58();
      fr.poolPda       = poolPda;
      fr.disbursedAt   = disbursedAt;
      fr.dueDate       = new Date(disbursedAt.getTime() + (tenor - 1) * 86400000);
      if (signature) fr.txHash = signature;
      await fr.save();

      res.json({
        ok: true,
        status: fr.status,
        drawdownPda: drawdownPda.toBase58(),
        drawdownId: fr.drawdownId,
      });
    } catch (e) {
      console.error('[/psp/financing/:id/mark-disbursed]', e);
      res.status(500).json({ message: e.message });
    }
  }
);

router.post(
  '/psp/build-tx/settle-commit-fee',
  authMiddleware,
  authorizeRoles('PSP'),
  async (req, res) => {
    try {
      const profile = await loadPspWallet(req, res);
      if (!profile) return;
      const facility = await loadOwnedFacility(req, res, profile);
      if (!facility) return;
      const out = await ps.buildSettleCommitFeeTx({
        pool: facility.poolPda,
        psp: profile.solanaWallet,
      });
      res.json(out);
    } catch (e) {
      res.status(400).json({ message: e.message });
    }
  }
);

// ─── Admin endpoints ───────────────────────────────────────────────────────

// ONCHAIN_ADMIN is the wallet-only role responsible for signing every
// program-side instruction. KAM/CAD/CRO/CFO/LEGAL retain build-tx access
// for backward-compat / multi-admin scenarios; in normal flow the on-chain
// admin owns initialize/execute/cancel/claim/default.
const ADMIN_ROLES = ['KAM', 'CAD', 'CRO', 'CFO', 'LEGAL_ADMIN', 'ONCHAIN_ADMIN'];

// In-memory map of pool-name overrides. On-chain pspName is immutable
// but Mongo overrides let us relabel pools for demos / rebrands.
// Refreshed at process boot + after every admin relabel. Synchronous
// lookup so serializers don't need to await.
const _nameOverride = new Map();
async function reloadNameOverrides() {
  const PoolNameOverride = require('../models/PoolNameOverride');
  const rows = await PoolNameOverride.find({}).select('poolPda displayName').lean();
  _nameOverride.clear();
  for (const r of rows) _nameOverride.set(r.poolPda, r.displayName);
}
function nameFor(poolPda, onchainFallback) {
  return _nameOverride.get(poolPda) || onchainFallback;
}
// Best-effort preload — failures (DB not yet connected at module load)
// are swallowed; we'll fall back to on-chain names until the first
// relabel call triggers a refresh.
setTimeout(() => { reloadNameOverrides().catch(() => {}); }, 2000);

// Slice the daily-activity `days` array into a page (newest day first) and
// emit pagination metadata so the UI can render Prev / Next controls.
// Always returns `days` plus `pagination`. Defaults: page=1, limit=30.
// Accepts limit values 1..200; clamps outside that range.
function paginate(days, pageParam, limitParam) {
  const totalDays = days.length;
  const limit = Math.max(1, Math.min(200, Number(limitParam) || 30));
  const totalPages = Math.max(1, Math.ceil(totalDays / limit));
  const page = Math.max(1, Math.min(totalPages, Number(pageParam) || 1));
  // Newest first — UI usually wants the latest day at the top of page 1.
  const reversed = days.slice().reverse();
  const start = (page - 1) * limit;
  const slice = reversed.slice(start, start + limit);
  return {
    days: slice,
    pagination: {
      page,
      limit,
      totalDays,
      totalPages,
      hasPrev: page > 1,
      hasNext: page < totalPages,
    },
  };
}

async function loadAdminWallet(req, res) {
  const user = await User.findById(req.user.userId);
  if (!user || !user.solanaWallet) {
    res.status(409).json({
      message: 'Admin wallet not bound; call /auth/wallet/bind first',
    });
    return null;
  }
  return user;
}

router.post(
  '/admin/build-tx/initialize-pool',
  authMiddleware,
  authorizeRoles(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const { facilityDocId, overrides } = req.body || {};
      if (!facilityDocId) {
        return res.status(400).json({ message: 'facilityDocId required' });
      }
      const admin = await loadAdminWallet(req, res);
      if (!admin) return;

      const Facility = require('../models/Facility');
      const facility = await Facility.findById(facilityDocId).populate('pspProfileId', 'companyName');
      if (!facility) return res.status(404).json({ message: 'Facility not found' });
      if (facility.status !== 'AWAITING_POOL_INIT') {
        return res.status(409).json({
          message: 'Facility not in AWAITING_POOL_INIT state',
          state: facility.status,
        });
      }

      // Pre-flight: any of the three init'd PDAs (pool, vault, lp_mint)
      // existing on-chain will cause a cryptic SystemProgram failure:
      //   "Allocate: account <pubkey> already in use" → custom program error 0x0
      // We use the RAW getAccountInfo helper (not Anchor's typed fetch) so
      // we also catch zombie accounts with a stale layout — the typed
      // decoder would throw and we'd otherwise let the build proceed.
      try {
        const checks = await Promise.all([
          ps.accountExists(facility.poolPda).then((e) => e ? 'pool'    : null),
          ps.accountExists(facility.vaultPda).then((e) => e ? 'vault'   : null),
          ps.accountExists(facility.lpMintPda).then((e) => e ? 'lp_mint' : null),
        ]);
        const collisions = checks.filter(Boolean);
        if (collisions.length) {
          return res.status(409).json({
            message:
              `On-chain ${collisions.join(' + ')} PDA(s) already exist for ` +
              `(psp_wallet, facility_id=${facility.facilityId}). Reject this facility ` +
              `request and have the PSP submit a new one — it'll get a fresh facility_id ` +
              `and fresh PDAs. (Devnet artifacts from prior tests can't be deleted, only ` +
              `bumped past.)`,
            code: 'PDA_ALREADY_EXISTS',
            collisions,
            poolPda:   facility.poolPda,
            vaultPda:  facility.vaultPda,
            lpMintPda: facility.lpMintPda,
            facilityId: facility.facilityId,
          });
        }
      } catch (e) {
        // RPC blip — log and let the build proceed; the real error will
        // still surface from the build itself if anything's actually wrong.
        console.warn('[initialize-pool pre-flight] PDA check failed:', e.message);
      }

      // CRO-approved values are the source of truth. Admin can override at
      // sign time (e.g. last-minute cap tweak) — overrides win.
      const t = facility.approvedTerms || {};
      const o = overrides || {};
      const softCapUsd        = Number(o.softCapUsd          ?? t.softCap        ?? t.creditLine ?? 0);
      const hardCapUsd        = Number(o.hardCapUsd          ?? t.hardCap        ?? t.creditLine ?? 0);
      const maxDrawdownUsd    = Number(o.maxDrawdownUsd      ?? t.maxDrawdownAmount ?? t.creditLine ?? 0);
      const facilityTenorDays = Number(o.facilityTenorDays   ?? t.tenorDays);
      const utilizationRateBps = Number(o.utilizationRateBps ?? t.utilizationRateBps);
      const commitmentRateBps  = Number(o.commitmentRateBps  ?? t.commitmentRateBps);
      const penaltyRateBps     = Number(o.penaltyRateBps     ?? t.penaltyRateBps);
      const graceDays          = Number(o.graceDays          ?? t.graceDays   ?? 1);
      const penaltyDays        = Number(o.penaltyDays        ?? t.penaltyDays ?? 30);
      const protocolFeeShareBps = Number(o.protocolFeeShareBps ?? 1000);
      // Test-mode "day length". 86_400 = real day; 300 = 5min/day, etc.
      // Contract enforces the same range (60..=86_400).
      const secondsPerDay = Number(o.secondsPerDay ?? t.secondsPerDay ?? 86_400);

      const errs = [];
      if (!(softCapUsd > 0)) errs.push('softCap must be > 0');
      if (!(hardCapUsd >= softCapUsd)) errs.push('hardCap must be >= softCap');
      if (!(maxDrawdownUsd > 0)) errs.push('maxDrawdown must be > 0');
      if (!(maxDrawdownUsd <= hardCapUsd)) errs.push('maxDrawdown must be <= hardCap');
      if (!(facilityTenorDays > 0)) errs.push('facilityTenorDays must be > 0');
      if (!(utilizationRateBps > 0)) errs.push('utilizationRateBps must be > 0');
      if (!(protocolFeeShareBps >= 0 && protocolFeeShareBps <= 10000)) errs.push('protocolFeeShareBps must be 0..10000');
      if (graceDays < 0 || graceDays > 255) errs.push('graceDays must be 0..255');
      if (penaltyDays < 0 || penaltyDays > 255) errs.push('penaltyDays must be 0..255');
      if (!(secondsPerDay >= 60 && secondsPerDay <= 86_400)) errs.push('secondsPerDay must be 60..86400');
      if (errs.length) {
        return res.status(400).json({ message: 'Invalid pool params', errors: errs });
      }

      // Persist resolved params back to approvedTerms so the next modal open
      // reflects what's about to be signed.
      facility.approvedTerms = {
        ...facility.approvedTerms,
        creditLine: hardCapUsd,
        tenorDays: facilityTenorDays,
        utilizationRateBps,
        commitmentRateBps,
        penaltyRateBps,
        graceDays,
        penaltyDays,
        maxDrawdownAmount: maxDrawdownUsd,
        softCap: softCapUsd,
        hardCap: hardCapUsd,
        secondsPerDay,
      };
      await facility.save();

      const toBase = (usd) => BigInt(Math.round(Number(usd) * 1_000_000));

      // On-chain pool name. Admin can override at init time (the field
      // shows up in every portal's facility list / detail, so a clean
      // name beats the auto-derived companyName). Falls back to the
      // PSP's companyName, then the facility label, then 'PSP'. 32-char
      // hard cap matches the on-chain string field length.
      const rawName = (o.poolName || facility.pspProfileId?.companyName || facility.label || 'PSP');
      const pspName = String(rawName).slice(0, 32);

      const out = await ps.buildInitializePoolTx({
        admin: admin.solanaWallet,
        pspWallet: facility.pspWallet,
        pspName,
        facilityId: facility.facilityId,
        softCap: toBase(softCapUsd).toString(),
        hardCap: toBase(hardCapUsd).toString(),
        maxDrawdownAmount: toBase(maxDrawdownUsd).toString(),
        facilityTenorDays,
        utilizationRateBps,
        commitmentRateBps,
        penaltyRateBps,
        graceDays,
        penaltyDays,
        protocolFeeShareBps,
        secondsPerDay,
      });

      res.json({
        ...out,
        facilityDocId: facility._id,
        facilityId: facility.facilityId,
        pspWallet: facility.pspWallet,
        resolved: {
          softCapUsd, hardCapUsd, maxDrawdownUsd, facilityTenorDays,
          utilizationRateBps, commitmentRateBps, penaltyRateBps,
          graceDays, penaltyDays, protocolFeeShareBps, secondsPerDay,
        },
      });
    } catch (e) {
      console.error('[initialize-pool]', e);
      res.status(400).json({ message: e.message });
    }
  }
);

router.post(
  '/admin/build-tx/execute-facility',
  authMiddleware,
  authorizeRoles(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const { pool } = req.body || {};
      if (!pool) return res.status(400).json({ message: 'pool required' });
      const admin = await loadAdminWallet(req, res);
      if (!admin) return;
      const out = await ps.buildExecuteFacilityTx({ pool, admin: admin.solanaWallet });
      res.json(out);
    } catch (e) {
      res.status(400).json({ message: e.message });
    }
  }
);

router.post(
  '/admin/build-tx/cancel-funding',
  authMiddleware,
  authorizeRoles(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const { pool } = req.body || {};
      if (!pool) return res.status(400).json({ message: 'pool required' });
      const admin = await loadAdminWallet(req, res);
      if (!admin) return;
      const out = await ps.buildCancelFundingTx({ pool, admin: admin.solanaWallet });
      res.json(out);
    } catch (e) {
      res.status(400).json({ message: e.message });
    }
  }
);

router.post(
  '/admin/build-tx/claim-protocol-fees',
  authMiddleware,
  authorizeRoles(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const { pool } = req.body || {};
      if (!pool) return res.status(400).json({ message: 'pool required' });
      const admin = await loadAdminWallet(req, res);
      if (!admin) return;
      const out = await ps.buildClaimProtocolFeesTx({ pool, admin: admin.solanaWallet });
      res.json(out);
    } catch (e) {
      res.status(400).json({ message: e.message });
    }
  }
);

router.post(
  '/admin/build-tx/declare-default',
  authMiddleware,
  authorizeRoles(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const { pool } = req.body || {};
      if (!pool) return res.status(400).json({ message: 'pool required' });
      const admin = await loadAdminWallet(req, res);
      if (!admin) return;
      const out = await ps.buildDeclareDefaultTx({ pool, admin: admin.solanaWallet });
      res.json(out);
    } catch (e) {
      res.status(400).json({ message: e.message });
    }
  }
);

// ─── Admin lifecycle helpers ───────────────────────────────────────────────

router.get(
  '/admin/pending-pool-inits',
  authMiddleware,
  authorizeRoles(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const Facility = require('../models/Facility');
      const pending = await Facility.find({ status: 'AWAITING_POOL_INIT' })
        .populate('pspProfileId', 'companyName solanaWallet')
        .sort({ croApprovedAt: 1 });
      res.json(pending.map((f) => ({
        _id: f._id,
        facilityId: f.facilityId,
        label: f.label,
        pspWallet: f.pspWallet,
        companyName: f.pspProfileId?.companyName || '',
        poolPda: f.poolPda,
        vaultPda: f.vaultPda,
        lpMintPda: f.lpMintPda,
        approvedTerms: f.approvedTerms,
        croApprovedAt: f.croApprovedAt,
        requestedAt: f.requestedAt,
        isFirstFacility: f.isFirstFacility,
      })));
    } catch (e) {
      console.error('[pending-pool-inits]', e);
      res.status(500).json({ message: e.message });
    }
  }
);

router.post(
  '/admin/confirm-pool-init/:facilityDocId',
  authMiddleware,
  authorizeRoles(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const Facility = require('../models/Facility');
      const facility = await Facility.findById(req.params.facilityDocId);
      if (!facility) return res.status(404).json({ message: 'Facility not found' });
      if (facility.status !== 'AWAITING_POOL_INIT') {
        return res.status(409).json({
          message: 'Facility not in AWAITING_POOL_INIT',
          state: facility.status,
        });
      }

      // Verify the pool actually exists on-chain before flipping state.
      const onChain = await ps.fetchPoolMaybe(facility.poolPda);
      if (!onChain) {
        return res.status(409).json({
          message: 'Pool PDA not found on-chain yet; admin tx may still be confirming',
          poolPda: facility.poolPda,
        });
      }

      facility.status = 'FUNDING';
      facility.initializedAt = new Date();
      facility.initializeTxSig = req.body?.txSig || '';
      await facility.save();

      res.json({
        success: true,
        facilityDocId: facility._id,
        facilityId: facility.facilityId,
        pool: facility.poolPda,
        status: facility.status,
      });
    } catch (e) {
      console.error('[confirm-pool-init]', e);
      res.status(500).json({ message: e.message });
    }
  }
);

// ─── Read-only state endpoints ──────────────────────────────────────────────
//
// Frontend uses these to render pool state directly from chain rather than
// the slower-cycle Mongo mirror.

// ─── Lender portfolio (aggregated positions across all pools) ──────────────

// Lifetime cash-flow totals for one lender on one pool: deposits,
// funding withdrawals, and LP redemptions. Reads from the indexed
// PoolEvent collection — the previous direct-RPC scan was the single
// biggest source of latency in /lender/portfolio (1000 sigs ×
// getTransaction PER pool the lender held).
//
// Cold path: if the indexer hasn't bootstrapped this pool, do an
// inline syncOne so the first request is correct.
async function fetchLenderHistoryForPool(_conn, _program, poolPubkey, lenderWallet) {
  const PoolEvent = require('../models/PoolEvent');
  const PoolAggregates = require('../models/PoolAggregates');
  const lenderStr = lenderWallet.toBase58();
  const poolStr = poolPubkey.toBase58 ? poolPubkey.toBase58() : String(poolPubkey);

  const agg = await PoolAggregates.findOne({ pubkey: poolStr }).lean();
  if (!agg || !agg.bootstrapped) {
    try {
      const { tryInlineSync } = require('../workers/poolAggregatesIndexer');
      await tryInlineSync(poolStr);
    } catch (e) {
      console.warn('[fetchLenderHistoryForPool] inline bootstrap failed:', e.message);
    }
  }

  const evs = await PoolEvent.find({
    pool: poolStr,
    lender: lenderStr,
    name: { $in: ['Deposited', 'WithdrawnFunding', 'LpRedeemed'] },
  }).lean();

  let deposited = 0n;
  let withdrawn = 0n;
  let redeemed  = 0n;
  for (const ev of evs) {
    const d = ev.data || {};
    if (ev.name === 'Deposited' && d.amount) deposited += BigInt(d.amount);
    else if (ev.name === 'WithdrawnFunding' && d.amount) withdrawn += BigInt(d.amount);
    else if (ev.name === 'LpRedeemed' && d.usdcPaid) redeemed += BigInt(d.usdcPaid);
  }
  return { deposited, withdrawn, redeemed };
}

router.get('/lender/portfolio', authMiddleware, async (req, res) => {
  try {
    if (req.user.kind !== 'lender') {
      return res.status(403).json({ message: 'Lender JWT required' });
    }
    const conn = getConnection();
    const program = ps.getProgram();
    const lender = new PublicKey(req.user.wallet);
    const usdcMint = getUsdcDfMint();

    // Lender's free USDC-DF balance (not yet deposited).
    let walletUsdc = '0';
    try {
      const ata = getAssociatedTokenAddressSync(usdcMint, lender);
      const acc = await getAccount(conn, ata);
      walletUsdc = acc.amount.toString();
    } catch {}

    const allPools = await ps.fetchAllPools();

    // For each pool, pull both current LP balance AND lifetime event totals
    // so that closed positions (current LP = 0 but lender previously
    // deposited + redeemed) still appear with their realized yield.
    const positions = [];
    let totalDepositedBase   = 0n;  // lifetime principal contributed (net of funding withdrawals)
    let totalRedeemableBase  = 0n;  // current redeemable from open positions
    let totalRealizedBase    = 0n;  // realized yield from closed-out redemptions
    let totalUnrealizedBase  = 0n;  // unrealized yield in open positions

    // Freshness pass: trigger an incremental indexer sync ONLY for held
    // pools whose cached aggregates doc is stale (older than the
    // freshness window) or never bootstrapped. Done sequentially with a
    // small delay so we don't fan out N getTransaction calls at once.
    // Devnet public RPC will 429 on bursts >10/sec, so we stay polite.
    const heldPools = [];
    for (const p of allPools) {
      const [lpMintPda] = ps.deriveLpMint(p.publicKey);
      const lpAta = getAssociatedTokenAddressSync(lpMintPda, lender);
      try {
        await getAccount(conn, lpAta);
        heldPools.push(p);
      } catch { /* ATA never existed — definitely never deposited here */ }
    }
    const FRESHNESS_WINDOW_MS = parseInt(process.env.LENDER_PORTFOLIO_FRESHNESS_MS || '20000', 10);
    try {
      const PoolAggregates = require('../models/PoolAggregates');
      const { tryInlineSync } = require('../workers/poolAggregatesIndexer');
      const now = Date.now();
      for (const p of heldPools) {
        const pubkey = p.publicKey.toBase58();
        const agg = await PoolAggregates.findOne({ pubkey }).lean();
        const stale = !agg || !agg.bootstrapped ||
          !agg.lastSyncedAt || (now - new Date(agg.lastSyncedAt).getTime() > FRESHNESS_WINDOW_MS);
        if (!stale) continue;
        const r = await tryInlineSync(pubkey);
        if (r?.skipped === 'rate limited') {
          console.warn('[/lender/portfolio] RPC 429 — using stale aggregates and moving on');
          break;
        }
      }
    } catch (e) {
      console.warn('[/lender/portfolio] freshness sync failed:', e.message);
    }

    for (const p of heldPools) {
      const [lpMintPda] = ps.deriveLpMint(p.publicKey);
      const lpAta = getAssociatedTokenAddressSync(lpMintPda, lender);
      let lpBalance = 0n;
      try {
        const lpAcc = await getAccount(conn, lpAta);
        lpBalance = lpAcc.amount;
      } catch { continue; }

      // Scan event history for this lender on this pool.
      const history = await fetchLenderHistoryForPool(conn, program, p.publicKey, lender);
      // If they never deposited here, skip even though the ATA exists.
      if (history.deposited === 0n) continue;

      // Compute current redemption value.
      const lpMint = await getMint(conn, lpMintPda);
      const vault  = await getAccount(conn, p.account.vault);
      const vaultBalance = vault.amount;
      const protocolFeesOwed = BigInt(p.account.protocolFeesOwed.toString());
      const redemptionBase = vaultBalance > protocolFeesOwed ? vaultBalance - protocolFeesOwed : 0n;
      const lpSupply = lpMint.supply;
      const redeemable = lpSupply > 0n ? (lpBalance * redemptionBase) / lpSupply : 0n;

      // Cash-flow accounting:
      //   net principal contributed = deposited − withdrawn (during funding)
      //   total received so far     = redeemed (from past LP burns)
      //   total receivable          = redeemed + redeemable (now)
      //   realized yield            = redeemed − net principal (if redeemed > net)
      //   unrealized yield          = redeemable − (net principal − redeemed_principal_share)
      // We surface the simple, intuitive values: principal in, value out so far,
      // value still claimable, and realized + unrealized yield.
      const principalIn       = history.deposited - history.withdrawn;
      const realizedYield     = history.redeemed > principalIn
                                  ? history.redeemed - principalIn
                                  : 0n;
      const unrealizedYield   = redeemable + history.redeemed > principalIn
                                  ? (redeemable + history.redeemed) - principalIn - realizedYield
                                  : 0n;
      // Lender's share of accrued-but-not-yet-settled commit fee. When PSP
      // eventually calls settle_commit_fee, that amount lands in the vault
      // (minus protocol cut) and shows up in `redeemable`. Until then it's
      // sitting in `pool.accrued_commit_fee` and isn't yet captured by
      // `unrealizedYield` (which only sees vault state).
      const accruedCommit     = BigInt(p.account.accruedCommitFee.toString());
      const protocolBps       = BigInt(p.account.protocolFeeShareBps);
      const lenderCommitPending = lpSupply > 0n && accruedCommit > 0n
        ? (accruedCommit * (10000n - protocolBps) * lpBalance) / (10000n * lpSupply)
        : 0n;
      // Outstanding = everything the lender will receive on top of principal
      // when the facility closes cleanly: their share of (a) yield already
      // in vault but not yet redeemed, and (b) commit fee waiting to settle.
      const outstandingYield  = unrealizedYield + lenderCommitPending;

      // Lender's share of in-flight util / penalty fees on active drawdowns
      // (not yet paid by PSP). Added on top of `outstandingYield` to give
      // the full "Total Yield Pending" the lender will eventually receive.
      const today = Math.floor(Date.now() / 1000 / (p.account.secondsPerDay || 86_400));
      let utilFeePendingPool    = 0n;
      let penaltyFeePendingPool = 0n;
      try {
        const active = await ps.fetchActiveDrawdownsForPool(p.publicKey);
        for (const dd of active) {
          const principal = BigInt(dd.account.principal.toString());
          const daysActive = today - dd.account.drawdownDay + 1;
          const normalMax  = dd.account.tenorDays + p.account.graceDays;
          const utilDays   = Math.min(Math.max(0, daysActive), normalMax);
          const penaltyDays= Math.max(0, daysActive - normalMax);
          utilFeePendingPool    += (principal * BigInt(p.account.utilizationRateBps) * BigInt(utilDays))    / 10000n;
          penaltyFeePendingPool += (principal * BigInt(p.account.penaltyRateBps)     * BigInt(penaltyDays)) / 10000n;
        }
      } catch { /* leave 0 if drawdown fetch fails */ }
      const lenderUtilPending = lpSupply > 0n
        ? (utilFeePendingPool * (10000n - protocolBps) * lpBalance) / (10000n * lpSupply)
        : 0n;
      const lenderPenaltyPending = lpSupply > 0n
        ? (penaltyFeePendingPool * (10000n - protocolBps) * lpBalance) / (10000n * lpSupply)
        : 0n;
      // Full pending yield from the lender's POV: vault remainder share
      // + commit-fee share + in-flight util/penalty share. This is what
      // the FacilityCard's "Total Yield Pending" should display when a
      // position is present.
      const pendingYieldLender = outstandingYield + lenderUtilPending + lenderPenaltyPending;
      // Loss case (haircut on default): negative net. Surface 0 yield + a
      // separate `realizedLoss` field so the UI can flag it.
      const realizedLoss      = history.redeemed > 0n && lpBalance === 0n && history.redeemed < principalIn
                                  ? principalIn - history.redeemed
                                  : 0n;

      totalDepositedBase   += principalIn;
      totalRedeemableBase  += redeemable;
      totalRealizedBase    += realizedYield;
      totalUnrealizedBase  += unrealizedYield;

      positions.push({
        pool: p.publicKey.toBase58(),
        pspName: nameFor(p.publicKey.toBase58(), p.account.pspName),
        isActive: p.account.isActive,
        isCancelled: p.account.isCancelled,
        isDefaulted: p.account.isDefaulted,
        facilityId: p.account.facilityId.toString(),
        // Current state
        lpBalance: lpBalance.toString(),
        lpSupply: lpSupply.toString(),
        redeemable: redeemable.toString(),
        sharePctNum: lpSupply > 0n ? Number((lpBalance * 10000n) / lpSupply) / 100 : 0,
        // Lifetime cash flow (event-derived)
        lifetimeDeposited: history.deposited.toString(),
        lifetimeWithdrawn: history.withdrawn.toString(),
        lifetimeRedeemed:  history.redeemed.toString(),
        principalIn:       principalIn.toString(),
        realizedYield:     realizedYield.toString(),
        unrealizedYield:   unrealizedYield.toString(),
        // Outstanding = unrealized yield + lender's share of accrued-but-
        // unsettled commit fee. This is what the lender's "Outstanding"
        // dashboard tile should show: pro-rata claim on every fee type
        // accrued so far that hasn't been realized yet.
        outstandingYield:  outstandingYield.toString(),
        // Full pending = outstanding + lender share of in-flight util &
        // penalty pending on active drawdowns. Used by FacilityCard's
        // "Total Yield Pending" when rendering for a lender.
        pendingYieldLender: pendingYieldLender.toString(),
        lenderUtilPending:    lenderUtilPending.toString(),
        lenderPenaltyPending: lenderPenaltyPending.toString(),
        lenderCommitPending:  lenderCommitPending.toString(),
        realizedLoss:      realizedLoss.toString(),
        // Backwards-compat aliases for callers still expecting the old shape.
        deposited:         principalIn.toString(),
        yield:             realizedYield.toString(),
        // Pool context
        totalCapital:           p.account.totalCapital.toString(),
        outstandingPrincipal:   p.account.outstandingPrincipal.toString(),
        positionStatus: lpBalance === 0n
          ? (realizedLoss > 0n ? 'closed_loss' : 'closed_realized')
          : 'open',
      });
    }

    res.json({
      wallet: lender.toBase58(),
      walletUsdc,
      poolsJoined: positions.length,
      totalDeposited:      totalDepositedBase.toString(),    // lifetime principal still committed
      totalRedeemable:     totalRedeemableBase.toString(),   // current cash value of open positions
      totalRealizedYield:  totalRealizedBase.toString(),     // yield captured from completed redemptions
      totalUnrealizedYield: totalUnrealizedBase.toString(),  // yield sitting in open positions
      // Legacy alias: total yield = realized + unrealized (pure profit, no
      // principal). Matches what the dashboard's "Total Yield" stat
      // intuitively means.
      totalYield: (totalRealizedBase + totalUnrealizedBase).toString(),
      positions,
    });
  } catch (e) {
    console.error('[/lender/portfolio]', e);
    res.status(500).json({ message: e.message });
  }
});

// ─── Per-pool on-chain event log ────────────────────────────────────────────

// Pool activity feed — reads pre-decoded events from PoolEvent (kept
// fresh by workers/poolAggregatesIndexer.js). Cold path falls back to
// inline syncOne so first-after-boot reads still return correct data.
router.get('/pool/:pool/activity', async (req, res) => {
  try {
    const PoolEvent = require('../models/PoolEvent');
    const PoolAggregates = require('../models/PoolAggregates');
    const limit = Math.min(parseInt(req.query.limit || '30', 10), 500);

    // Cold-path bootstrap: if the indexer hasn't seen this pool yet,
    // run one inline sync so we have events to query.
    const agg = await PoolAggregates.findOne({ pubkey: req.params.pool }).lean();
    if (!agg || !agg.bootstrapped) {
      try {
        const { tryInlineSync } = require('../workers/poolAggregatesIndexer');
        await tryInlineSync(req.params.pool);
      } catch (e) {
        console.warn('[/activity] inline bootstrap failed:', e.message);
      }
    }

    const events = await PoolEvent
      .find({ pool: req.params.pool })
      .sort({ blockTime: -1, slot: -1 })
      .limit(limit)
      .lean();

    res.json(events.map((e) => ({
      name: e.name,
      data: e.data,
      signature: e.signature,
      slot: e.slot,
      blockTime: e.blockTime,
    })));
  } catch (e) {
    console.error('[/pool/:pool/activity]', e);
    res.status(500).json({ message: e.message });
  }
});

// ─── Daily activity / P&L breakdown ───────────────────────────────────────
//
// Replays the pool's on-chain event log day-by-day to derive per-day
// state: outstanding capital, idle capital, util fee accrued, commit fee
// accrued, and yield realized (fees collected via repays that day).
//
// Algorithm matches the on-chain rules:
//   - util_fee_per_day    = sum over drawdowns active that day of
//                            principal × util_bps / 10_000     (N <= tenor+grace)
//                            principal × penalty_bps / 10_000  (N >  tenor+grace)
//   - commit_fee_per_day  = (total_capital − peak_outstanding) × commit_bps / 10_000
// Yield realized = the sum of util + penalty paid via `RepaymentProcessed`
// plus commit fees that flowed via `CommitFeeSettled` that day.
// (Commit fee is no longer bundled into `repay`; it settles only via
// the standalone `settle_commit_fee` instruction — typically at facility
// close, since `close_facility` requires accrued_commit_fee == 0.)
router.get('/pool/:pool/daily-activity', async (req, res) => {
  try {
    const PoolEvent = require('../models/PoolEvent');
    const PoolAggregates = require('../models/PoolAggregates');
    const poolPk = new PublicKey(req.params.pool);
    const pool = await ps.fetchPool(poolPk);
    // Warp-aware day length. 86_400 = real day; smaller for test pools.
    const secondsPerDay = pool.secondsPerDay || 86_400;

    // Cold-path bootstrap.
    const agg = await PoolAggregates.findOne({ pubkey: req.params.pool }).lean();
    if (!agg || !agg.bootstrapped) {
      try {
        const { tryInlineSync } = require('../workers/poolAggregatesIndexer');
        await tryInlineSync(req.params.pool);
      } catch (e) {
        console.warn('[/daily-activity] inline bootstrap failed:', e.message);
      }
    }

    // Read pre-decoded events from Mongo, oldest-first for the replay.
    // Note: data is already JSON-serialized (PublicKeys → strings, BNs
    // → decimal strings), so the switch below uses .toString-free reads.
    const rawEvents = await PoolEvent
      .find({ pool: req.params.pool, blockTime: { $ne: null } })
      .sort({ slot: 1, blockTime: 1 })
      .lean();
    const events = rawEvents.map((e) => ({
      name: e.name,
      data: e.data,
      signature: e.signature,
      blockTime: e.blockTime,
      dayIndex: Math.floor(e.blockTime / secondsPerDay),
    }));

    // Replay state day-by-day.
    const utilBps   = pool.utilizationRateBps;
    const commitBps = pool.commitmentRateBps;
    const penaltyBps = pool.penaltyRateBps;
    const graceDays = pool.graceDays;
    const tenor = pool.facilityTenorDays;
    const today = Math.floor(Date.now() / 1000 / secondsPerDay);

    let totalCapital = 0n;
    let outstanding = 0n;
    // Replay-mirrored "settled" detection state. We track these alongside
    // the on-chain counters so the day loop can stop emitting once the
    // facility reaches a clean terminal state.
    let runningAccruedCommit = 0n;
    let runningProtocolFeesOwed = 0n;
    let everDrew = false;
    let didCancel = false;
    let didDefault = false;
    const protocolBpsRunning = BigInt(pool.protocolFeeShareBps || 0);
    // Map of currently-open drawdowns. Used to compute util-fee-pending and
    // to seed the "active during day" set at the top of each day.
    const outstandingByDrawdown = new Map(); // drawdownPubkey -> {principal, drawdownDay, tenorDays}

    // Bucket events by day for fast lookup.
    const byDay = new Map();
    for (const ev of events) {
      if (!byDay.has(ev.dayIndex)) byDay.set(ev.dayIndex, []);
      byDay.get(ev.dayIndex).push(ev);
    }

    const startDay = events.length ? events[0].dayIndex : today;
    // Run the replay all the way to today so post-tenor events (final
    // settle_commit_fee, last repay, redeem_lp, claim_protocol_fees) are
    // captured. The per-day commit-fee gate (`isAccruingDay`) still stops
    // accruing past `activated_day + tenor`, so the math stays correct;
    // we just stop missing late-stage events that contribute to yield
    // realized + protocol-fee totals.
    const endDay = today;

    const days = [];

    for (let day = startDay; day <= endDay; day++) {
      const dayEvents = byDay.get(day) || [];
      const niceEvents = [];

      // Track peak during this day (intra-day: starts at outstanding before
      // any draws, then updates after each draw).
      let peakOutstanding = outstanding;
      let yieldRealized = 0n;

      // Snapshot of drawdowns that touched this day. Seed with everything
      // open at start-of-day; DrawdownExecuted adds to it; RepaymentProcessed
      // does NOT remove (the repay day still counts as an active day, since
      // the on-chain program charges util/penalty for it).
      const todayActive = new Map();
      for (const [pk, dd] of outstandingByDrawdown.entries()) {
        todayActive.set(pk, dd);
      }

      for (const ev of dayEvents) {
        // ev.data is already-serialized JSON from Mongo: PublicKeys are
        // base58 strings and BNs are decimal strings. So `d.lender` and
        // `d.drawdown` are strings, not PublicKeys; `d.amount` is a
        // string usable directly with BigInt().
        const d = ev.data;
        switch (ev.name) {
          case 'Deposited': {
            const amt = BigInt(d.amount);
            totalCapital += amt;
            niceEvents.push({ kind: 'deposit', amount: amt.toString(), lender: d.lender });
            break;
          }
          case 'WithdrawnFunding': {
            const amt = BigInt(d.amount);
            totalCapital -= amt;
            niceEvents.push({ kind: 'withdraw', amount: amt.toString(), lender: d.lender });
            break;
          }
          case 'FacilityExecuted': {
            niceEvents.push({ kind: 'execute', totalCapital: d.totalCapital });
            break;
          }
          case 'DrawdownExecuted': {
            const amt = BigInt(d.amount);
            outstanding += amt;
            if (outstanding > peakOutstanding) peakOutstanding = outstanding;
            const ddRecord = {
              principal: amt,
              drawdownDay: d.drawdownDay,
              tenorDays: d.tenorDays,
            };
            outstandingByDrawdown.set(d.drawdown, ddRecord);
            // Drawdown counts as active for the day it was drawn.
            todayActive.set(d.drawdown, ddRecord);
            everDrew = true;
            niceEvents.push({
              kind: 'drawn',
              amount: amt.toString(),
              drawdownId: d.id,
              tenorDays: d.tenorDays,
            });
            break;
          }
          case 'RepaymentProcessed': {
            const principal = BigInt(d.principal);
            outstanding -= principal;
            const utilFee    = BigInt(d.utilFee);
            const penaltyFee = BigInt(d.penaltyFee);
            // Commit fee is no longer bundled into repay — it flows
            // separately through `CommitFeeSettled`.
            yieldRealized += utilFee + penaltyFee;
            outstandingByDrawdown.delete(d.drawdown);
            // Protocol's slice of this repayment.
            runningProtocolFeesOwed += ((utilFee + penaltyFee) * protocolBpsRunning) / 10000n;
            niceEvents.push({
              kind: 'repaid',
              principal: principal.toString(),
              utilFee: utilFee.toString(),
              penaltyFee: penaltyFee.toString(),
              yield: (utilFee + penaltyFee).toString(),
            });
            break;
          }
          case 'CommitFeeSettled': {
            const amt = BigInt(d.amount);
            yieldRealized += amt;
            // Settle drains the on-chain accrued_commit_fee and pays the
            // protocol's slice into protocol_fees_owed.
            runningAccruedCommit = 0n;
            runningProtocolFeesOwed += (amt * protocolBpsRunning) / 10000n;
            niceEvents.push({ kind: 'settleCommit', amount: amt.toString() });
            break;
          }
          case 'LpRedeemed': {
            niceEvents.push({ kind: 'redeem', usdcPaid: d.usdcPaid, lpBurned: d.lpBurned });
            break;
          }
          case 'ProtocolFeesClaimed': {
            // Resets on-chain protocol_fees_owed to 0.
            runningProtocolFeesOwed = 0n;
            niceEvents.push({ kind: 'claimProtocol', amount: d.amount });
            break;
          }
          case 'FundingCancelledEvent': {
            didCancel = true;
            niceEvents.push({ kind: 'cancel' });
            break;
          }
          case 'DefaultDeclared': {
            didDefault = true;
            niceEvents.push({ kind: 'default', outstanding: d.outstanding });
            break;
          }
        }
      }

      // Per-day fees.
      //
      // Util / penalty: per-drawdown sum across everything that was open at
      //   any point during this day. Each drawdown contributes
      //     principal × util_bps    / 10_000   while N <= tenor + grace, OR
      //     principal × penalty_bps / 10_000   once N >  tenor + grace
      //   where N = day - drawdownDay + 1. This matches the on-chain
      //   per-drawdown accrual exactly (and avoids the peak-based undercount
      //   on days that combine repays and fresh draws).
      //
      // Commit fee: gated to the facility's accruing window
      //   [activatedDay, activatedDay + tenor) and uses the SAME peak-during
      //   -day as the on-chain `unutilized_during_day` so we don't
      //   double-charge the same dollar.
      let utilFee = 0n;
      let penaltyFee = 0n;
      let unutilFee = 0n;

      for (const dd of todayActive.values()) {
        const N = day - dd.drawdownDay + 1;
        if (N < 1) continue;
        const normalMax = dd.tenorDays + graceDays;
        if (N <= normalMax) {
          utilFee += (dd.principal * BigInt(utilBps)) / 10000n;
        } else {
          penaltyFee += (dd.principal * BigInt(penaltyBps)) / 10000n;
        }
      }

      const isAccruingDay =
        pool.activatedDay > 0 &&
        day >= pool.activatedDay &&
        day < pool.activatedDay + tenor;
      if (isAccruingDay) {
        const idle = totalCapital > peakOutstanding ? totalCapital - peakOutstanding : 0n;
        unutilFee = (idle * BigInt(commitBps)) / 10000n;
      }

      const dayTotal = utilFee + penaltyFee + unutilFee;

      // Mirror on-chain accrued_commit_fee accumulation. Settle events
      // earlier in this day reset the counter; the day's idle accrual is
      // applied AFTER, matching what would be visible on-chain at next-day
      // boundary.
      runningAccruedCommit += unutilFee;

      days.push({
        day,
        date: new Date(day * secondsPerDay * 1000).toISOString().slice(0, 10),
        events: niceEvents,
        utilizedAtEnd: outstanding.toString(),
        peakOutstanding: peakOutstanding.toString(),
        totalCapital: totalCapital.toString(),
        unutilized: (totalCapital > peakOutstanding ? totalCapital - peakOutstanding : 0n).toString(),
        utilFee: utilFee.toString(),
        penaltyFee: penaltyFee.toString(),
        unutilFee: unutilFee.toString(),
        yieldRealized: yieldRealized.toString(),
        dayTotal: dayTotal.toString(),
      });

      // Stop emitting once the facility reaches a clean terminal state.
      // "Settled" = at least one drawdown happened, no active drawdowns,
      // no commit fee accruing or pending settle, no protocol fees pending
      // claim, and not cancelled / defaulted. Once true, every subsequent
      // day would just be empty noise — drop them.
      const isTerminalSettled =
        everDrew &&
        !didCancel &&
        !didDefault &&
        outstandingByDrawdown.size === 0 &&
        runningAccruedCommit === 0n &&
        runningProtocolFeesOwed === 0n;
      if (isTerminalSettled) break;
    }

    // Aggregate totals across the period.
    const totals = days.reduce(
      (acc, d) => ({
        utilFee:        (BigInt(acc.utilFee)        + BigInt(d.utilFee)).toString(),
        penaltyFee:     (BigInt(acc.penaltyFee)     + BigInt(d.penaltyFee)).toString(),
        unutilFee:      (BigInt(acc.unutilFee)      + BigInt(d.unutilFee)).toString(),
        yieldRealized:  (BigInt(acc.yieldRealized)  + BigInt(d.yieldRealized)).toString(),
        dayTotal:       (BigInt(acc.dayTotal)       + BigInt(d.dayTotal)).toString(),
        utilizedPD:     (BigInt(acc.utilizedPD)     + BigInt(d.peakOutstanding)).toString(),
        unutilizedPD:   (BigInt(acc.unutilizedPD)   + BigInt(d.unutilized)).toString(),
      }),
      { utilFee: '0', penaltyFee: '0', unutilFee: '0', yieldRealized: '0', dayTotal: '0', utilizedPD: '0', unutilizedPD: '0' }
    );

    // Pending utilization fee on still-open drawdowns (not yet flowed
    // through `repay`). Same formula the on-chain `repay` uses.
    let utilFeePending = 0n;
    let penaltyFeePending = 0n;
    for (const dd of outstandingByDrawdown.values()) {
      const daysActive = today - dd.drawdownDay + 1;
      const normalMax  = dd.tenorDays + graceDays;
      const utilDays    = Math.min(Math.max(0, daysActive), normalMax);
      const penaltyDays = Math.max(0, daysActive - normalMax);
      utilFeePending    += (dd.principal * BigInt(utilBps) * BigInt(utilDays)) / 10000n;
      penaltyFeePending += (dd.principal * BigInt(penaltyBps) * BigInt(penaltyDays)) / 10000n;
    }

    res.json({
      pool: poolPk.toBase58(),
      activatedDay: pool.activatedDay,
      tenorEndDay: pool.activatedDay > 0 ? pool.activatedDay + tenor : null,
      today,
      utilizationRateBps: utilBps,
      commitmentRateBps:  commitBps,
      penaltyRateBps:     penaltyBps,
      graceDays,
      penaltyDays: pool.penaltyDays,
      // Live aggregates (chain authoritative):
      utilFeeRealized:     pool.accruedUtilFee.toString(),
      penaltyFeeRealized:  pool.accruedPenaltyFee.toString(),
      commitFeePending:    pool.accruedCommitFee.toString(),
      protocolFeesOwed:    pool.protocolFeesOwed.toString(),
      // Estimated from active drawdowns:
      utilFeePending:      utilFeePending.toString(),
      penaltyFeePending:   penaltyFeePending.toString(),
      // Replayed daily breakdown:
      ...paginate(days, req.query.page, req.query.limit),
      totals,
    });
  } catch (e) {
    console.error('[/pool/:pool/daily-activity]', e);
    res.status(500).json({ message: e.message });
  }
});

// Lifetime fee aggregates. Fast path: read from PoolAggregates (Mongo),
// kept fresh by `workers/poolAggregatesIndexer.js`. Combines those
// event-only totals with the live on-chain cumulative counters
// (accrued_util_fee, accrued_penalty_fee from pool state).
//
// Cold path: if the indexer hasn't bootstrapped this pool yet, run a
// one-shot inline sync so the first request is still correct (just
// slower). Subsequent requests hit the warm Mongo doc instantly.
router.get('/pool/:pool/fee-aggregates', async (req, res) => {
  try {
    const PoolAggregates = require('../models/PoolAggregates');
    const { tryInlineSync } = require('../workers/poolAggregatesIndexer');

    const pool = await ps.fetchPoolMaybe(req.params.pool);
    if (!pool) return res.status(404).json({ message: 'Pool not found on-chain' });

    let agg = await PoolAggregates.findOne({ pubkey: req.params.pool });
    let warm = !!agg && agg.bootstrapped;
    if (!warm) {
      // Polite inline bootstrap. Skips silently if the worker is busy
      // or the RPC is in 429 cooldown — endpoint then returns whatever
      // is in Mongo (possibly empty), and the next worker tick fills it.
      try { await tryInlineSync(req.params.pool); } catch (e) {
        console.warn('[fee-aggregates] inline bootstrap failed:', e.message);
      }
      agg = await PoolAggregates.findOne({ pubkey: req.params.pool });
    }

    const accruedUtilFee    = BigInt(pool.accruedUtilFee.toString());
    const accruedPenaltyFee = BigInt(pool.accruedPenaltyFee.toString());
    const settledCommit     = BigInt(agg?.settledCommitLifetime       || '0');
    const protocolClaimed   = BigInt(agg?.protocolClaimedLifetime     || '0');
    const lenderRedeemedY   = BigInt(agg?.lenderRedeemedYieldLifetime || '0');
    const earnedYieldGross  = accruedUtilFee + accruedPenaltyFee + settledCommit;

    res.json({
      // Provenance: how fresh is the cached portion?
      cached:               !!agg,
      bootstrapped:         !!agg?.bootstrapped,
      lastSyncedAt:         agg?.lastSyncedAt || null,
      totalSigsSeen:        agg?.totalSigsSeen || 0,
      // Live on-chain counters
      accruedUtilFee:       accruedUtilFee.toString(),
      accruedPenaltyFee:    accruedPenaltyFee.toString(),
      // Event-aggregated lifetime totals (from Mongo)
      settledCommitLifetime:       settledCommit.toString(),
      protocolClaimedLifetime:     protocolClaimed.toString(),
      lenderRedeemedYieldLifetime: lenderRedeemedY.toString(),
      // Convenience composite
      earnedYieldGross:     earnedYieldGross.toString(),
    });
  } catch (e) {
    console.error('[fee-aggregates]', e);
    res.status(500).json({ message: e.message });
  }
});

router.get('/pool/:pool/state', async (req, res) => {
  try {
    const pool = await ps.fetchPoolMaybe(req.params.pool);
    if (!pool) return res.status(404).json({ message: 'Pool not found on-chain' });
    res.json({
      admin: pool.admin.toBase58(),
      pspWallet: pool.pspWallet.toBase58(),
      pspName: nameFor(req.params.pool, pool.pspName),
      facilityId: pool.facilityId.toString(),
      usdcMint: pool.usdcMint.toBase58(),
      vault: pool.vault.toBase58(),
      lpMint: pool.lpMint.toBase58(),
      softCap: pool.softCap.toString(),
      hardCap: pool.hardCap.toString(),
      maxDrawdownAmount: pool.maxDrawdownAmount.toString(),
      facilityTenorDays: pool.facilityTenorDays,
      utilizationRateBps: pool.utilizationRateBps,
      commitmentRateBps: pool.commitmentRateBps,
      penaltyRateBps: pool.penaltyRateBps,
      graceDays: pool.graceDays,
      penaltyDays: pool.penaltyDays,
      protocolFeeShareBps: pool.protocolFeeShareBps,
      secondsPerDay: pool.secondsPerDay || 86400,
      isActive: pool.isActive,
      isCancelled: pool.isCancelled,
      isDefaulted: pool.isDefaulted,
      createdDay: pool.createdDay,
      activatedDay: pool.activatedDay,
      totalCapital: pool.totalCapital.toString(),
      outstandingPrincipal: pool.outstandingPrincipal.toString(),
      todayDay: pool.todayDay,
      todayPeakOutstanding: pool.todayPeakOutstanding.toString(),
      accruedCommitFee: pool.accruedCommitFee.toString(),
      accruedUtilFee: pool.accruedUtilFee.toString(),
      accruedPenaltyFee: pool.accruedPenaltyFee.toString(),
      protocolFeesOwed: pool.protocolFeesOwed.toString(),
      nextDrawdownId: pool.nextDrawdownId.toString(),
      countActiveDrawdowns: pool.countActiveDrawdowns,
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// `?includeRepaid=true` returns full history (active + repaid) so the PSP
// detail page can show both. Default behavior unchanged for callers that
// just want the open positions.
router.get('/pool/:pool/drawdowns', async (req, res) => {
  try {
    const includeRepaid = req.query.includeRepaid === 'true';
    const program = ps.getProgram();
    const pool = new PublicKey(req.params.pool);
    const all = await program.account.drawdown.all([
      { memcmp: { offset: 8, bytes: pool.toBase58() } },
    ]);
    const filtered = includeRepaid ? all : all.filter((d) => !d.account.repaid);
    res.json(
      filtered
        .map((d) => ({
          pubkey: d.publicKey.toBase58(),
          id: d.account.id.toString(),
          principal: d.account.principal.toString(),
          drawdownDay: d.account.drawdownDay,
          tenorDays: d.account.tenorDays,
          repaid: d.account.repaid,
        }))
        .sort((a, b) => Number(a.id) - Number(b.id))
    );
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

/**
 * Quick "Request Financing" path for the DeFa borrow portal.
 *
 * Legacy flow requires an EfficientDeposit row in the PSP's order book
 * (populated by external_psp portal or the Eficyent integration). For
 * the independent dev deployment neither is wired, so the order book is
 * empty and PSPs can't request anything.
 *
 * This endpoint short-circuits that: server creates the EfficientDeposit
 * stub on the PSP's behalf, then a FinancingRequest already in
 * `AwaitingDrawdown` so the Next Actions hero surfaces a Sign Drawdown
 * CTA immediately.
 *
 * Body: { amount, tenorDays, orderReference? }
 *
 * Validation:
 *   - PSP must have an active credit line
 *   - amount > 0, tenorDays > 0
 *   - amount ≤ available credit (approvedCreditLine − currentlyUtilized)
 *   - tenorDays ≤ profile.drawdown_tenor
 *   - orderReference auto-generated if omitted
 */
// Validation pipeline lookup. Used by PSP / admin / lender detail views
// to render a stepper visualization of the financingValidationAgent's
// progress on a given drawdown. Keyed by (poolPda, drawdownId) since
// that's what every portal already has at hand. Returns the steps
// array (pre-staged + updated by the agent) plus a small summary.
//
// Auth-light: any authenticated user can read this — the data is
// pipeline metadata, not financial PII.
router.get(
  '/pool/:pool/drawdown/:drawdownId/pipeline',
  authMiddleware,
  async (req, res) => {
    try {
      const FinancingRequest = require('../models/FinancingRequest');
      const fr = await FinancingRequest
        .findOne({ poolPda: req.params.pool, drawdownId: Number(req.params.drawdownId) })
        .select('orderReference amount status validationSteps disbursedAt rejectionReason');
      if (!fr) return res.status(404).json({ message: 'Financing request not found' });
      res.json({
        orderReference: fr.orderReference,
        amount:         fr.amount,
        status:         fr.status,
        rejectionReason: fr.rejectionReason || '',
        disbursedAt:    fr.disbursedAt,
        steps:          fr.validationSteps || [],
      });
    } catch (e) {
      console.error('[/pool/:pool/drawdown/:drawdownId/pipeline]', e);
      res.status(500).json({ message: e.message });
    }
  }
);

// Bulk-relabel every on-chain pool with a random remittance-company
// display name. Persists the override to PoolNameOverride. Doesn't
// touch chain state — the on-chain pspName field is immutable.
// Existing overrides are replaced unless `?onlyMissing=true` is passed.
router.post(
  '/admin/pools/relabel-random',
  authMiddleware,
  authorizeRoles(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const PoolNameOverride = require('../models/PoolNameOverride');
      const onlyMissing = req.query.onlyMissing === 'true';

      const REMITTANCE_COMPANIES = [
        'Wise Pay Partners', 'Remitly Bridge', 'WorldRemit Capital',
        'Western Union Flow', 'MoneyGram Liquidity', 'OFX Settlements',
        'TransferWise Holdings', 'Xoom Working Capital', 'PaySend Treasury',
        'Ria Money Transfer', 'CurrencyFair Trade', 'Azimo Settlements',
        'InstaReM Liquidity', 'TransferGo Capital', 'Skrill Cross-Border',
        'Revolut Remittance', 'Payoneer Settlements', 'Stripe Atlas Flow',
        'WorldFirst Treasury', 'Brink Pay Bridge',
      ];
      const shuffled = [...REMITTANCE_COMPANIES].sort(() => Math.random() - 0.5);

      const pools = await ps.fetchAllPools();
      const updates = [];
      let idx = 0;
      for (const p of pools) {
        const pubkey = p.publicKey.toBase58();
        if (onlyMissing) {
          const existing = await PoolNameOverride.findOne({ poolPda: pubkey }).lean();
          if (existing) continue;
        }
        const displayName = shuffled[idx % shuffled.length];
        idx += 1;
        await PoolNameOverride.findOneAndUpdate(
          { poolPda: pubkey },
          { $set: { poolPda: pubkey, displayName, setBy: req.user.email || req.user.userId || '' } },
          { upsert: true }
        );
        updates.push({ poolPda: pubkey, facilityId: p.account.facilityId.toString(), wasName: p.account.pspName, newName: displayName });
      }
      await reloadNameOverrides();
      res.json({ ok: true, updated: updates.length, total: pools.length, items: updates });
    } catch (e) {
      console.error('[/admin/pools/relabel-random]', e);
      res.status(500).json({ message: e.message });
    }
  }
);

// External orderbook feed for the borrower. Returns seeded orders from
// the demo external PSP user — a fixed pool of $100k / $250k / $350k /
// $500k / $750k / $1M maintained by `workers/orderbookGenerator`.
// Used by the borrower drawdown picker so the PSP can request financing
// against a real-looking customer order rather than typing a freeform
// amount.
router.get(
  '/psp/borrow/external-orders',
  authMiddleware,
  authorizeRoles('PSP'),
  async (req, res) => {
    try {
      const ExternalOrderBook = require('../models/ExternalOrderBook');
      const ExternalPSPUser   = require('../models/ExternalPSPUser');
      const { seedFixedOrders } = require('../workers/orderbookGenerator');

      // Safety net: the worker tops up every 30s, but if the queue
      // has been drained below 5 open orders right when a request
      // comes in (e.g. demo just financed a few in a row), seed
      // inline so the picker never shows an empty state.
      let demoUser = await ExternalPSPUser.findOne({ email: '11feb@maildrop.cc' }).select('_id companyName');
      const openCount = demoUser ? await ExternalOrderBook.countDocuments({
        externalPspUserId: demoUser._id,
        status: 'Pending',
        loanRequested: { $ne: true },
      }) : 0;
      if (!demoUser || openCount < 5) {
        await seedFixedOrders();
        demoUser = await ExternalPSPUser.findOne({ email: '11feb@maildrop.cc' }).select('_id companyName');
      }
      if (!demoUser) return res.json([]);

      const orders = await ExternalOrderBook.find({
        externalPspUserId: demoUser._id,
        status: 'Pending',
        loanRequested: { $ne: true },
      })
        .sort({ amount: 1 })
        .limit(50)
        .lean();

      // Strip customer PII (name / email / phone / invoice text) — the
      // borrower picker only needs the order reference + amount + dates.
      // Keeps the API surface privacy-clean even if the picker UI ever
      // changes to render more fields.
      res.json(orders.map((o) => ({
        id:              o._id.toString(),
        orderReference:  o.orderReference,
        amount:          o.amount,
        currency:        o.currency,
        settlementDate:  o.settlementDate,
        orderDate:       o.orderDate,
      })));
    } catch (e) {
      console.error('[/psp/borrow/external-orders]', e);
      res.status(500).json({ message: e.message });
    }
  }
);

router.post(
  '/psp/borrow/quick-request-financing',
  authMiddleware,
  authorizeRoles('PSP'),
  async (req, res) => {
    try {
      const FinancingRequest = require('../models/FinancingRequest');
      const EfficientDeposit = require('../models/EfficientDeposit');

      const { amount, tenorDays } = req.body || {};
      const numAmount = Number(amount);
      const numTenor = Number(tenorDays);
      if (!Number.isFinite(numAmount) || numAmount <= 0) {
        return res.status(400).json({ message: 'amount must be a positive number' });
      }
      if (!Number.isInteger(numTenor) || numTenor <= 0) {
        return res.status(400).json({ message: 'tenorDays must be a positive integer' });
      }

      const profile = await PSPProfile.findOne({ userId: req.user.userId });
      if (!profile) return res.status(404).json({ message: 'PSP profile not found' });

      // Pick the targeted facility. PSP must specify which (their portal
      // sends `pool` from the facility card they're drawing against).
      const Facility = require('../models/Facility');
      const targetPool = req.body?.pool;
      const facility = targetPool
        ? await Facility.findOne({ pspProfileId: profile._id, poolPda: targetPool, status: { $in: ['FUNDING','ACTIVE'] } })
        : await Facility.findOne({ pspProfileId: profile._id, status: 'ACTIVE' }).sort({ activatedAt: -1 });
      if (!facility) {
        return res.status(409).json({
          message: targetPool
            ? 'Facility not found or not active.'
            : 'No active facility for this PSP.',
        });
      }

      const t = facility.approvedTerms || {};
      const tenorMax = Number(t.tenorDays || 0);
      if (tenorMax > 0 && numTenor > tenorMax) {
        return res.status(400).json({
          message: `Tenor ${numTenor}d exceeds the facility max of ${tenorMax}d`,
        });
      }

      const orderReference =
        (req.body.orderReference || '').toString().trim() ||
        `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

      const existing = await EfficientDeposit.findOne({
        'payload.unique_id': orderReference,
        'metadata.partnerId': req.user.userId,
      });
      if (!existing) {
        await EfficientDeposit.create({
          payload: {
            unique_id: orderReference,
            total_amount: numAmount,
            currency: 'USD',
            type: 'DEPOSIT',
            status: 'Created',
            created_at: new Date(),
          },
          status: 'Financing',
          metadata: {
            partnerId: req.user.userId,
            receivedAt: new Date(),
            ip: req.ip,
            headers: { source: 'psp-borrow-portal/quick-request' },
          },
        });
      } else {
        existing.status = 'Financing';
        await existing.save();
      }

      // Honor the facility's day length so warp pools' "5-day tenor" doesn't
      // get a real-calendar dueDate that's effectively 5 days in the future.
      const facilitySecondsPerDay = (t.secondsPerDay && Number(t.secondsPerDay)) || 86_400;
      const dueDate = new Date(Date.now() + numTenor * facilitySecondsPerDay * 1000);
      // Pre-stage the validation pipeline so the UI shows the full
      // chain immediately. quick-request bypasses the async validation
      // agent (it inlines those checks above) so we mark them passed
      // synchronously here. The final "On-chain disbursed" step flips
      // to passed when the PSP signs and the relay confirms.
      const now = new Date();
      const passedStep = (name, detail) => ({
        name, status: 'passed', detail, startedAt: now, completedAt: now,
      });
      const fr = await FinancingRequest.create({
        pspId: profile._id,
        orderReference,
        amount: numAmount,
        status: 'AwaitingDrawdown',
        validatedAt: new Date(),
        dueDate,
        utilizedBips: t.utilizationRateBps,
        unutilizedBips: t.commitmentRateBps,
        approvedAmount: t.maxDrawdownAmount || t.creditLine,
        drawdownTenor: numTenor,
        poolPda: facility.poolPda,
        facilityDocId: facility._id,
        validationSteps: [
          passedStep('Order verified',       `Order ${orderReference} accepted`),
          passedStep('Credit line approved', `Facility #${facility.facilityId} active`),
          passedStep('Order not financed',   'Fresh request'),
          passedStep('Sufficient credit',    `Requested $${numAmount.toLocaleString()} within facility cap`),
          passedStep('Risk validated',       'Inline checks cleared'),
        ],
      });

      res.json({
        success: true,
        message: 'Financing request created. Sign the drawdown from Next Actions.',
        financingRequest: {
          id: fr._id,
          orderReference,
          amount: numAmount,
          tenorDays: numTenor,
          status: fr.status,
        },
      });
    } catch (e) {
      console.error('[/psp/borrow/quick-request-financing]', e);
      res.status(500).json({ message: e.message });
    }
  }
);

// Aggregated TODO for the authenticated PSP across all their facilities:
//   - awaitingDrawdowns: FinancingRequests in 'AwaitingDrawdown' (admin
//     approved, PSP needs to sign request_drawdown).
//   - drawdownsDueSoon / drawdownsOverdue: open Drawdown PDAs whose
//     days-to-cliff is small or negative (cliff = drawdown_day + tenor +
//     grace + penalty; past cliff the program blocks new draws).
//   - commitFeeSettleNeeded: pools where accrued_commit_fee > 0 AND tenor
//     has expired — PSP must call settle_commit_fee for lenders to redeem.
router.get(
  '/psp/next-actions',
  authMiddleware,
  authorizeRoles('PSP'),
  async (req, res) => {
    try {
      const FinancingRequest = require('../models/FinancingRequest');
      const profile = await PSPProfile.findOne({ userId: req.user.userId });
      if (!profile) return res.status(404).json({ message: 'PSP profile not found' });
      if (!profile.solanaWallet) return res.json({ awaitingDrawdowns: [], drawdownsDueSoon: [], drawdownsOverdue: [], commitFeeSettleNeeded: [] });

      const pools = await ps.fetchAllPools();
      const myPools = pools.filter((p) => p.account.pspWallet.toBase58() === profile.solanaWallet);
      const dueSoonThreshold = 3; // days until cliff

      const drawdownsDueSoon = [];
      const drawdownsOverdue = [];
      const commitFeeSettleNeeded = [];

      for (const p of myPools) {
        // Each pool may have its own day length (warp-time test pools).
        const secondsPerDay = p.account.secondsPerDay || 86_400;
        const today = Math.floor(Date.now() / 1000 / secondsPerDay);
        // Tenor end check for commit-fee settle prompt
        const tenorEnd = p.account.activatedDay > 0
          ? p.account.activatedDay + p.account.facilityTenorDays
          : null;
        const tenorExpired = tenorEnd ? today >= tenorEnd : false;
        if (tenorExpired && BigInt(p.account.accruedCommitFee.toString()) > 0n) {
          commitFeeSettleNeeded.push({
            pool: p.publicKey.toBase58(),
            pspName: nameFor(p.publicKey.toBase58(), p.account.pspName),
            facilityId: p.account.facilityId.toString(),
            accruedCommitFee: p.account.accruedCommitFee.toString(),
          });
        }
        // Active drawdowns approaching/past cliff
        const drawdowns = await ps.fetchActiveDrawdownsForPool(p.publicKey);
        for (const d of drawdowns) {
          const a = d.account;
          const cliff = a.drawdownDay + a.tenorDays + p.account.graceDays + p.account.penaltyDays;
          const daysToCliff = cliff - today;
          const entry = {
            pool: p.publicKey.toBase58(),
            pspName: nameFor(p.publicKey.toBase58(), p.account.pspName),
            drawdown: d.publicKey.toBase58(),
            drawdownId: a.id.toString(),
            principal: a.principal.toString(),
            tenorDays: a.tenorDays,
            drawdownDay: a.drawdownDay,
            cliff,
            daysToCliff,
          };
          if (daysToCliff <= 0) drawdownsOverdue.push(entry);
          else if (daysToCliff <= dueSoonThreshold) drawdownsDueSoon.push(entry);
        }
      }

      // Off-chain: requests still waiting for PSP signature.
      const awaitingRaw = await FinancingRequest.find({
        pspId: profile._id,
        status: 'AwaitingDrawdown',
      }).select('_id orderReference amount drawdownTenor createdAt poolPda').sort({ createdAt: 1 });

      // Reconciliation: a financing can get stuck in AwaitingDrawdown if
      // the PSP already signed on-chain but the post-confirm step didn't
      // run (older builds, or transient client error). Before returning
      // the list, scan each pool's on-chain drawdowns and auto-flip any
      // financing whose (amount, tenor) matches an unclaimed drawdown.
      // Match oldest-first against lowest drawdown id so the FIFO
      // assumption holds when the PSP signed multiple identical draws.
      const byPool = new Map();
      for (const r of awaitingRaw) {
        if (!r.poolPda) continue;
        if (!byPool.has(r.poolPda)) byPool.set(r.poolPda, []);
        byPool.get(r.poolPda).push(r);
      }
      const flippedIds = new Set();
      for (const [poolPda, financings] of byPool.entries()) {
        try {
          const poolPk = new PublicKey(poolPda);
          // Fetch ALL drawdowns (active + repaid) — a stuck financing's
          // drawdown may already be repaid.
          const program = ps.getProgram();
          const conn = program.provider.connection;
          const disc = require('crypto').createHash('sha256').update('account:Drawdown').digest().slice(0, 8);
          const bs58mod = require('bs58');
          const bs58encode = bs58mod.encode || (bs58mod.default && bs58mod.default.encode);
          const raws = await conn.getProgramAccounts(program.programId, {
            filters: [
              { memcmp: { offset: 0, bytes: bs58encode(disc) } },
              { memcmp: { offset: 8, bytes: poolPk.toBase58() } },
            ],
          });
          const allDrawdowns = [];
          for (const x of raws) {
            try {
              const acc = program.coder.accounts.decode('drawdown', x.account.data);
              allDrawdowns.push({ pubkey: x.pubkey, account: acc });
            } catch { /* skip stale layout */ }
          }
          allDrawdowns.sort((a, b) => Number(a.account.id) - Number(b.account.id));

          // Drawdowns already claimed by other (Disbursed/Repaid/etc.)
          // FinancingRequests so we don't double-assign.
          const claimed = new Set(
            (await FinancingRequest.find({
              pspId: profile._id,
              poolPda,
              drawdownId: { $ne: null },
            }).select('drawdownId').lean())
              .map((x) => Number(x.drawdownId))
          );

          for (const fr of financings) {
            const want = BigInt(Math.round(Number(fr.amount) * 1_000_000));
            const wantTenor = Number(fr.drawdownTenor || 5);
            const match = allDrawdowns.find((dd) =>
              !claimed.has(Number(dd.account.id)) &&
              BigInt(dd.account.principal.toString()) === want &&
              Number(dd.account.tenorDays) === wantTenor
            );
            if (!match) continue;
            claimed.add(Number(match.account.id));
            const disbursedAt = new Date();
            disbursedAt.setHours(0, 0, 0, 0);
            await FinancingRequest.updateOne(
              { _id: fr._id },
              {
                $set: {
                  status: 'Disbursed',
                  drawdownId: Number(match.account.id),
                  drawdownPda: match.pubkey.toBase58(),
                  poolPda,
                  disbursedAt,
                  dueDate: new Date(disbursedAt.getTime() + (wantTenor - 1) * 86400000),
                },
              }
            );
            flippedIds.add(String(fr._id));
          }
        } catch (e) {
          console.warn('[/psp/next-actions] reconciliation skipped pool', poolPda, e.message);
        }
      }
      const awaiting = awaitingRaw.filter((r) => !flippedIds.has(String(r._id)));

      res.json({
        awaitingDrawdowns: awaiting.map((r) => ({
          id: r._id,
          orderReference: r.orderReference,
          amount: r.amount,
          tenorDays: r.drawdownTenor || 5,
          createdAt: r.createdAt,
          pool: r.poolPda,
        })),
        drawdownsDueSoon,
        drawdownsOverdue,
        commitFeeSettleNeeded,
      });
    } catch (e) {
      console.error('[/psp/next-actions]', e);
      res.status(500).json({ message: e.message });
    }
  }
);

// Per-drawdown amortization: replays the on-chain `repay` cost formula
// day-by-day so the PSP can see exactly what each loan costs over time.
//   util_days = min(days_active, tenor + grace)
//   penalty_days = max(0, days_active - tenor - grace)
//   util_fee    = principal × util_bps × util_days / 10_000
//   penalty_fee = principal × penalty_bps × penalty_days / 10_000
// Schedule covers from drawdown_day through cliff+1 so the PSP can see
// when penalty kicks in and how the cost grows past tenor.
router.get(
  '/pool/:pool/drawdown/:drawdownId/amortization',
  authMiddleware,
  async (req, res) => {
    try {
      const program = ps.getProgram();
      const poolPk = new PublicKey(req.params.pool);
      const pool = await ps.fetchPool(poolPk);
      const [drawdownPda] = ps.deriveDrawdown(poolPk, req.params.drawdownId);
      let dd;
      try {
        dd = await program.account.drawdown.fetch(drawdownPda);
      } catch (e) {
        return res.status(404).json({ message: 'Drawdown not found' });
      }

      const principal = BigInt(dd.principal.toString());
      const utilBps = BigInt(pool.utilizationRateBps);
      const penaltyBps = BigInt(pool.penaltyRateBps);
      const tenor = dd.tenorDays;
      const graceDays = pool.graceDays;
      const penaltyDays = pool.penaltyDays;
      const cliff = dd.drawdownDay + tenor + graceDays + penaltyDays;
      const secondsPerDay = pool.secondsPerDay || 86_400;
      const today = Math.floor(Date.now() / 1000 / secondsPerDay);
      const normalMax = tenor + graceDays;

      // Schedule from drawdown_day through cliff (inclusive) — covers the
      // entire window in which the PSP can repay before draws are blocked.
      const schedule = [];
      for (let day = dd.drawdownDay; day <= cliff; day++) {
        const daysActive = day - dd.drawdownDay + 1;
        const utilDays   = Math.min(daysActive, normalMax);
        const penaltyOnlyDays = Math.max(0, daysActive - normalMax);
        const utilFee    = (principal * utilBps    * BigInt(utilDays))    / 10000n;
        const penaltyFee = (principal * penaltyBps * BigInt(penaltyOnlyDays)) / 10000n;
        const totalOwed  = principal + utilFee + penaltyFee;
        schedule.push({
          day,
          date: new Date(day * secondsPerDay * 1000).toISOString().slice(0, 10),
          daysActive,
          isPenaltyDay: penaltyOnlyDays > 0,
          utilFee:    utilFee.toString(),
          penaltyFee: penaltyFee.toString(),
          totalOwed:  totalOwed.toString(),
          isToday:    day === today,
        });
      }

      // Today's snapshot
      const daysActive = Math.max(1, today - dd.drawdownDay + 1);
      const utilDaysNow    = Math.min(daysActive, normalMax);
      const penaltyDaysNow = Math.max(0, daysActive - normalMax);
      const utilFeeNow     = (principal * utilBps    * BigInt(utilDaysNow))    / 10000n;
      const penaltyFeeNow  = (principal * penaltyBps * BigInt(penaltyDaysNow)) / 10000n;
      const totalOwedNow   = principal + utilFeeNow + penaltyFeeNow;

      res.json({
        drawdown: {
          pubkey: drawdownPda.toBase58(),
          id: dd.id.toString(),
          principal: principal.toString(),
          drawdownDay: dd.drawdownDay,
          tenorDays: dd.tenorDays,
          repaid: dd.repaid,
        },
        rates: {
          utilizationRateBps: pool.utilizationRateBps,
          penaltyRateBps: pool.penaltyRateBps,
          commitmentRateBps: pool.commitmentRateBps,
          graceDays,
          penaltyDays,
        },
        today,
        cliff,
        normalDueDay: dd.drawdownDay + tenor,
        graceEndDay:  dd.drawdownDay + tenor + graceDays,
        // Snapshot of what repaying *today* costs
        snapshot: {
          daysActive,
          utilFee: utilFeeNow.toString(),
          penaltyFee: penaltyFeeNow.toString(),
          totalOwed: totalOwedNow.toString(),
        },
        schedule,
      });
    } catch (e) {
      console.error('[/pool/:pool/drawdown/:id/amortization]', e);
      res.status(500).json({ message: e.message });
    }
  }
);

// Pools belonging to the authenticated PSP. Filters by pspWallet matching
// the PSP's bound solanaWallet. Returns enriched stats for the list UI.
router.get(
  '/psp/facilities',
  authMiddleware,
  authorizeRoles('PSP'),
  async (req, res) => {
    try {
      const profile = await PSPProfile.findOne({ userId: req.user.userId });
      if (!profile) return res.status(404).json({ message: 'PSP profile not found' });
      if (!profile.solanaWallet) {
        return res.status(409).json({ message: 'PSP wallet not bound; visit /psp/wallet first' });
      }
      const pools = await ps.fetchAllPools();
      const mine = pools.filter(
        (p) => p.account.pspWallet.toBase58() === profile.solanaWallet
      );

      // For each pool, also compute the in-flight util/penalty fee
      // estimates against active drawdowns. Same formula the on-chain
      // `repay` uses, mirrored here so the FacilityCard can show a
      // proper "Total Yield Pending" without a per-pool follow-up call.
      const enriched = await Promise.all(mine.map(async (p) => {
        const utilBps    = p.account.utilizationRateBps;
        const penaltyBps = p.account.penaltyRateBps;
        const graceDays  = p.account.graceDays;
        const spd        = p.account.secondsPerDay || 86_400;
        const today      = Math.floor(Date.now() / 1000 / spd);
        let utilFeePending    = 0n;
        let penaltyFeePending = 0n;
        try {
          const active = await ps.fetchActiveDrawdownsForPool(p.publicKey);
          for (const d of active) {
            const principal = BigInt(d.account.principal.toString());
            const daysActive = today - d.account.drawdownDay + 1;
            const normalMax  = d.account.tenorDays + graceDays;
            const utilDays   = Math.min(Math.max(0, daysActive), normalMax);
            const penaltyDays= Math.max(0, daysActive - normalMax);
            utilFeePending    += (principal * BigInt(utilBps)    * BigInt(utilDays))    / 10000n;
            penaltyFeePending += (principal * BigInt(penaltyBps) * BigInt(penaltyDays)) / 10000n;
          }
        } catch { /* leave pending = 0 if drawdown fetch fails */ }
        return {
          pubkey: p.publicKey.toBase58(),
          facilityId: p.account.facilityId.toString(),
          pspName: nameFor(p.publicKey.toBase58(), p.account.pspName),
          isActive: p.account.isActive,
          isCancelled: p.account.isCancelled,
          isDefaulted: p.account.isDefaulted,
          softCap: p.account.softCap.toString(),
          hardCap: p.account.hardCap.toString(),
          totalCapital: p.account.totalCapital.toString(),
          outstandingPrincipal: p.account.outstandingPrincipal.toString(),
          maxDrawdownAmount: p.account.maxDrawdownAmount.toString(),
          facilityTenorDays: p.account.facilityTenorDays,
          activatedDay: p.account.activatedDay,
          countActiveDrawdowns: p.account.countActiveDrawdowns,
          accruedUtilFee: p.account.accruedUtilFee.toString(),
          accruedCommitFee: p.account.accruedCommitFee.toString(),
          accruedPenaltyFee: p.account.accruedPenaltyFee.toString(),
          utilFeePending:    utilFeePending.toString(),
          penaltyFeePending: penaltyFeePending.toString(),
          utilizationRateBps: p.account.utilizationRateBps,
          commitmentRateBps: p.account.commitmentRateBps,
          penaltyRateBps: p.account.penaltyRateBps,
          graceDays: p.account.graceDays,
          penaltyDays: p.account.penaltyDays,
          protocolFeesOwed: p.account.protocolFeesOwed.toString(),
          nextDrawdownId: p.account.nextDrawdownId.toString(),
        };
      }));
      res.json(enriched);
    } catch (e) {
      console.error('[/psp/facilities]', e);
      res.status(500).json({ message: e.message });
    }
  }
);

// State filter: ?state=funding | active | closed | cancelled | defaulted | all
// Default is `all` to keep existing callers working. Lender portal passes
// `funding` to show only depositable pools.
function poolMatchesState(p, state) {
  if (!state || state === 'all') return true;
  if (state === 'funding') return !p.isActive && !p.isCancelled && !p.isDefaulted;
  if (state === 'active') return p.isActive && !p.isDefaulted;
  if (state === 'closed') return p.isActive; // Active pools after tenor are "closed" off-chain; still active flag on-chain
  if (state === 'cancelled') return p.isCancelled;
  if (state === 'defaulted') return p.isDefaulted;
  return true;
}

router.get('/pools', async (req, res) => {
  try {
    const { state } = req.query;
    const all = await ps.fetchAllPools();
    const out = all
      .map((p) => ({
        pubkey: p.publicKey.toBase58(),
        admin: p.account.admin.toBase58(),
        pspWallet: p.account.pspWallet.toBase58(),
        pspName: nameFor(p.publicKey.toBase58(), p.account.pspName),
        facilityId: p.account.facilityId.toString(),
        isActive: p.account.isActive,
        isCancelled: p.account.isCancelled,
        isDefaulted: p.account.isDefaulted,
        softCap: p.account.softCap.toString(),
        hardCap: p.account.hardCap.toString(),
        totalCapital: p.account.totalCapital.toString(),
        outstandingPrincipal: p.account.outstandingPrincipal.toString(),
        // Lifetime cumulative on-chain counters — used by FacilityCard
        // to render Total Yield Paid / Total Yield Pending without an
        // extra round-trip per pool.
        accruedUtilFee:    p.account.accruedUtilFee.toString(),
        accruedPenaltyFee: p.account.accruedPenaltyFee.toString(),
        accruedCommitFee:  p.account.accruedCommitFee.toString(),
        protocolFeesOwed:  p.account.protocolFeesOwed.toString(),
        countActiveDrawdowns: p.account.countActiveDrawdowns,
        nextDrawdownId:    p.account.nextDrawdownId.toString(),
      }))
      .filter((p) => poolMatchesState(p, state));
    res.json(out);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

module.exports = router;
