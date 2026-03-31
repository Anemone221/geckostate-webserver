// offer-plan.model.ts
// Tracks which LP store offers the user has marked for planning or is actively running.
//
// Two statuses:
//   'planning' — "I'm considering adding this offer to my LP rotation"
//   'doing'    — "I'm actively buying LP and selling this item"
//
// corporationName and typeName are stored alongside the IDs so the Planning/Doing
// pages can display rows without making extra DB lookups per row.
//
// One record per (corporationId, offerId) — the unique index enforces this.
// PUT /api/offer-plans/:corpId/:offerId is an upsert so re-marking does not duplicate.

import mongoose, { Schema, Document } from 'mongoose';

export interface IOfferPlan extends Document {
  corporationId:   number;
  offerId:         number;
  typeId:          number;
  corporationName: string;
  typeName:        string;
  status:          'planning' | 'doing';
  addedAt:         Date;
}

const OfferPlanSchema = new Schema<IOfferPlan>({
  corporationId:   { type: Number, required: true },
  offerId:         { type: Number, required: true },
  typeId:          { type: Number, required: true },
  corporationName: { type: String, required: true },
  typeName:        { type: String, required: true },
  status:          { type: String, enum: ['planning', 'doing'], required: true },
  addedAt:         { type: Date, default: Date.now },
});

// Enforce uniqueness: one plan entry per (corp, offer) pair
OfferPlanSchema.index({ corporationId: 1, offerId: 1 }, { unique: true });

export const OfferPlan = mongoose.model<IOfferPlan>(
  'OfferPlan',
  OfferPlanSchema,
  'offer_plans'
);
