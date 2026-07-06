/**
 * Pool aggregates indexer — keeps `PoolAggregates` documents in sync
 * with on-chain events so `/pool/:pool/fee-aggregates` can read from
 * Mongo instead of paginating thousands of getTransaction calls per
 * request.
 *
 * Tracks lifetime sums for events the program does NOT itself
 * accumulate:
 *   - CommitFeeSettled.amount       → settledCommitLifetime
 *   - ProtocolFeesClaimed.amount    → protocolClaimedLifetime
 *   - LpRedeemed (yield portion)    → lenderRedeemedYieldLifetime
 *
 * Pool state fields (accruedUtilFee, accruedPenaltyFee, etc) are NOT
 * cached here — they're fresh on every read via fetchPoolMaybe and
 * combined with the cached event totals at request time.
 *
 * Sync strategy:
 *   - Cold start (no doc, or !bootstrapped): scan up to BOOTSTRAP_CAP
 *     signatures and aggregate from scratch. Mark bootstrapped=true.
 *   - Steady state: paginate getSignaturesForAddress({ until: cursor })
 *     to fetch only signatures newer than the cursor. Apply deltas.
 *   - Cursor purged from RPC (rare): fall back to full rebuild.
 *
 * Idempotency: incremental writes update totals + advance cursor in a
 * single $set. If the worker crashes mid-tick, the next tick re-reads
 * the old totals and re-processes the same new sigs to the same totals.
 *
 * Concurrency: pools processed sequentially per tick to avoid hammering
 * the RPC. Tick is guarded by an in-flight flag.
 */

const { PublicKey } = require('@solana/web3.js');
const ps = require('../services/poolService');
const { getConnection } = require('../services/solanaService');
const PoolAggregates = require('../models/PoolAggregates');
const PoolEvent = require('../models/PoolEvent');

// Convert anchor event data (PublicKey, BN, etc.) into JSON-safe values
// for Mongo storage. Mirrors the serializer in routes/poolTx.js.
function serializeEventData(d) {
  if (d === null || d === undefined) return d;
  if (typeof d === 'bigint') return d.toString();
  if (Array.isArray(d)) return d.map(serializeEventData);
  if (typeof d === 'object') {
    if (typeof d.toBase58 === 'function') return d.toBase58(); // PublicKey
    if (d.constructor?.name === 'BN' || (typeof d.toString === 'function' && d._bn)) {
      return d.toString();
    }
    const out = {};
    for (const k of Object.keys(d)) out[k] = serializeEventData(d[k]);
    return out;
  }
  return d;
}

// Devnet public RPC rate-limits aggressively; settings tuned to stay
// under the per-second quota without leaving aggregates too stale.
// All knobs env-overridable.
const DEFAULT_INTERVAL_MS = parseInt(process.env.POOL_AGGREGATES_INTERVAL_MS || '120000', 10);
const BOOTSTRAP_CAP       = parseInt(process.env.POOL_AGGREGATES_BOOTSTRAP_CAP || '500',  10);
const INCREMENTAL_CAP     = parseInt(process.env.POOL_AGGREGATES_INCREMENTAL_CAP || '300', 10);
// Throttle between getTransaction calls. 100ms = 10 calls/sec, well
// under devnet public's per-method quota.
const RPC_DELAY_MS        = parseInt(process.env.POOL_AGGREGATES_RPC_DELAY_MS || '120', 10);
// After we get a 429, sleep this long before retrying the next pool.
// Stops a hammering loop where each retry triggers another 429.
const RPC_429_BACKOFF_MS  = parseInt(process.env.POOL_AGGREGATES_429_BACKOFF_MS || '5000', 10);
const PAGE_SIZE = 200;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isRateLimited = (e) => /429|Too Many Requests|rate limit/i.test(e?.message || '');

let inFlight = false;
let cooldownUntil = 0;

// Pull all signatures for `pubkey` in a paged fashion. If `until` is
// set, only sigs newer than (and not including) it are returned. We
// stop early once `cap` sigs have been collected.
async function fetchSignatures(conn, pubkey, { until, cap }) {
  const all = [];
  let before;
  while (all.length < cap) {
    const params = { limit: PAGE_SIZE };
    if (before) params.before = before;
    if (until)  params.until  = until;
    const batch = await conn.getSignaturesForAddress(pubkey, params);
    if (batch.length === 0) break;
    all.push(...batch);
    before = batch[batch.length - 1].signature;
    if (batch.length < PAGE_SIZE) break;
  }
  return all;
}

