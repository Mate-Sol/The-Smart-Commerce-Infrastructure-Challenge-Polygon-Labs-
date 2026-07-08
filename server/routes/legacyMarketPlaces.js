/**
 * Legacy v2 marketplaces shim.
 *
 * Serves the /marketPlaces/* URL contract the defa_v2_mainnet client
 * expects, backed by our EVM pool data. Two endpoints:
 *
 *   POST /marketPlaces/getAlldealsnew
 *     Body:   { id, role } (ignored; kept for shape compat)
 *     Query:  sortingOrder, search, status, blockChainType, page, limit, riskType
 *     Returns { data: [...deals], pagination: { totalPages, totalItems } }
 *
 *   GET /marketPlaces/getDealsById/:id
 *     :id is the pool contract address (0x…).
 *     Returns the single deal object (v2 deal shape).
 *
 * All pool data is fetched via poolServiceEvm.readPoolState / readAllPools
 * then mapped into the deal shape defa_v2's UI components (PoolWideCard,
 * PoolInfoCard, DepositForm) already know how to render — same mapping the
 * client-side poolAdapter.js does, mirrored here to keep the v2 client
 * unmodified.
 */

'use strict';

const express = require('express');
const router = express.Router();

const svc = require('../services/poolServiceEvm');
const { PoolState } = require('../models/PoolState');
const PoolNameOverride = require('../models/PoolNameOverride');

// ── Formatters (mirrored from client-side lender-v2/libs/poolAdapter) ──

function usdcFromBase(base) {
  const bi = BigInt(base?.toString() || '0');
  const dollars = bi / 1_000_000n;
  const cents = Number((bi % 1_000_000n) / 10_000n) / 100;
  return Number(dollars) + cents;
}

function poolRiskLevel(aprBps) {
  const apr = Number(aprBps || 0);
  if (apr <= 800)  return 'Low';
  if (apr <= 1500) return 'Medium';
  return 'High';
}

function statusFor(state) {
  if (state.status === 4) return 'defaulted';
  if (state.status === 2) return 'unfulfilled';
  if (state.status === 1) return 'lending';    // → formats to OPEN in the UI
  return 'closed';
}

function wadToBps(wad) {
  return Number((BigInt(wad || 0) * 10_000n) / 10n ** 18n);
}

async function labelFor(poolAddress, fallback) {
  try {
    // Schema field is `poolPda` (legacy name from Solana era; we store
    // the 0x… EVM address there).
    const override = await PoolNameOverride.findOne({ poolPda: poolAddress }).lean();
    if (override?.displayName) return override.displayName;
  } catch { /* schema optional */ }
  return fallback || `Pool ${poolAddress.slice(0, 6)}…${poolAddress.slice(-4)}`;
}

