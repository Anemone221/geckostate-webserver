// lp-store-rate.model.ts
// Stores the user's estimated ISK-per-LP value for each NPC corporation's LP store.
//
// Why is this per-corporation?
//   LP value varies dramatically by store and current market conditions:
//     - Blood Raiders: ~3,000 ISK/LP (high-value faction items)
//     - Tribal Liberation Force: ~800 ISK/LP (faction warfare, high supply)
//     - CONCORD: ~1,500 ISK/LP (incursion rewards)
//
// Scoping:
//   LP rates are per-account (not per-character) because LP is transferable
//   between characters and purchase rates (donation-based) are the same.
//
//   Records with accountId = null are the SDE seed rows (corp names/IDs only).
//   Records with an accountId are the user's actual rates for that account.
//
// This collection is seeded from the SDE npcCorporations data (corp names/IDs).
// Users then fill in their iskPerLp value for each corp they run content for.

import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ILpStoreRate extends Document {
  corporationId: number;
  corporationName: string;
  /** Account this rate belongs to. null = SDE seed row (just holds corp name). */
  accountId: Types.ObjectId | null;
  // ISK value of 1 LP from this corporation's store.
  // null = user hasn't set this yet (shown as "—" in the UI, not 0)
  iskPerLp: number | null;
  updatedAt: Date;
}

const LpStoreRateSchema = new Schema<ILpStoreRate>(
  {
    corporationId:   { type: Number, required: true },
    corporationName: { type: String, required: true },
    accountId:       { type: Schema.Types.ObjectId, ref: 'Account', default: null },
    iskPerLp:        { type: Number, default: null },
  },
  { timestamps: true }
);

// Compound unique: one rate per (account, corporation) pair.
// SDE seed rows have accountId=null, so they get unique corporationId too.
LpStoreRateSchema.index({ accountId: 1, corporationId: 1 }, { unique: true });

export const LpStoreRate = mongoose.model<ILpStoreRate>(
  'LpStoreRate',
  LpStoreRateSchema,
  'lp_store_rates'
);
