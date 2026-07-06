/**
 * Solana indexer — polls program accounts and mirrors on-chain Pool +
 * Drawdown PDAs into Mongo (`PoolState` / `DrawdownState`).
 *
 * Why polling for v1: free, simple, no extra infra. devnet RPC handles
 * `getProgramAccounts(programId)` cheaply at our scale (handful of pools,
 * tens of drawdowns). When traffic justifies, swap the polling loop for
 * Helius webhooks or a geyser plugin without changing downstream readers.
 *
 * Drift detection: after each tick, compare PoolState.outstandingPrincipal
 * to the sum of unrepaid DrawdownState.principal for that pool, plus
 * compare PSPProfile.assignedPoolAddress consistency. Mismatches are
 * logged as warnings (not errors — drift can be transient if a tx is in
 * flight when the snapshot was taken).
 *
 * Concurrency: a single setInterval; tick is awaited end-to-end so we
 * never overlap. If RPC is slow and a tick takes >15s, the next tick is
 * skipped (a flag-based guard, not a queue).
 */

const ps = require('../services/poolService');
const { PoolState, DrawdownState } = require('../models/PoolState');
const PSPProfile = require('../models/PSPProfile');
const FinancingRequest = require('../models/FinancingRequest');
const RepaymentRecord = require('../models/RepaymentRecord');

const DEFAULT_INTERVAL_MS = parseInt(process.env.SOLANA_INDEXER_INTERVAL_MS || '45000', 10);
const RPC_429_BACKOFF_MS  = parseInt(process.env.SOLANA_INDEXER_429_BACKOFF_MS || '15000', 10);

let inFlight = false;
let cooldownUntil = 0;
const isRateLimited = (e) => /429|Too Many Requests|rate limit/i.test(e?.message || '');

function poolToDoc(p) {
  const a = p.account;
  return {
    pubkey: p.publicKey.toBase58(),
    admin: a.admin.toBase58(),
    pspWallet: a.pspWallet.toBase58(),
    pspName: a.pspName,
    facilityId: a.facilityId.toString(),
    usdcMint: a.usdcMint.toBase58(),
    vault: a.vault.toBase58(),
    lpMint: a.lpMint.toBase58(),
    softCap: a.softCap.toString(),
    hardCap: a.hardCap.toString(),
    maxDrawdownAmount: a.maxDrawdownAmount.toString(),
    facilityTenorDays: a.facilityTenorDays,
    utilizationRateBps: a.utilizationRateBps,
    commitmentRateBps: a.commitmentRateBps,
    penaltyRateBps: a.penaltyRateBps,
    graceDays: a.graceDays,
    penaltyDays: a.penaltyDays,
    protocolFeeShareBps: a.protocolFeeShareBps,
    isActive: a.isActive,
    isCancelled: a.isCancelled,
    isDefaulted: a.isDefaulted,
    createdDay: a.createdDay,
    activatedDay: a.activatedDay,
    totalCapital: a.totalCapital.toString(),
    outstandingPrincipal: a.outstandingPrincipal.toString(),
    todayDay: a.todayDay,
    todayPeakOutstanding: a.todayPeakOutstanding.toString(),
    accruedCommitFee: a.accruedCommitFee.toString(),
    accruedUtilFee: a.accruedUtilFee.toString(),
    accruedPenaltyFee: a.accruedPenaltyFee.toString(),
    protocolFeesOwed: a.protocolFeesOwed.toString(),
    nextDrawdownId: a.nextDrawdownId.toString(),
    countActiveDrawdowns: a.countActiveDrawdowns,
    lastIndexedAt: new Date(),
  };
}

function drawdownToDoc(d) {
  const a = d.account;
  return {
    pubkey: d.publicKey.toBase58(),
    pool: a.pool.toBase58(),
    id: a.id.toString(),
    principal: a.principal.toString(),
    drawdownDay: a.drawdownDay,
    tenorDays: a.tenorDays,
    repaid: a.repaid,
    lastIndexedAt: new Date(),
  };
}

async function syncPools() {
  const pools = await ps.fetchAllPools();
  // Use a tolerant fetch for drawdowns too — a Drawdown PDA created
  // before a layout change would otherwise crash the whole tick.
  const drawdowns = await ps.fetchAllDrawdowns();

  for (const p of pools) {
    const doc = poolToDoc(p);
    await PoolState.findOneAndUpdate(
      { pubkey: doc.pubkey },
      { $set: doc },
      { upsert: true }
    );
  }

  // Snapshot prior drawdown.repaid so we can ingest the false→true transition
  // as a repayment event (no separate log scraper needed for v1).
  const priorRepaid = new Map();
  const priorDrawdownDocs = await DrawdownState.find();
  for (const d of priorDrawdownDocs) priorRepaid.set(d.pubkey, d.repaid);

  let repaidIngested = 0;
  for (const d of drawdowns) {
    const doc = drawdownToDoc(d);
    const prior = priorRepaid.get(doc.pubkey);
    await DrawdownState.findOneAndUpdate(
      { pubkey: doc.pubkey },
      { $set: doc },
      { upsert: true }
    );
    // Detect false → true transition (or first-time observation already
    // repaid, which we treat as a missed event we want to record once).
    if (doc.repaid && prior !== true) {
      const ingested = await ingestRepayment(doc);
      if (ingested) repaidIngested += 1;
    }
  }

  return { pools: pools.length, drawdowns: drawdowns.length, repaidIngested };
}