// Replay events from a signature batch (oldest-first), persist each
// decoded event into PoolEvent (idempotent via unique index), and
// return delta sums for the tracked aggregates.
async function aggregateBatch(conn, program, poolPubkey, sigs) {
  const out = {
    settledCommit: 0n,
    protocolClaimed: 0n,
    lenderRedeemedYield: 0n,
    sigsProcessed: 0,
    eventsWritten: 0,
    counts: {},
  };
  // RPC returns newest-first; replay oldest-first so cursor advancement
  // can point at the newest sig consistently.
  for (let i = sigs.length - 1; i >= 0; i--) {
    // Throttle between getTransaction calls to stay under devnet's
    // per-method quota. Skipped if disabled (RPC_DELAY_MS=0 in env).
    if (RPC_DELAY_MS > 0 && i < sigs.length - 1) await sleep(RPC_DELAY_MS);
    const s = sigs[i];
    let tx;
    try {
      tx = await conn.getTransaction(s.signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      });
    } catch (e) {
      // 429? bubble up so caller can engage cooldown and stop the loop
      // early instead of continuing to thrash the RPC.
      if (isRateLimited(e)) throw e;
      /* otherwise skip unfetchable sig */ continue;
    }
    if (!tx?.meta?.logMessages) { out.sigsProcessed += 1; continue; }
    let eventIndex = 0;
    for (const log of tx.meta.logMessages) {
      const m = log.match(/^Program data: (.+)$/);
      if (!m) continue;
      try {
        const ev = program.coder.events.decode(m[1]);
        if (!ev) continue;
        const name = ev.name.charAt(0).toUpperCase() + ev.name.slice(1);
        out.counts[name] = (out.counts[name] || 0) + 1;
        const d = ev.data;

        // Aggregate sums
        if (name === 'CommitFeeSettled' && d.amount) {
          out.settledCommit += BigInt(d.amount.toString());
        } else if (name === 'ProtocolFeesClaimed' && d.amount) {
          out.protocolClaimed += BigInt(d.amount.toString());
        } else if (name === 'LpRedeemed' && d.usdcPaid && d.lpBurned) {
          const usd = BigInt(d.usdcPaid.toString());
          const lp  = BigInt(d.lpBurned.toString());
          if (usd > lp) out.lenderRedeemedYield += (usd - lp);
        }

        // Persist event row. Idempotent on (signature, eventIndex).
        const dataJson = serializeEventData(d);
        try {
          await PoolEvent.updateOne(
            { signature: s.signature, eventIndex },
            {
              $setOnInsert: {
                pool:        poolPubkey,
                signature:   s.signature,
                eventIndex,
                name,
                blockTime:   s.blockTime || null,
                slot:        s.slot || 0,
                data:        dataJson,
                lender:      typeof dataJson?.lender === 'string'   ? dataJson.lender   : null,
                drawdownPda: typeof dataJson?.drawdown === 'string' ? dataJson.drawdown : null,
              },
            },
            { upsert: true }
          );
          out.eventsWritten += 1;
        } catch (writeErr) {
          // Duplicate-key on (signature, eventIndex) is expected when
          // re-processing the same tx (worker crash recovery). Anything
          // else is unexpected — log but keep going.
          if (writeErr.code !== 11000) {
            console.warn('[poolAggregatesIndexer] event write failed:', writeErr.message);
          }
        }
        eventIndex += 1;
      } catch { /* not a decodable program-data line */ }
    }
    out.sigsProcessed += 1;
  }
  return out;
}

