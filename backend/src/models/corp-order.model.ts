// corp-order.model.ts
// Stores corporation market orders fetched from ESI.
//
// ESI endpoint: GET /corporations/{corporation_id}/orders/
// Scope: esi-markets.read_corporation_orders.v1
//
// These are the corp's currently active buy/sell orders on the market.
// Synced every 15 minutes. Stale orders (filled/cancelled) are detected
// by comparing snapshotTime — if an order wasn't in the latest ESI response,
// it's been filled or cancelled and gets deleted.

import mongoose, { Schema, Document } from 'mongoose';

export interface ICorpOrder extends Document {
  orderId:        number;       // ESI: order_id
  corporationId:  number;       // the corporation that owns this order
  characterId:    number;       // who placed the order (ESI: issued_by)
  typeId:         number;       // item type being traded
  locationId:     number;       // station/structure where the order is placed
  regionId:       number;       // market region
  price:          number;       // ISK price per unit
  volumeRemain:   number;       // units still on the market
  volumeTotal:    number;       // original order size
  isBuyOrder:     boolean;      // true = buy order, false = sell order
  issued:         Date;         // when the order was placed
  duration:       number;       // order duration in days
  minVolume:      number;       // minimum volume per transaction
  range:          string;       // order range (station, system, region, etc.)
  escrow:         number | null; // ISK held in escrow (buy orders only)
  walletDivision: number;       // which corp wallet division (1–7)
  snapshotTime:   Date;         // when this data was last fetched from ESI
}

const CorpOrderSchema = new Schema<ICorpOrder>(
  {
    orderId:        { type: Number, required: true },
    corporationId:  { type: Number, required: true },
    characterId:    { type: Number, required: true },
    typeId:         { type: Number, required: true },
    locationId:     { type: Number, required: true },
    regionId:       { type: Number, required: true },
    price:          { type: Number, required: true },
    volumeRemain:   { type: Number, required: true },
    volumeTotal:    { type: Number, required: true },
    isBuyOrder:     { type: Boolean, required: true },
    issued:         { type: Date, required: true },
    duration:       { type: Number, required: true },
    minVolume:      { type: Number, required: true },
    range:          { type: String, required: true },
    escrow:         { type: Number, default: null },
    walletDivision: { type: Number, required: true },
    snapshotTime:   { type: Date, required: true },
  },
  { timestamps: true }
);

CorpOrderSchema.index({ orderId: 1 }, { unique: true });
CorpOrderSchema.index({ corporationId: 1 });
// For stale order deletion during sync (orders not in latest ESI response)
CorpOrderSchema.index({ corporationId: 1, snapshotTime: 1 });

export const CorpOrder = mongoose.model<ICorpOrder>('CorpOrder', CorpOrderSchema, 'corp_orders');
