const mongoose = require('mongoose');

/**
 * Lender — wallet-only identity. No email, no password. Created lazily on
 * first successful wallet-signature login. Holds optional metadata that
 * the lender can add later from their portal.
 *
 * Lenders are distinct from `User` (which holds email-based PSP/admin
 * accounts). They never authenticate via the email/password flow.
 */
const LenderSchema = new mongoose.Schema(
  {
    wallet: { type: String, required: true, unique: true, index: true },
    displayName: { type: String, default: '' },
    contactEmail: { type: String, default: '' }, // optional, opt-in for close-out notifications
    lastLoginAt: { type: Date, default: null },
    loginCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Lender', LenderSchema);