async function syncOne(poolPubkey) {
  const conn = getConnection();
  const program = ps.getProgram();

  const poolPk = new PublicKey(poolPubkey);
  let doc = await PoolAggregates.findOne({ pubkey: poolPubkey });
  const isBootstrapping = !doc || !doc.bootstrapped;

  // Fetch new signatures. On bootstrap we ignore any prior cursor and
  // sweep up to BOOTSTRAP_CAP sigs from genesis.
  let sigs;
  if (isBootstrapping) {
    sigs = await fetchSignatures(conn, poolPk, { cap: BOOTSTRAP_CAP });
  } else {
    try {
      sigs = await fetchSignatures(conn, poolPk, {
        until: doc.lastSyncedSignature,
        cap: INCREMENTAL_CAP,
      });
    } catch (e) {
      // Cursor likely purged — rebuild from scratch.
      console.warn(`[poolAggregatesIndexer] cursor lookup failed for ${poolPubkey.slice(0,8)}…, rebuilding:`, e.message);
      sigs = await fetchSignatures(conn, poolPk, { cap: BOOTSTRAP_CAP });
      doc = null; // force rebuild path
    }
  }

  if (sigs.length === 0 && doc) {
    // Nothing new. Just bump lastSyncedAt so monitoring sees liveness.
    await PoolAggregates.updateOne(
      { pubkey: poolPubkey },
      { $set: { lastSyncedAt: new Date() } }
    );
    return { poolPubkey, sigs: 0, deltas: null };
  }

  const delta = await aggregateBatch(conn, program, poolPubkey, sigs);

  // Compose new totals. On bootstrap we replace; on incremental we add.
  const newTotals = (!doc || isBootstrapping)
    ? {
        settledCommitLifetime:        delta.settledCommit.toString(),
        protocolClaimedLifetime:      delta.protocolClaimed.toString(),
        lenderRedeemedYieldLifetime:  delta.lenderRedeemedYield.toString(),
        totalSigsSeen:                delta.sigsProcessed,
        eventsByName:                 delta.counts,
      }
    : {
        settledCommitLifetime:        (BigInt(doc.settledCommitLifetime || '0')        + delta.settledCommit).toString(),
        protocolClaimedLifetime:      (BigInt(doc.protocolClaimedLifetime || '0')      + delta.protocolClaimed).toString(),
        lenderRedeemedYieldLifetime:  (BigInt(doc.lenderRedeemedYieldLifetime || '0')  + delta.lenderRedeemedYield).toString(),
        totalSigsSeen:                (doc.totalSigsSeen || 0) + delta.sigsProcessed,
        eventsByName:                 mergeCounts(doc.eventsByName || {}, delta.counts),
      };

  // Newest sig in the batch (sigs are returned newest-first).
  const newestSig = sigs[0]?.signature || doc?.lastSyncedSignature || null;
  const newestSlot = sigs[0]?.slot || doc?.lastSyncedSlot || 0;

  await PoolAggregates.findOneAndUpdate(
    { pubkey: poolPubkey },
    {
      $set: {
        ...newTotals,
        lastSyncedSignature: newestSig,
        lastSyncedSlot:      newestSlot,
        lastSyncedAt:        new Date(),
        bootstrapped:        true,
      },
    },
    { upsert: true }
  );

  return { poolPubkey, sigs: sigs.length, deltas: delta };
}

function mergeCounts(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] || 0) + v;
  return out;
}

async function tick() {
  if (inFlight) {
    console.log('[poolAggregatesIndexer] previous tick still running; skipping');
    return;
  }
  if (Date.now() < cooldownUntil) {
    // Recently 429'd — let the RPC breathe for a bit.
    return;
  }
  inFlight = true;
  const start = Date.now();
  try {
    const pools = await ps.fetchAllPools();
    let synced = 0;
    let totalNewSigs = 0;
    for (const p of pools) {
      try {
        const r = await syncOne(p.publicKey.toBase58());
        if (r.sigs > 0) { synced += 1; totalNewSigs += r.sigs; }
      } catch (e) {
        if (isRateLimited(e)) {
          cooldownUntil = Date.now() + RPC_429_BACKOFF_MS;
          console.warn(`[poolAggregatesIndexer] RPC 429 — cooling down for ${RPC_429_BACKOFF_MS}ms`);
          break; // stop hammering this tick
        }
        console.warn(`[poolAggregatesIndexer] sync failed for ${p.publicKey.toBase58().slice(0,8)}…:`, e.message);
      }
    }
    const elapsed = Date.now() - start;
    if (synced > 0) {
      console.log(`[poolAggregatesIndexer] tick ${elapsed}ms — pools=${pools.length} updated=${synced} newSigs=${totalNewSigs}`);
    }
  } catch (e) {
    if (isRateLimited(e)) {
      cooldownUntil = Date.now() + RPC_429_BACKOFF_MS;
    }
    console.error('[poolAggregatesIndexer] tick error:', e.message);
  } finally {
    inFlight = false;
  }
}

function start(intervalMs = DEFAULT_INTERVAL_MS) {
  console.log(`[poolAggregatesIndexer] starting; interval=${intervalMs}ms bootstrapCap=${BOOTSTRAP_CAP}`);
  // Brief delay so server boot finishes first; let solanaIndexer's first
  // tick discover pools before we pile on getSignaturesForAddress calls.
  setTimeout(tick, 8000);
  setInterval(tick, intervalMs);
}

// Polite wrapper for endpoint cold-path use. Returns immediately if
// the worker is already in a tick or in 429 cooldown — so a thundering
// herd of requests won't pile sync calls on top of an already-busy or
// already-rate-limited RPC. Failures are swallowed; caller sees the
// (possibly empty) cached state and renders a skeleton.
async function tryInlineSync(poolPubkey) {
  if (inFlight) return { skipped: 'worker busy' };
  if (Date.now() < cooldownUntil) return { skipped: 'rpc cooldown' };
  try { return await syncOne(poolPubkey); }
  catch (e) {
    if (isRateLimited(e)) {
      cooldownUntil = Date.now() + RPC_429_BACKOFF_MS;
      return { skipped: 'rate limited' };
    }
    return { skipped: e.message };
  }
}

module.exports = { start, tick, syncOne, tryInlineSync };
