/**
 * Pool transaction endpoints — EVM (payfi_v1) edition.
 *
 * Each `build-tx` route returns `{ to, data, value }` — the shape wagmi's
 * writeContract / ethers.sendTransaction expect. The caller signs in the
 * browser wallet and submits directly to the RPC; no server relay hop.
 *
 * Auth model:
 *   /lender/* — JWT.kind === 'lender'. Uses req.user.wallet directly.
 *   /psp/*    — JWT.role === 'PSP'. Uses PSPProfile.evmWallet (bound via
 *               /auth/wallet/bind after SIWE login).
 *   /admin/*  — JWT.role in {KAM, CAD, CRO, CFO, ...}. Uses User.evmWallet.
 *
 * On-chain enforcement:
 *   payfi_v1 gates every write with AccessControl roles (AGENT1/AGENT2/
 *   MULTISIG). This route layer is a UX/policy gate — building a tx for
 *   the wrong role still returns calldata, but submitting it reverts on
 *   role check.
 *
 * Chunk B3a scope: only lender flows are wired. PSP + admin routes return
 * 501 with a note pointing at Chunk B3b. Portfolio / activity /
 * daily-activity / fee-aggregates endpoints are simplified reads until
 * the EVM indexer catches up (Chunk B3c wires the indexer + these
 * downstream analytics).
 */

'use strict';

const express = require('express');
const router = express.Router();
const { ethers } = require('ethers');

const { authMiddleware, authorizeRoles } = require('../middleware/auth');
const PSPProfile = require('../models/PSPProfile');
const User = require('../models/User');
const svc = require('../services/poolServiceEvm');
const { getProvider, getFactoryAddress, isOnchainAdmin } = require('../config/chain');
const { PoolState, DrawdownState } = require('../models/PoolState');
const PoolNameOverride = require('../models/PoolNameOverride');

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Coerce a user-provided amount string into a BigInt of USDC base units.
 * USDC has 6 decimals: 1 USDC = 1_000_000 units. The frontend already
 * scales, so we just parse; but we also tolerate decimal-string inputs
 * for CLI/curl convenience.
 */
function toBase(amount) {
  if (amount === null || amount === undefined) return null;
  if (typeof amount === 'bigint') return amount;
  const s = String(amount).trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return BigInt(s);
  if (/^\d+\.\d+$/.test(s)) {
    // e.g. "12.34" → 12_340_000
    const [whole, frac = ''] = s.split('.');
    const padded = (frac + '000000').slice(0, 6);
    return BigInt(whole) * 1_000_000n + BigInt(padded);
  }
  return null;
}

/** Cheap EIP-55 validator; throws in a res-friendly way if bad. */
function validAddr(x) {
  try {
    return ethers.getAddress(x);
  } catch {
    return null;
  }
}

/**
 * Return a labeled pool name: PoolNameOverride.name if set, else fall
 * back to whatever the caller passed. Matches the old nameFor helper's
 * contract so downstream renderers keep working.
 */
async function labelFor(poolAddress, fallback) {
  try {
    const override = await PoolNameOverride.findOne({ pubkey: poolAddress }).lean();
    if (override?.name) return override.name;
  } catch { /* schema not present yet on a fresh install — ignore */ }
  return fallback || `Pool ${poolAddress.slice(0, 6)}…${poolAddress.slice(-4)}`;
}

/**
 * Serialise a PoolState mongo doc + a fresh readPoolState snapshot into
 * the response shape the frontend expects. Preserves keys used by the
 * legacy Solana response so lender-v2 pages don't have to change their
 * field selectors mid-swap.
 */
