// lp-balance.model.ts
// Stores the user's manually entered LP balance for each NPC corporation.
//
// Why manual? There is no ESI endpoint for corporation LP balances.
// The user opens the LP Analysis page, types in how many LP their corporation
// currently holds for a given corp store, and we store it here.
//
// Scoping:
//   LP balances are per-account (not per-character) because LP is transferable
//   between characters on the same account.
//
// Design rules:
//   - currentLp = null means "not entered yet" → shows "—" in UI
//   - currentLp = 0 means "you have zero LP" (explicitly entered)
//   - LP balance is NEVER used as a filter — all opportunities are always shown
//   - It only drives the optional "redemptions available" display column:
//       redemptions_available = floor(currentLp / offer.lpCost)

import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ILpBalance extends Document {
  corporationId: number;
  corporationName: string;
  /** Account this balance belongs to */
  accountId: Types.ObjectId;
  // The current LP balance for this corporation.
  // null = not yet entered by the user
  currentLp: number | null;
  updatedAt: Date;
}

const LpBalanceSchema = new Schema<ILpBalance>(
  {
    corporationId:   { type: Number, required: true },
    corporationName: { type: String, required: true },
    accountId:       { type: Schema.Types.ObjectId, ref: 'Account', required: true },
    currentLp:       { type: Number, default: null },
  },
  { timestamps: true }
);

// One balance per (account, corporation) pair
LpBalanceSchema.index({ accountId: 1, corporationId: 1 }, { unique: true });

export const LpBalance = mongoose.model<ILpBalance>('LpBalance', LpBalanceSchema, 'lp_balances');
