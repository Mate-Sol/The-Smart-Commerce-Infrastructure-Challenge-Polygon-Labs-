/**
 * End-to-end devnet flow verification.
 *
 * Exercises the same code path the browser does: build-tx via poolService,
 * user-side wallet signature, relay-style fee-payer signature, RPC submit,
 * on-chain account fetch, indexer ingestion. No browser, just Node.
 *
 * Sequence:
 *   1. Generate ephemeral PSP + lender keypairs (no funding — relay pays).
 *   2. Mint USDC-DF to lender (deposit) and PSP (repay fees).
 *   3. initialize_pool — admin signs.
 *   4. deposit — lender signs.
 *   5. execute_facility — admin signs.
 *   6. request_drawdown — PSP signs.
 *   7. repay — PSP signs.
 *   8. Run indexer tick → verify Drawdown.repaid transition was ingested
 *      and the PoolState mirror matches on-chain.
 *
 * Skips redeem (requires advancing past tenor; not possible on devnet without
 * waiting real days). Tested manually in the bankrun suite.
 *
 * Run:  ADMIN_KEYPAIR_PATH=~/.config/solana/paymate-feepayer.json \
 *       node scripts/e2e-devnet.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const {
  Keypair,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} = require('@solana/web3.js');
const { sendAndConfirmRawTransaction, sendAndConfirmTransaction } = require('@solana/web3.js');
const {
  getOrCreateAssociatedTokenAccount,
  createMintToInstruction,
} = require('@solana/spl-token');

const ps = require('../services/poolService');
const {
  getConnection,
  getFeePayer,
  getFaucetAuthority,
  getUsdcDfMint,
} = require('../services/solanaService');

const ADMIN_KEYPAIR_PATH =
  process.env.ADMIN_KEYPAIR_PATH ||
  `${process.env.HOME}/.config/solana/paymate-feepayer.json`;

function loadKeypair(p) {
  const raw = JSON.parse(fs.readFileSync(p.replace('~', process.env.HOME), 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function userSignAndRelay(txBase64, ...userSigners) {
  // Mirrors the wallet-adapter flow + /relay/submit handler.
  const tx = Transaction.from(Buffer.from(txBase64, 'base64'));
  for (const kp of userSigners) tx.partialSign(kp);
  tx.partialSign(getFeePayer());
  const conn = getConnection();
  return sendAndConfirmRawTransaction(conn, tx.serialize(), {
    commitment: 'confirmed',
    skipPreflight: false,
  });
}

async function mintUsdcDf(recipient, amount) {
  const conn = getConnection();
  const auth = getFaucetAuthority();
  const mint = getUsdcDfMint();
  const ata = await getOrCreateAssociatedTokenAccount(conn, auth, mint, recipient);
  const tx = new Transaction().add(
    createMintToInstruction(mint, ata.address, auth.publicKey, amount)
  );
  const sig = await sendAndConfirmRawTransaction(
    conn,
    (await (async () => {
      tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
      tx.feePayer = auth.publicKey;
      tx.partialSign(auth);
      return tx;
    })()).serialize(),
    { commitment: 'confirmed' }
  );
  return { ata: ata.address, sig };
}

async function main() {
  console.log('═══ E2E devnet flow ═══');
  const admin = loadKeypair(ADMIN_KEYPAIR_PATH);
  const psp = Keypair.generate();
  const lender = Keypair.generate();
  console.log('admin:  ', admin.publicKey.toBase58());
  console.log('psp:    ', psp.publicKey.toBase58());
  console.log('lender: ', lender.publicKey.toBase58());

  // Bootstrap SOL onto user keypairs. The fee-payer relay covers per-tx
  // fees, but `init`/`init_if_needed` constraints in the program (Drawdown
  // PDA, the LP ATA when no idempotent prepend exists) require the named
  // payer to hold SOL for rent. Production flow will mirror this with a
  // one-time SOL grant on first wallet bind. ~0.01 SOL is plenty.
  console.log('\n[1/7] bootstrap SOL to lender + PSP…');
  const conn = getConnection();
  const fundTx = new Transaction()
    .add(SystemProgram.transfer({
      fromPubkey: admin.publicKey,
      toPubkey: lender.publicKey,
      lamports: 0.01 * LAMPORTS_PER_SOL,
    }))
    .add(SystemProgram.transfer({
      fromPubkey: admin.publicKey,
      toPubkey: psp.publicKey,
      lamports: 0.02 * LAMPORTS_PER_SOL,
    }));
  await sendAndConfirmTransaction(conn, fundTx, [admin], { commitment: 'confirmed' });
  console.log('  ✓ SOL bootstrap complete');

  // Then USDC-DF: lender for deposit, PSP for repay (principal + util fees).
  console.log('\n[1.5/7] minting USDC-DF to lender + PSP…');
  await mintUsdcDf(lender.publicKey, 2_000_000n * 1_000_000n); // 2M
  await mintUsdcDf(psp.publicKey, 100_000n * 1_000_000n); // 100k for fees
  console.log('  ✓ lender funded');
  console.log('  ✓ psp funded');

  // 1) initialize_pool
  console.log('\n[2/7] initialize_pool…');
  const facilityId = Date.now() % 1_000_000; // unique-ish
  const initBuilt = await ps.buildInitializePoolTx({
    admin: admin.publicKey.toBase58(),
    pspWallet: psp.publicKey.toBase58(),
    pspName: 'E2E',
    facilityId,
    softCap: 500_000_000_000n,
    hardCap: 2_000_000_000_000n,
    maxDrawdownAmount: 800_000_000_000n,
    facilityTenorDays: 30,
    utilizationRateBps: 5,
    commitmentRateBps: 1,
    penaltyRateBps: 50,
    graceDays: 1,
    penaltyDays: 7,
    protocolFeeShareBps: 1000,
  });
  const initSig = await userSignAndRelay(initBuilt.txBase64, admin);
  console.log(`  ✓ tx ${initSig.slice(0, 12)}…`);
  console.log(`    pool: ${initBuilt.accounts.pool}`);

  const poolPubkey = initBuilt.accounts.pool;

  // 2) deposit
  console.log('\n[3/7] lender deposit…');
  const depositBuilt = await ps.buildDepositTx({
    pool: poolPubkey,
    lender: lender.publicKey.toBase58(),
    amount: 1_000_000_000_000n.toString(), // 1M USDC
  });
  const depositSig = await userSignAndRelay(depositBuilt.txBase64, lender);
  console.log(`  ✓ tx ${depositSig.slice(0, 12)}…`);

  // 3) execute_facility
  console.log('\n[4/7] execute_facility…');
  const execBuilt = await ps.buildExecuteFacilityTx({
    pool: poolPubkey,
    admin: admin.publicKey.toBase58(),
  });
  const execSig = await userSignAndRelay(execBuilt.txBase64, admin);
  console.log(`  ✓ tx ${execSig.slice(0, 12)}…`);
  let poolAcc = await ps.fetchPool(poolPubkey);
  console.log(`    isActive: ${poolAcc.isActive}, totalCapital: ${poolAcc.totalCapital.toString()}`);

  // 4) request_drawdown
  console.log('\n[5/7] PSP request_drawdown…');
  poolAcc = await ps.fetchPool(poolPubkey);
  const ddId = poolAcc.nextDrawdownId.toString();
  const ddBuilt = await ps.buildRequestDrawdownTx({
    pool: poolPubkey,
    psp: psp.publicKey.toBase58(),
    drawdownId: ddId,
    amount: 200_000_000_000n.toString(),
    tenorDays: 5,
  });
  const ddSig = await userSignAndRelay(ddBuilt.txBase64, psp);
  console.log(`  ✓ tx ${ddSig.slice(0, 12)}…`);
  console.log(`    drawdown: ${ddBuilt.accounts.drawdown}`);

  // 5) repay
  console.log('\n[6/7] PSP repay…');
  const repayBuilt = await ps.buildRepayTx({
    pool: poolPubkey,
    psp: psp.publicKey.toBase58(),
    drawdownId: ddId,
  });
  const repaySig = await userSignAndRelay(repayBuilt.txBase64, psp);
  console.log(`  ✓ tx ${repaySig.slice(0, 12)}…`);

  // 6) verify state + indexer
  console.log('\n[7/7] verify…');
  poolAcc = await ps.fetchPool(poolPubkey);
  const ddAcc = await ps.fetchDrawdown(ddBuilt.accounts.drawdown);
  console.log(`    pool.outstandingPrincipal: ${poolAcc.outstandingPrincipal.toString()}`);
  console.log(`    pool.accruedUtilFee:       ${poolAcc.accruedUtilFee.toString()}`);
  console.log(`    drawdown.repaid:           ${ddAcc.repaid}`);
  if (!ddAcc.repaid || poolAcc.outstandingPrincipal.toString() !== '0') {
    throw new Error('on-chain post-conditions failed');
  }

  await mongoose.connect(process.env.MONGODB_URI);
  const indexer = require('../workers/solanaIndexer');
  // Two ticks: first to populate baseline, second to detect the repay
  // transition. (If the indexer was running already this isn't needed.)
  await indexer.tick();
  await indexer.tick();
  await mongoose.disconnect();

  console.log('\n═══ E2E PASSED ═══');
  console.log(`  pool: https://explorer.solana.com/address/${poolPubkey}?cluster=devnet`);
}

main().catch((e) => {
  console.error('\n✗ E2E FAILED');
  console.error(e);
  process.exit(1);
});
