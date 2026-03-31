// market-history.model.ts
// Stores daily price history for items in a specific region.
// Data comes from two sources:
//   - EveRef historical dumps (seeded on first import)
//   - ESI /markets/{region_id}/history/ endpoint (updated daily by cron job)
//
// OHLCV = Open, High, Low, Close, Volume — standard financial market data format.
// EVE's market history doesn't have open/close (no continuous exchange),
// so we store: average, high, low, volume, and order_count per day.
//
// This data is used for:
//   - Price history charts on the Market History page
//   - Calculating 7-day average volume (for the 5% liquidity cap)
//   - Trending analysis

import mongoose, { Schema, Document } from 'mongoose';

export interface IMarketHistory extends Document {
  typeId: number;
  regionId: number;
  date: Date;
  average: number;    // Volume-weighted average price that day
  highest: number;    // Highest transaction price
  lowest: number;     // Lowest transaction price
  volume: number;     // Total units traded
  orderCount: number; // Number of distinct orders that filled
}

const MarketHistorySchema = new Schema<IMarketHistory>({
  typeId:     { type: Number, required: true },
  regionId:   { type: Number, required: true },
  date:       { type: Date,   required: true },
  average:    { type: Number, required: true },
  highest:    { type: Number, required: true },
  lowest:     { type: Number, required: true },
  volume:     { type: Number, required: true },
  orderCount: { type: Number, required: true, default: 0 },
});

// The most common query: "give me 90 days of history for item X in region Y"
MarketHistorySchema.index({ typeId: 1, regionId: 1, date: -1 });

// Unique constraint prevents duplicate entries for the same item+region+day
MarketHistorySchema.index({ typeId: 1, regionId: 1, date: 1 }, { unique: true });

export const MarketHistory = mongoose.model<IMarketHistory>(
  'MarketHistory',
  MarketHistorySchema,
  'market_history'
);