function shapePoolResponse(mongoDoc, state) {
  return {
    pubkey:               state.poolAddress,
    admin:                mongoDoc?.admin || state.pspWallet,  // multisig; falls back to psp
    pspWallet:            state.pspWallet,
    pspName:              mongoDoc?.pspName || null,
    facilityId:           mongoDoc?.facilityId || null,
    usdcMint:             state.stablecoin,
    vault:                state.poolAddress,
    lpMint:               state.poolAddress,
    softCap:              state.softCap.toString(),
    hardCap:              state.hardCap.toString(),
    facilityTenorDays:    Number(state.tenure),
    // Rates: EVM stores WAD/day, old schema stored bps. Convert once so
    // the frontend can render both without changing its math. WAD → bps:
    //   bps = wad * 10_000 / 1e18
    utilizationRateBps:   Number((state.utilizedRateDaily * 10_000n) / 10n ** 18n),
    commitmentRateBps:    Number((state.idleRateDaily     * 10_000n) / 10n ** 18n),
    penaltyRateBps:       Number((state.penaltyRateDaily  * 10_000n) / 10n ** 18n),
    aprAnnualBps:         Number((state.aprAnnual         * 10_000n) / 10n ** 18n),
    graceDays:            Number(state.penaltyGraceDays),
    penaltyDays:          Number(state.penaltyGraceDays), // legacy alias
    protocolFeeShareBps:  0, // payfi_v1: protocol take is via TreasuryReserve; not a per-pool bps
    secondsPerDay:        86400,
    isActive:             state.status === 1,
    isCancelled:          state.status === 2,
    isDefaulted:          state.status === 4,
    createdDay:           state.fundingStartTs > 0n ? Number(state.fundingStartTs / 86400n) : 0,
    activatedDay:         state.poolStartTs > 0n ? Number(state.poolStartTs / 86400n) : 0,
    totalCapital:         state.principal.toString(),
    outstandingPrincipal: state.outstanding.toString(),
    availableToDd:        state.availableToDd.toString(),
    yieldOwed:            state.yieldOwed.toString(),
    fundingCredit:        state.fundingCredit.toString(),
    todayDay:             Number(state.currentDay),
    todayPeakOutstanding: state.outstanding.toString(), // best available proxy
    // Legacy fee counters — payfi_v1 exposes these via view getters we
    // haven't wired yet; TODO fill from getIdleFeesBreakdown +
    // getRepaymentBreakdown per drawdown. For now zeros so the FE renders.
    accruedCommitFee:     '0',
    accruedUtilFee:       '0',
    accruedPenaltyFee:    '0',
    protocolFeesOwed:     '0',
    nextDrawdownId:       '0',   // EVM drawdowns keyed by bytes32 refs, not incremental ids
    countActiveDrawdowns: 0,     // filled from Mongo below
  };
}

function poolMatchesState(p, state) {
  if (!state) return true;
  const s = String(state).toLowerCase();
  if (s === 'active')     return p.isActive;
  if (s === 'cancelled')  return p.isCancelled;
  if (s === 'defaulted')  return p.isDefaulted;
  if (s === 'closed')     return !p.isActive && !p.isCancelled && !p.isDefaulted;
  return true;
}

const NOT_IMPLEMENTED = (chunk) => (req, res) =>
  res.status(501).json({
    message: `Endpoint not yet implemented on EVM — see Chunk ${chunk}`,
    path: req.originalUrl,
  });

// ── Lender build-tx endpoints (LIVE) ───────────────────────────────────

