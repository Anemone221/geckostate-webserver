// market-depth.service.ts
// Walks sell orders from cheapest to most expensive until a target quantity is filled.
//
// Used by the frontend to show the true cost of buying required items (tags, insignias)
// for LP store redemptions. Instead of assuming you can buy everything at the lowest
// sell price, this walks up the order book and shows how much you'd actually pay.

import { MarketOrder } from '../models/market-order.model';

export interface OrderBookStep {
  price:     number;  // price per unit on this order
  available: number;  // volumeRemain on this order
  qtyUsed:   number;  // how many units we'd buy from this order
  lineCost:  number;  // price × qtyUsed
}

export interface MarketDepthResult {
  typeId:            number;
  regionId:          number;
  quantityRequested: number;
  quantityFilled:    number;   // may be < requested if supply is thin
  totalCost:         number;   // sum of all lineCosts
  weightedAvgPrice:  number;   // totalCost / quantityFilled (0 if no fills)
  fullyFilled:       boolean;  // quantityFilled >= quantityRequested
  steps:             OrderBookStep[];
}

/**
 * Walk the sell order book for a given item up to `quantity` units.
 *
 * Queries sell orders sorted by price ascending (cheapest first) and accumulates
 * volume until the requested quantity is met or all orders are exhausted.
 *
 * Uses the existing compound index {typeId, regionId, isBuyOrder, price} on MarketOrder.
 */
export async function getMarketDepth(
  typeId: number,
  regionId: number,
  quantity: number,
): Promise<MarketDepthResult> {
  const orders = await MarketOrder.find(
    { typeId, regionId, isBuyOrder: false },
    { price: 1, volumeRemain: 1 },
  )
    .sort({ price: 1 })
    .lean();

  const steps: OrderBookStep[] = [];
  let remaining = quantity;
  let totalCost = 0;

  for (const order of orders) {
    if (remaining <= 0) break;

    const qtyUsed  = Math.min(order.volumeRemain, remaining);
    const lineCost = order.price * qtyUsed;

    steps.push({
      price:     order.price,
      available: order.volumeRemain,
      qtyUsed,
      lineCost,
    });

    totalCost += lineCost;
    remaining -= qtyUsed;
  }

  const quantityFilled = quantity - Math.max(remaining, 0);

  return {
    typeId,
    regionId,
    quantityRequested: quantity,
    quantityFilled,
    totalCost,
    weightedAvgPrice: quantityFilled > 0 ? totalCost / quantityFilled : 0,
    fullyFilled:      remaining <= 0,
    steps,
  };
}