async function mapPoolToDeal(poolAddress) {
  const state = await svc.readPoolState(poolAddress);
  const mongoDoc = await PoolState.findOne({ pubkey: poolAddress }).lean();
  const aprBps = wadToBps(state.aprAnnual);

  const loanAmount    = usdcFromBase(state.hardCap);
  const softCap       = usdcFromBase(state.softCap);
  const amountRaised  = usdcFromBase(state.principal);
  const outstanding   = usdcFromBase(state.outstanding);
  const availableToDd = usdcFromBase(state.availableToDd);
  const yieldOwed     = usdcFromBase(state.yieldOwed);

  const status = statusFor(state);
  const risk = poolRiskLevel(aprBps);
  const label = await labelFor(poolAddress, mongoDoc?.pspName);

  const createdMs   = state.fundingStartTs > 0n ? Number(state.fundingStartTs) * 1000 : null;
  const activatedMs = state.poolStartTs > 0n    ? Number(state.poolStartTs)    * 1000 : null;
  const finalityMs  = state.poolFinalityTs > 0n ? Number(state.poolFinalityTs) * 1000 : null;

  return {
    _id:              poolAddress,
    pubkey:           poolAddress,
    poolName:         label,
    poolAddress,
    status,
    poolRiskLevel:    risk,
    date:             createdMs ? new Date(createdMs).toDateString() : null,
    chain:            'evm',

    poolMatureTime:   finalityMs ? Math.floor(finalityMs / 1000) : null,
    poolEndTime:      finalityMs ? Math.floor(finalityMs / 1000) : null,
    createdAt:        createdMs  ? new Date(createdMs).toISOString() : null,

    poolAmountRaised: amountRaised,
    // Empty array shape — v2 PoolDetails does `.find(...)` on this.
    poolLenders:      [],

    overview: {
      loanAmount,
      loanTenure:    Number(state.tenure),
      dealExpiresIn: 7,                                  // funding window in days (approx)
      liquidityPool: `${risk} Risk Pool`,
    },

    tokenized: {
      statusDate: activatedMs ? new Date(activatedMs).toISOString() : null,
    },

    // Extras that some v2 components read even though we treat them as
    // "not in the original mock." Free of type constraints.
    apyRate:      `${(aprBps / 100).toFixed(2)}%`,
    apy:          (aprBps / 100).toFixed(2),
    apyBps:       aprBps,
    loanTenure:   `${Number(state.tenure)} days`,
    remainingDays: 0,
    totalLoan:    `$ ${loanAmount.toFixed(2)}`,
    outstanding,
    availableToDd,
    yieldOwed,
    softCap,
    stablecoin:   state.stablecoin,
    pspWallet:    state.pspWallet,
  };
}

// ── POST /marketPlaces/getAlldealsnew ──────────────────────────────────

router.post('/getAlldealsnew', async (req, res) => {
  try {
    const {
      status,
      blockChainType,       // ignored — single chain per deploy
      page = 1,
      limit = 6,
      riskType,
    } = req.query;

    // Fetch every pool + map. On small hackathon-scale (< dozens of pools)
    // per-pool state calls are cheap; add pagination on-chain later if it
    // ever gets tight.
    const poolAddresses = await svc.readAllPools();
    let deals = [];
    for (const addr of poolAddresses) {
      try {
        deals.push(await mapPoolToDeal(addr));
      } catch (e) {
        console.warn('[/marketPlaces/getAllDealsnew] skip', addr, e.message);
      }
    }

    // Status filter mapping:
    //   All      → no filter
    //   Open     → lending (deposit-open) OR default active
    //   Active   → lending
    //   Settled  → closed (post-finality)
    if (status && status !== 'All') {
      const s = String(status).toLowerCase();
      if (s === 'open' || s === 'active') deals = deals.filter((d) => d.status === 'lending');
      else if (s === 'settled') deals = deals.filter((d) => d.status === 'closed');
    }
    if (riskType && riskType !== 'All') {
      const r = String(riskType);
      if (['Low', 'Medium', 'High'].includes(r)) deals = deals.filter((d) => d.poolRiskLevel === r);
    }

    const totalItems = deals.length;
    const pageN  = Math.max(1, Number(page) || 1);
    const limitN = Math.max(1, Number(limit) || 6);
    const start  = (pageN - 1) * limitN;
    const paged  = deals.slice(start, start + limitN);
    const totalPages = Math.max(1, Math.ceil(totalItems / limitN));

    res.json({ data: paged, pagination: { totalPages, totalItems, page: pageN, limit: limitN } });
  } catch (e) {
    console.error('[/marketPlaces/getAllDealsnew]', e.message);
    res.status(500).json({ message: e.message });
  }
});

// ── GET /marketPlaces/getDealsById/:id ─────────────────────────────────

router.get('/getDealsById/:id', async (req, res) => {
  try {
    const poolAddress = req.params.id;
    if (!poolAddress?.startsWith('0x')) {
      return res.status(400).json({ message: 'Invalid pool address' });
    }
    const deal = await mapPoolToDeal(poolAddress);
    res.json(deal);
  } catch (e) {
    console.error('[/marketPlaces/getDealsById]', e.message);
    if (e.message?.includes('call revert')) {
      return res.status(404).json({ message: 'Pool not found on-chain' });
    }
    res.status(500).json({ message: e.message });
  }
});

module.exports = router;
