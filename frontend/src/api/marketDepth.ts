// marketDepth.ts
// React Query hook for the market depth (order book walk) endpoint.
// Used by the MarketDepthPopover to show how much you'd actually pay to buy
// N units of an item, walking sell orders from cheapest to most expensive.

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './client';
import { STALE_TIME_DEFAULT } from '../lib/constants';

export interface OrderBookStep {
  price:     number;
  available: number;  // volumeRemain on this order
  qtyUsed:   number;  // how many units we'd buy from this order
  lineCost:  number;  // price × qtyUsed
}

export interface MarketDepthResult {
  typeId:            number;
  regionId:          number;
  quantityRequested: number;
  quantityFilled:    number;
  totalCost:         number;
  weightedAvgPrice:  number;
  fullyFilled:       boolean;
  steps:             OrderBookStep[];
}

/**
 * Fetches order book walk for a single item.
 * Only runs when `enabled` is true — used for lazy fetch on hover.
 * Cached for 5 minutes since market orders update hourly.
 */
export function useMarketDepth(typeId: number, quantity: number, enabled: boolean) {
  return useQuery({
    queryKey: ['market-depth', typeId, quantity],
    queryFn:  () => apiFetch<MarketDepthResult>(
      `/api/market-depth/${typeId}?quantity=${quantity}`,
    ),
    enabled,
    staleTime: STALE_TIME_DEFAULT,  // market data updates hourly
  });
}
