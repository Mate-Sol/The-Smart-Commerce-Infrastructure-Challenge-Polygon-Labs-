// One-off admin mint of USDC-DF (the fake USDC used on devnet).
//
// Bypasses the public faucet's per-claim grant + lifetime cap so we can
// fund a lender or PSP wallet with whatever amount we need for testing.
//
// Run with:
//   node server/scripts/adminMintUsdc.js <RECIPIENT_WALLET> <AMOUNT_USDC>
// e.g.
//   node server/scripts/adminMintUsdc.js FYtAk1Kav... 750000

require('dotenv').config({ path: __dirname + '/../.env' });
const { Connection, Keypair, PublicKey, sendAndConfirmTransaction, Transaction } = require('@solana/web3.js');
const {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getAccount,
  TOKEN_PROGRAM_ID,
} = require('@solana/spl-token');

(async () => {
  const [recipientStr, amountUsdcStr] = process.argv.slice(2);
  if (!recipientStr || !amountUsdcStr) {
    console.error('Usage: node adminMintUsdc.js <RECIPIENT_WALLET> <AMOUNT_USDC>');
    process.exit(1);
  }

  const rpc       = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
  const mintStr   = process.env.USDC_DF_MINT_ADDRESS;
  const authJson  = process.env.FAUCET_AUTHORITY_PRIVATE_KEY;
  if (!mintStr || !authJson) {
    console.error('USDC_DF_MINT_ADDRESS and FAUCET_AUTHORITY_PRIVATE_KEY must be set in .env');
    process.exit(1);
  }

  const conn = new Connection(rpc, 'confirmed');
  const mintAuthority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(authJson)));
  const mint = new PublicKey(mintStr);
  const recipient = new PublicKey(recipientStr);
  const amountBase = BigInt(Math.round(Number(amountUsdcStr) * 1_000_000)); // USDC has 6 decimals

  console.log(`RPC:               ${rpc}`);
  console.log(`Mint:              ${mint.toBase58()}`);
  console.log(`Mint authority:    ${mintAuthority.publicKey.toBase58()}`);
  console.log(`Recipient:         ${recipient.toBase58()}`);
  console.log(`Amount:            ${amountUsdcStr} USDC-DF (${amountBase} base units)`);

  const recipientAta = getAssociatedTokenAddressSync(mint, recipient);
  console.log(`Recipient ATA:     ${recipientAta.toBase58()}`);

  // Idempotent ATA creation + mintTo, in one tx.
  const tx = new Transaction()
    .add(createAssociatedTokenAccountIdempotentInstruction(
      mintAuthority.publicKey, recipientAta, recipient, mint
    ))
    .add(createMintToInstruction(
      mint, recipientAta, mintAuthority.publicKey, amountBase, [], TOKEN_PROGRAM_ID
    ));

  console.log('\nSubmitting mint tx…');
  const sig = await sendAndConfirmTransaction(conn, tx, [mintAuthority]);
  console.log(`Signature:         ${sig}`);

  const balanceAfter = await getAccount(conn, recipientAta);
  console.log(`Balance after:     ${(Number(balanceAfter.amount) / 1_000_000).toLocaleString()} USDC-DF`);
  console.log(`Explorer:          https://explorer.solana.com/tx/${sig}?cluster=devnet`);
  process.exit(0);
})().catch((e) => {
  console.error('Mint failed:', e.message || e);
  process.exit(1);
});