router.post('/lender/build-tx/deposit', authMiddleware, async (req, res) => {
  try {
    if (req.user.kind !== 'lender') {
      return res.status(403).json({ message: 'Lender JWT required' });
    }
    const pool = validAddr(req.body?.pool);
    const amount = toBase(req.body?.amount);
    if (!pool)   return res.status(400).json({ message: 'pool (address) required' });
    if (amount === null || amount <= 0n) {
      return res.status(400).json({ message: 'amount required (base units or decimal string)' });
    }
    // Lender needs two txs to deposit: (1) approve() on stablecoin,
    // (2) deposit() on pool. Return both so wagmi can prompt sequentially.
    const approve = svc.encodeApprove(pool, amount);
    const deposit = svc.encodeDeposit(pool, amount);
    res.json({
      steps: [
        { label: 'Approve USDC',    tx: approve },
        { label: 'Deposit to pool', tx: deposit },
      ],
      // Also expose the top-level tx for callers that only take one step
      // (legacy shape compat).
      to: deposit.to,
      data: deposit.data,
      value: deposit.value.toString(),
    });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

router.post('/lender/build-tx/withdraw', authMiddleware, async (req, res) => {
  try {
    if (req.user.kind !== 'lender') {
      return res.status(403).json({ message: 'Lender JWT required' });
    }
    const pool = validAddr(req.body?.pool);
    const amount = toBase(req.body?.amount);
    if (!pool)   return res.status(400).json({ message: 'pool (address) required' });
    if (amount === null || amount <= 0n) {
      return res.status(400).json({ message: 'amount required' });
    }
    const tx = svc.encodeWithdraw(pool, amount);
    res.json({ to: tx.to, data: tx.data, value: tx.value.toString() });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

/**
 * Legacy "redeem LP" endpoint. payfi_v1 splits redeem into two txs:
 *   claimYield()      — mints yield to the LP
 *   claimPrincipal()  — returns principal after finality
 * We surface both as `steps[]`. Callers that only want the principal
 * (legacy behavior) can pull steps[1].tx.
 */
router.post('/lender/build-tx/redeem', authMiddleware, async (req, res) => {
  try {
    if (req.user.kind !== 'lender') {
      return res.status(403).json({ message: 'Lender JWT required' });
    }
    const pool = validAddr(req.body?.pool);
    if (!pool) return res.status(400).json({ message: 'pool (address) required' });

    const claimYield     = svc.encodeClaimYield(pool);
    const claimPrincipal = svc.encodeClaimPrincipal(pool);
    res.json({
      steps: [
        { label: 'Claim yield',     tx: claimYield },
        { label: 'Claim principal', tx: claimPrincipal },
      ],
      to: claimPrincipal.to,
      data: claimPrincipal.data,
      value: claimPrincipal.value.toString(),
    });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

// ── Lender read: portfolio (simplified for EVM) ────────────────────────

/**
 * Enumerate the lender's positions across all pools. Returns one entry
 * per pool where the lender's `getLpPosition().principal > 0`.
 *
 * Simplified vs. the Solana version: we don't compute realized/unrealized
 * yield deltas from event history yet (Chunk B3c wires the EVM indexer
 * to populate lifetime PoolAggregates). For now, current principal +
 * on-chain-derived claimable yield are enough for the lender-v2
 * Dashboard and MyInvestments views.
 */
router.get('/lender/portfolio', authMiddleware, async (req, res) => {
  try {
    if (req.user.kind !== 'lender') {
      return res.status(403).json({ message: 'Lender JWT required' });
    }
    const lender = validAddr(req.user.wallet);
    if (!lender) return res.status(400).json({ message: 'Invalid lender wallet on JWT' });

    // Wallet-side free USDC balance
    let walletUsdc = '0';
    try {
      walletUsdc = (await svc.balanceOfStablecoin(lender)).toString();
    } catch (e) {
      console.warn('[/lender/portfolio] balanceOfStablecoin failed:', e.message);
    }

    // Enumerate every known pool + read LP position
    const poolAddresses = await svc.readAllPools();
    const positions = [];
    let totalPrincipal = 0n;

    for (const poolAddress of poolAddresses) {
      let pos;
      try {
        pos = await svc.readLpPosition(poolAddress, lender);
      } catch (e) {
        console.warn('[/lender/portfolio] readLpPosition skipped', poolAddress, e.message);
        continue;
      }
      if (pos.principal === 0n && pos.claimedYield === 0n && pos.claimedPrincipal === 0n) {
        continue; // never touched this pool
      }
      totalPrincipal += pos.principal;
      positions.push({
        pool:               poolAddress,
        principal:          pos.principal.toString(),
        fundingCredit:      pos.fundingCredit.toString(),
        claimedYield:       pos.claimedYield.toString(),
        claimedPrincipal:   pos.claimedPrincipal.toString(),
        claimedOverrunYield: pos.claimedOverrunYield.toString(),
        claimedBonus:       pos.claimedBonus.toString(),
        finalized:          pos.finalized,
      });
    }

    res.json({
      lender,
      walletUsdc,
      totalPrincipal:   totalPrincipal.toString(),
      totalRedeemable:  '0',  // TODO wire once event indexer computes redemption value
      totalRealized:    '0',  // TODO ditto
      totalUnrealized:  '0',  // TODO ditto
      positions,
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── Public pool reads (LIVE) ───────────────────────────────────────────

router.get('/pool/:pool/state', async (req, res) => {
  try {
    const pool = validAddr(req.params.pool);
    if (!pool) return res.status(400).json({ message: 'Invalid pool address' });
    const state = await svc.readPoolState(pool);
    const mongoDoc = await PoolState.findOne({ pubkey: pool }).lean();
    const shaped = shapePoolResponse(mongoDoc, state);
    shaped.pspName = await labelFor(pool, shaped.pspName);
    // Count active drawdowns from Mongo mirror
    shaped.countActiveDrawdowns = await DrawdownState.countDocuments({
      pool, repaid: false,
    });
    res.json(shaped);
  } catch (e) {
    if (e.message?.includes('call revert')) {
      return res.status(404).json({ message: 'Pool not found on-chain' });
    }
    res.status(500).json({ message: e.message });
  }
});

router.get('/pool/:pool/drawdowns', async (req, res) => {
  try {
    const pool = validAddr(req.params.pool);
    if (!pool) return res.status(400).json({ message: 'Invalid pool address' });
    const includeRepaid = req.query.includeRepaid === 'true';
    const filter = { pool };
    if (!includeRepaid) filter.repaid = { $ne: true };
    const rows = await DrawdownState.find(filter).lean();
    res.json(rows.map((d) => ({
      pubkey:      d.pubkey,     // "<pool>:<ref>"
      id:          d.id,         // bytes32 ref
      principal:   d.principal,
      drawdownDay: d.drawdownDay,
      tenorDays:   d.tenorDays,
      repaid:      !!d.repaid,
    })));
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.get('/pools', async (req, res) => {
  try {
    const { state: qState } = req.query;
    const poolAddresses = await svc.readAllPools();

    const rows = [];
    for (const poolAddress of poolAddresses) {
      try {
        const state = await svc.readPoolState(poolAddress);
        const mongoDoc = await PoolState.findOne({ pubkey: poolAddress }).lean();
        const shaped = shapePoolResponse(mongoDoc, state);
        shaped.pspName = await labelFor(poolAddress, shaped.pspName);
        shaped.countActiveDrawdowns = await DrawdownState.countDocuments({
          pool: poolAddress, repaid: false,
        });
        rows.push(shaped);
      } catch (e) {
        console.warn('[/pools] skipping', poolAddress, e.message);
      }
    }
    res.json(rows.filter((p) => poolMatchesState(p, qState)));
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── PSP endpoints (STUBBED — Chunk B3b) ────────────────────────────────

router.post('/psp/build-tx/drawdown',
  authMiddleware, authorizeRoles('PSP'), NOT_IMPLEMENTED('B3b'));
router.post('/psp/build-tx/repay',
  authMiddleware, authorizeRoles('PSP'), NOT_IMPLEMENTED('B3b'));
router.post('/psp/build-tx/settle-commit-fee',
  authMiddleware, authorizeRoles('PSP'), NOT_IMPLEMENTED('B3b'));

// ── On-chain admin build-tx endpoints (STUBBED — Chunk B3b) ────────────

router.post('/admin/build-tx/initialize-pool',
  authMiddleware, NOT_IMPLEMENTED('B3b'));
router.post('/admin/build-tx/execute-facility',
  authMiddleware, NOT_IMPLEMENTED('B3b'));
router.post('/admin/build-tx/cancel-funding',
  authMiddleware, NOT_IMPLEMENTED('B3b'));
router.post('/admin/build-tx/claim-protocol-fees',
  authMiddleware, NOT_IMPLEMENTED('B3b'));
router.post('/admin/build-tx/declare-default',
  authMiddleware, NOT_IMPLEMENTED('B3b'));
router.post('/admin/build-tx/approve-psp',
  authMiddleware, NOT_IMPLEMENTED('B3b'));

// ── Analytics reads (STUBBED — Chunk B3c: needs event indexer buildup) ─

router.get('/pool/:pool/activity',       NOT_IMPLEMENTED('B3c'));
router.get('/pool/:pool/daily-activity', NOT_IMPLEMENTED('B3c'));
router.get('/pool/:pool/fee-aggregates', NOT_IMPLEMENTED('B3c'));

module.exports = router;
