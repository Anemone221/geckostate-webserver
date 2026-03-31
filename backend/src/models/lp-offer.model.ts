// lp-offer.model.ts
// Stores the items available in each NPC corporation's LP store.
// Fetched from ESI: GET /loyalty/stores/{corporation_id}/offers/
// Updated periodically (LP stores change rarely, but prices on required items change constantly).
//
// To redeem an LP offer you pay:
//   1. lpCost      — loyalty points from that corporation
//   2. iskCost     — flat ISK fee
//   3. requiredItems — other in-game items (e.g. a tag, a datacenter run item)
//
// Example: "Caldari Navy Antimatter Charge L"
//   lpCost: 1500
//   iskCost: 500000
//   requiredItems: [{ typeId: 17765, quantity: 1 }]  <- "Caldari Navy Tag" or similar
//   quantity: 100    <- you receive 100 charges per redemption

import mongoose, { Schema, Document } from 'mongoose';

interface IRequiredItem {
  typeId: number;
  quantity: number;
}

export interface ILpOffer extends Document {
  offerId: number;
  corporationId: number;
  typeId: number;        // The item you receive
  quantity: number;      // How many you receive per redemption
  lpCost: number;
  iskCost: number;
  requiredItems: IRequiredItem[];
  updatedAt: Date;
}

const RequiredItemSchema = new Schema<IRequiredItem>(
  { typeId: Number, quantity: Number },
  { _id: false }
);

const LpOfferSchema = new Schema<ILpOffer>({
  offerId:       { type: Number, required: true },
  corporationId: { type: Number, required: true, index: true },
  typeId:        { type: Number, required: true, index: true },
  quantity:      { type: Number, required: true },
  lpCost:        { type: Number, required: true },
  iskCost:       { type: Number, required: true },
  requiredItems: [RequiredItemSchema],
  updatedAt:     { type: Date, default: Date.now },
});

// Unique per offer per corp (offerId alone is unique within a corp's store)
LpOfferSchema.index({ corporationId: 1, offerId: 1 }, { unique: true });

export const LpOffer = mongoose.model<ILpOffer>('LpOffer', LpOfferSchema, 'lp_offers');
