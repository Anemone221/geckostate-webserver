// lpCalc.ts
// Shared calculation helpers for the LP planning and doing pages.
//
// The key insight: LP is purchased from third-party sellers at `purchasePrice` ISK/LP.
// So the "true profit" of an LP offer is:
//   trueProfit = profit - (lpCost × purchasePrice)
//
// where `profit` = ISK earned per redemption BEFORE LP purchase cost
//   (i.e. afterTaxSell - iskCost - otherCost - logisticsCost, from the backend)

import type { LpOffer } from '../api/lp';

// Re-export formatters so existing imports from lpCalc keep working
export { fmtIsk, fmtPct, fmtNum } from './formatters';

export interface WeeklyProjection {
  trueProfit:           number | null;   // ISK profit per redemption after LP purchase
  weeklyRedemptions:    number | null;
  weeklyLpSpend:        number | null;
  weeklyLpPurchaseCost: number | null;
  weeklyIskCost:        number | null;   // iskCost + otherCost + logisticsCost per redemption × redemptions
  weeklyCapitalNeeded:  number | null;
  weeklyNetProfit:      number | null;
  weeklyROIPct:         number | null;
}

/**
 * Computes per-redemption true profit and weekly projections.
 *
 * @param offer         LP offer from the backend (profit already factors in isk/logistics costs)
 * @param purchasePrice ISK per LP unit (what the user pays to buy LP from third parties)
 */
export function calcWeekly(offer: LpOffer, purchasePrice: number | null): WeeklyProjection {
  if (
    purchasePrice === null ||
    offer.profit === null ||
    offer.maxWeeklySellUnits === null ||
    offer.totalCost === null
  ) {
    return {
      trueProfit:           null,
      weeklyRedemptions:    null,
      weeklyLpSpend:        null,
      weeklyLpPurchaseCost: null,
      weeklyIskCost:        null,
      weeklyCapitalNeeded:  null,
      weeklyNetProfit:      null,
      weeklyROIPct:         null,
    };
  }

  const trueProfit = offer.profit - offer.lpCost * purchasePrice;

  const weeklyRedemptions    = Math.ceil(offer.maxWeeklySellUnits / offer.quantity);
  const weeklyLpSpend        = weeklyRedemptions * offer.lpCost;
  const weeklyLpPurchaseCost = weeklyLpSpend * purchasePrice;
  // totalCost includes iskCost + otherCost + logisticsCost per redemption
  const weeklyIskCost        = weeklyRedemptions * offer.totalCost;
  const weeklyCapitalNeeded  = weeklyLpPurchaseCost + weeklyIskCost;
  const weeklyNetProfit      = trueProfit * weeklyRedemptions;
  const weeklyROIPct         = weeklyCapitalNeeded > 0
    ? (weeklyNetProfit / weeklyCapitalNeeded) * 100
    : null;

  return {
    trueProfit,
    weeklyRedemptions,
    weeklyLpSpend,
    weeklyLpPurchaseCost,
    weeklyIskCost,
    weeklyCapitalNeeded,
    weeklyNetProfit,
    weeklyROIPct,
  };
}

