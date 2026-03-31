// market-order.model.ts
// Stores a snapshot of currently active market orders from ESI.
// Updated hourly by the market-sync cron job.
//
// An "order" is an active buy or sell listing on the in-game market.
//   isBuyOrder = true  → someone wants to BUY at this price (you can sell to them instantly)
//   isBuyOrder = false → someone wants to SELL at this price (you can buy from them instantly)
//
// For LP analysis we care about:
//   - Best SELL price of output item (lowest sell order = what you can sell your item for)
//   - Best BUY price of input materials (highest buy order = what you pay for materials instantly)
//
// locationId refers to the station/structure where the order is posted.
// For Jita: the main station is Jita 4-4 (locationId: 60003760)

import mongoose, { Schema, Document } from 'mongoose';

export interface IMarketOrder extends Document {
  orderId: number;
  typeId: number;
  regionId: number;
  locationId: number;  // Station or structure ID
  price: number;
  volumeRemain: number;
  volumeTotal: number;
  isBuyOrder: boolean;
  issued: Date;        // When the order was placed
  duration: number;    // Order duration in days
  minVolume: number;   // Minimum quantity per transaction
  range: string;       // "station", "solarsystem", "region", etc.
  snapshotTime: Date;  // When WE fetched this data
}

const MarketOrderSchema = new Schema<IMarketOrder>({
  orderId:      { type: Number, required: true, unique: true },
  typeId:       { type: Number, required: true },
  regionId:     { type: Number, required: true },
  locationId:   { type: Number, required: true },
  price:        { type: Number, required: true },
  volumeRemain: { type: Number, required: true },
  volumeTotal:  { type: Number, required: true },
  isBuyOrder:   { type: Boolean, required: true },
  issued:       { type: Date, required: true },
  duration:     { type: Number, required: true },
  minVolume:    { type: Number, required: true, default: 1 },
  range:        { type: String, required: true },
  snapshotTime: { type: Date, required: true, default: Date.now },
});

// Primary query pattern: "best sell price for item X in region Y"
MarketOrderSchema.index({ typeId: 1, regionId: 1, isBuyOrder: 1, price: 1 });

export const MarketOrder = mongoose.model<IMarketOrder>(
  'MarketOrder',
  MarketOrderSchema,
  'market_orders'
);