// Map a drawdown that just transitioned to repaid into Mongo records:
// 1. Find the FinancingRequest correlated by drawdownPda; flip status to Repaid.
// 2. Create a RepaymentRecord with principal + chain-derived fee figures.
// Idempotent: a duplicate observation (e.g. indexer restart) sees the
// FinancingRequest already in 'Repaid' and bails.
async function ingestRepayment(drawdownDoc) {
  try {
    const fr = await FinancingRequest.findOne({ drawdownPda: drawdownDoc.pubkey });
    if (!fr) {
      // No correlated FinancingRequest — could be a drawdown initiated
      // directly on-chain without going through the off-chain workflow.
      // Log and skip; nothing to update.
      console.log(
        `[solanaIndexer] repaid drawdown ${drawdownDoc.pubkey} has no FinancingRequest`
      );
      return false;
    }
    if (fr.status === 'Repaid') return false; // already ingested

    const principal = Number(BigInt(drawdownDoc.principal) / 1_000_000n); // base units → USDC

    fr.status = 'Repaid';
    fr.repaidAt = new Date();
    fr.remainingPrincipal = 0;
    fr.totalInterestSettled = fr.totalInterestSettled || 0;
    await fr.save();

    // Pool-level accrued fees are a running total across all repays for
    // this pool, not per-drawdown. We snapshot them as a reference; exact
    // per-drawdown attribution requires log scraping (Phase 4+).
    await RepaymentRecord.create({
      financingRequestId: fr._id,
      pspId: fr.pspId,
      principalAmount: principal,
      expectedInterest: 0,
      actualInterestPaid: 0,
      totalRepayment: principal,
      txHash: null,
      blockNumber: null,
      creditLineRestored: principal,
      receiptId: `SOLANA-${drawdownDoc.pubkey.slice(0, 8)}`,
      replenishmentType: 'principal',
      status: 'Completed',
      repaymentDate: new Date(),
    });

    console.log(
      `[solanaIndexer] ingested repayment for FinancingRequest ${fr._id} (drawdown ${drawdownDoc.pubkey.slice(0, 8)}…, principal ${principal})`
    );
    return true;
  } catch (e) {
    console.error('[solanaIndexer] ingestRepayment failed:', e.message);
    return false;
  }
}

async function detectDrift() {
  const issues = [];

  // 1. Each PSPProfile.assignedPoolAddress should reference an existing pool
  //    whose pspWallet matches PSPProfile.solanaWallet.
  //    Filter has to exclude '' AND null AND missing — Mongo's $ne matches
  //    null/undefined too, so a $nin guard avoids false-positive drift
  //    spam for profiles that simply haven't been assigned a pool yet.
  const profiles = await PSPProfile.find({
    assignedPoolAddress: { $nin: ['', null], $exists: true },
  });
  for (const profile of profiles) {
    if (!profile.assignedPoolAddress) continue;
    const pool = await PoolState.findOne({ pubkey: profile.assignedPoolAddress });
    if (!pool) {
      issues.push({
        kind: 'pool_missing',
        profileId: profile._id.toString(),
        assignedPoolAddress: profile.assignedPoolAddress,
      });
      continue;
    }
    if (pool.pspWallet !== profile.solanaWallet) {
      issues.push({
        kind: 'wallet_mismatch',
        profileId: profile._id.toString(),
        pool: pool.pubkey,
        onChain: pool.pspWallet,
        offChain: profile.solanaWallet,
      });
    }
  }

  // 2. Outstanding principal == sum of unrepaid drawdowns. The on-chain
  //    contract enforces this invariant, but a stale tick could surface
  //    a transient mismatch — log only, do not act.
  const allPools = await PoolState.find();
  for (const pool of allPools) {
    const unpaid = await DrawdownState.find({ pool: pool.pubkey, repaid: false });
    const sum = unpaid.reduce((acc, d) => acc + BigInt(d.principal), 0n);
    if (sum.toString() !== pool.outstandingPrincipal) {
      issues.push({
        kind: 'outstanding_mismatch',
        pool: pool.pubkey,
        onChainOutstanding: pool.outstandingPrincipal,
        sumOfUnrepaidDrawdowns: sum.toString(),
      });
    }
  }

  return issues;
}

async function tick() {
  if (inFlight) {
    console.log('[solanaIndexer] previous tick still running; skipping');
    return;
  }
  if (Date.now() < cooldownUntil) return;
  inFlight = true;
  const start = Date.now();
  try {
    const counts = await syncPools();
    const drift = await detectDrift();
    const elapsed = Date.now() - start;
    const ingested = counts.repaidIngested ? ` ingested=${counts.repaidIngested}` : '';
    if (drift.length > 0) {
      console.warn(
        `[solanaIndexer] tick ${elapsed}ms — pools=${counts.pools} drawdowns=${counts.drawdowns}${ingested} DRIFT=${drift.length}`,
        drift
      );
    } else {
      console.log(
        `[solanaIndexer] tick ${elapsed}ms — pools=${counts.pools} drawdowns=${counts.drawdowns}${ingested}`
      );
    }
  } catch (e) {
    if (isRateLimited(e)) {
      cooldownUntil = Date.now() + RPC_429_BACKOFF_MS;
      console.warn(`[solanaIndexer] RPC 429 — cooling down for ${RPC_429_BACKOFF_MS}ms`);
    } else {
      console.error('[solanaIndexer] tick error:', e.message);
    }
  } finally {
    inFlight = false;
  }
}

function start(intervalMs = DEFAULT_INTERVAL_MS) {
  console.log(`[solanaIndexer] starting; interval=${intervalMs}ms`);
  setTimeout(tick, 5000); // brief delay so server boot finishes first
  setInterval(tick, intervalMs);
}

module.exports = { start, tick, syncPools, detectDrift };
