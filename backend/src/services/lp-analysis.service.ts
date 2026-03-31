// lp-analysis.service.ts
// Calculates the ISK-per-LP value for each offer in an NPC corporation's LP store.
//
// How LP conversion works in EVE:
//   You spend LP + ISK (+ sometimes items) to receive a valuable item — or a Blueprint Copy.
//   The goal is to maximise ISK earned per LP spent, so you know which offers
//   are worth running missions for and which to ignore.
//
// Calculation (per offer — direct item):
//   other_cost     = sum(required_item.qty × lowest sell price)
//   total_cost     = lp_offer.iskCost + other_cost + logistics_cost
//   after_tax_sell = best_sell_price × quantity × (1 - brokerFeePct - salesTaxPct)
//   profit         = after_tax_sell - total_cost
//   isk_per_lp     = profit / lp_offer.lpCost
//
// Calculation (per offer — Blueprint Copy):
//   Some LP stores give a Blueprint Copy (BPC) instead of a direct item. You then
//   manufacture the item and sell that instead. The BPC itself has no market price.
//
//   bpc_material_cost = sum(blueprint_material.qty × price) × offer.quantity   (× number of BPC runs)
//   total_cost        = iskCost + other_cost + bpc_material_cost + logistics_cost
//   output_qty        = offer.quantity × blueprint.products[0].quantity          (units manufactured)
//   after_tax_sell    = manufactured_item_sell_price × output_qty × (1 - taxRate)
//   profit            = after_tax_sell - total_cost
//
// Pricing convention:
//   - "sell price" = lowest current sell order (the price you list at to be competitive)
//   - "buy price"  = lowest sell order (the price you pay when acquiring items)
//   Both use sell orders (isBuyOrder: false) — you buy materials and sell output at market.
//
// Data sources:
//   - lp_offers     collection → the offers for the corporation
//   - blueprints    collection → manufacturing requirements for BPC offers
//   - market_orders collection → current best prices (populated by esi.service.ts)
//   - market_history collection → 7-day average volume (for liquidity cap)
//   - item_types    collection → item names and m³ volumes (for logistics)
//   - settings      collection → broker fee, sales tax, logistics cost

import { LpOffer } from '../models/lp-offer.model';
import { Blueprint } from '../models/blueprint.model';
import { MarketOrder } from '../models/market-order.model';
import { MarketHistory } from '../models/market-history.model';
import { ItemType } from '../models/item-type.model';
import { LpBalance } from '../models/lp-balance.model';
import { Settings } from '../models/settings.model';

// ─── Result types ─────────────────────────────────────────────────────────────

export interface LpRequiredItem {
  typeId: number;
  typeName: string;
  quantity: number;
  unitPrice: number | null;   // null = no sell orders in market
  totalCost: number | null;
}

export interface LpOfferResult {
  offerId: number;
  corporationId: number;

  // Output item (for BPC offers this is the MANUFACTURED item, not the blueprint itself)
  typeId: number;
  typeName: string;
  quantity: number;   // total sellable units per redemption (BPC: copies × product qty)

  // BPC metadata (only populated when the LP offer gives a Blueprint Copy)
  isBpc: boolean;
  bpcTypeId: number | null;        // typeId of the BPC item received from LP store
  bpcTypeName: string | null;      // name of the BPC item (e.g. "Gallente Navy Web Blueprint")
  bpcMaterialCost: number | null;  // total manufacturing material cost for all BPC runs

  // Costs
  lpCost: number;
  iskCost: number;
  requiredItems: LpRequiredItem[];
  otherCost: number | null;      // sum of required item costs; null if any price missing
  logisticsCost: number;
  totalCost: number | null;

  // Revenue
  bestSellPrice: number | null;  // null = no sell orders in market
  grossSell: number | null;
  afterTaxSell: number | null;

  // Profit metrics
  profit: number | null;
  iskPerLp: number | null;
  minSellPrice: number | null;   // break-even sell price

  // Liquidity
  weeklyVolume: number | null;
  maxWeeklySellUnits: number | null;

  // LP balance info
  redemptionsAvailable: number | null;  // null = no LP balance entered for this corp
}

// ─── Main export ──────────────────────────────────────────────────────────────

// Returns LP analysis for every offer in a corporation's LP store,
// sorted by ISK/LP descending (best opportunities first).
// Offers with no market data still appear (profit = null) so nothing is hidden.
export async function getLpAnalysis(
  corporationId: number,
  regionId: number,
  characterId?: number,
  accountId?: string,
): Promise<LpOfferResult[]> {
  // ── 1. Load the LP offers for this corp ──
  const offers = await LpOffer.find({ corporationId }).lean();
  if (offers.length === 0) return [];

  // ── 2. Load settings and LP balance (all in parallel) ──
  // Settings are per-character; LP balances are per-account.
  const settingsQuery = characterId
    ? Settings.findOne({ characterId }).lean()
    : Settings.findOne().lean();
  const balanceQuery = accountId
    ? LpBalance.findOne({ accountId, corporationId }).lean()
    : LpBalance.findOne({ corporationId }).lean();

  const [settings, lpBalance] = await Promise.all([
    settingsQuery,
    balanceQuery,
  ]);

  const brokerFeePct = settings?.brokerFeePct ?? 0.0202;
  const salesTaxPct = settings?.salesTaxPct ?? 0.018;
  const weeklyVolumePct = settings?.weeklyVolumePct ?? 0.05;
  const logisticsCostPerM3 = settings?.logisticsCostPerM3 ?? 0;
  const taxRate = brokerFeePct + salesTaxPct;

  const currentLp = lpBalance?.currentLp ?? null;

  // ── 3. Identify BPC offers — check if any offer.typeId is a blueprint ──
  const offerTypeIds = offers.map((o) => o.typeId);
  const blueprintDocs = await Blueprint.find({
    blueprintTypeId: { $in: offerTypeIds },
    activityId: 1,
  }).lean();

  // Map: blueprintTypeId → blueprint (for fast lookup in the calc loop)
  const blueprintByBpcTypeId = new Map(
    blueprintDocs.map((bp) => [bp.blueprintTypeId, bp])
  );

  // ── 4. Collect ALL typeIds we need to price ──
  // Includes: output items, required items, BPC manufactured products, BPC materials
  const typeIds = new Set<number>();
  for (const offer of offers) {
    typeIds.add(offer.typeId);
    for (const req of offer.requiredItems) typeIds.add(req.typeId);
  }
  for (const bp of blueprintDocs) {
    for (const product of bp.products) typeIds.add(product.typeId);
    for (const mat of bp.materials)    typeIds.add(mat.typeId);
  }
  const typeIdArray = Array.from(typeIds);

  // ── 5. Batch load prices, volumes, and item info ──
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);

  const [bestSellOrders, volumeHistory, itemInfos] = await Promise.all([
    // Lowest sell price per typeId in this region (you buy at the lowest ask)
    MarketOrder.aggregate<{ _id: number; lowestSell: number }>([
      { $match: { regionId, typeId: { $in: typeIdArray }, isBuyOrder: false } },
      { $sort: { price: 1 } },
      { $group: { _id: '$typeId', lowestSell: { $first: '$price' } } },
    ]),

    // 7-day average daily volume per typeId in this region
    MarketHistory.aggregate<{ _id: number; avgDailyVolume: number }>([
      {
        $match: {
          regionId,
          typeId: { $in: typeIdArray },
          date: { $gte: sevenDaysAgo },
        },
      },
      { $group: { _id: '$typeId', avgDailyVolume: { $avg: '$volume' } } },
    ]),

    // Item names and volumes from SDE
    ItemType.find(
      { typeId: { $in: typeIdArray } },
      { typeId: 1, typeName: 1, volume: 1 }
    ).lean(),
  ]);

  // Build fast-lookup Maps
  const priceMap = new Map<number, number>(
    bestSellOrders.map((r) => [r._id, r.lowestSell])
  );
  const volumeMap = new Map<number, number>(
    volumeHistory.map((r) => [r._id, r.avgDailyVolume])
  );
  const itemMap = new Map(
    itemInfos.map((i) => [i.typeId, { name: i.typeName, volume: i.volume }])
  );

  // ── 6. Calculate metrics for each offer ──
  const results: LpOfferResult[] = offers.map((offer) => {
    const bp    = blueprintByBpcTypeId.get(offer.typeId);
    const isBpc = bp !== undefined && bp.products.length > 0;

    // ── Resolve output item ──
    // For BPC: output = the manufactured item (not the blueprint)
    // For direct: output = the LP store item
    let outputTypeId: number;
    let outputTypeName: string;
    let outputSellPrice: number | null;
    let outputQuantity: number;
    let outputVolumePerUnit: number;
    let bpcMaterialCost: number | null;
    let bpcTypeId: number | null   = null;
    let bpcTypeName: string | null = null;

    if (isBpc && bp) {
      const product       = bp.products[0];
      bpcTypeId           = offer.typeId;
      bpcTypeName         = itemMap.get(offer.typeId)?.name ?? `Item ${offer.typeId}`;
      outputTypeId        = product.typeId;
      outputTypeName      = itemMap.get(product.typeId)?.name ?? `Item ${product.typeId}`;
      // offer.quantity BPC copies × product.quantity per run = total manufactured items
      outputQuantity      = offer.quantity * product.quantity;
      outputVolumePerUnit = itemMap.get(product.typeId)?.volume ?? 0;
      outputSellPrice     = priceMap.get(product.typeId) ?? null;

      // Manufacturing material cost across all BPC copies
      const allMatsPriced = bp.materials.length > 0 &&
        bp.materials.every((m) => priceMap.has(m.typeId));
      if (allMatsPriced) {
        const costPerRun = bp.materials.reduce(
          (sum, m) => sum + (priceMap.get(m.typeId)! * m.quantity), 0
        );
        bpcMaterialCost = costPerRun * offer.quantity;  // × number of BPC copies
      } else if (bp.materials.length === 0) {
        bpcMaterialCost = 0;                            // no materials needed (rare)
      } else {
        bpcMaterialCost = null;                         // some materials unpriced
      }
    } else {
      const outputItem    = itemMap.get(offer.typeId);
      outputTypeId        = offer.typeId;
      outputTypeName      = outputItem?.name ?? `Item ${offer.typeId}`;
      outputQuantity      = offer.quantity;
      outputVolumePerUnit = outputItem?.volume ?? 0;
      outputSellPrice     = priceMap.get(offer.typeId) ?? null;
      bpcMaterialCost     = 0;                          // no manufacturing step
    }

    // ── Required items cost (LP store exchange items, same for BPC and direct) ──
    const requiredItems: LpRequiredItem[] = offer.requiredItems.map((req) => {
      const unitPrice = priceMap.get(req.typeId) ?? null;
      return {
        typeId:    req.typeId,
        typeName:  itemMap.get(req.typeId)?.name ?? `Item ${req.typeId}`,
        quantity:  req.quantity,
        unitPrice,
        totalCost: unitPrice !== null ? unitPrice * req.quantity : null,
      };
    });

    const allReqPriced = requiredItems.every((r) => r.totalCost !== null);
    const otherCost    = allReqPriced
      ? requiredItems.reduce((sum, r) => sum + (r.totalCost ?? 0), 0)
      : null;

    // Logistics: cost to haul the SOLD item to market
    const logisticsCost = outputVolumePerUnit * outputQuantity * logisticsCostPerM3;

    // Total cost (includes manufacturing materials for BPC offers)
    const totalCost =
      otherCost !== null && bpcMaterialCost !== null
        ? offer.iskCost + otherCost + bpcMaterialCost + logisticsCost
        : null;

    // Revenue
    const grossSell    = outputSellPrice !== null ? outputSellPrice * outputQuantity : null;
    const afterTaxSell = grossSell        !== null ? grossSell * (1 - taxRate)        : null;

    // Profit metrics
    const profit = afterTaxSell !== null && totalCost !== null
      ? afterTaxSell - totalCost : null;
    const iskPerLp     = profit !== null ? profit / offer.lpCost : null;
    const minSellPrice = totalCost !== null
      ? totalCost / outputQuantity / (1 - taxRate) : null;

    // Liquidity (based on the SOLD item's trading volume)
    const avgDailyVolume     = volumeMap.get(outputTypeId) ?? null;
    const weeklyVolume       = avgDailyVolume !== null ? avgDailyVolume * 7 : null;
    const maxWeeklySellUnits = weeklyVolume   !== null ? weeklyVolume * weeklyVolumePct : null;

    // How many full redemptions the user can do with their current LP balance
    const redemptionsAvailable =
      currentLp !== null ? Math.floor(currentLp / offer.lpCost) : null;

    return {
      offerId: offer.offerId,
      corporationId,
      typeId:       outputTypeId,
      typeName:     outputTypeName,
      quantity:     outputQuantity,
      isBpc,
      bpcTypeId,
      bpcTypeName,
      bpcMaterialCost: isBpc ? bpcMaterialCost : null,
      lpCost:       offer.lpCost,
      iskCost:      offer.iskCost,
      requiredItems,
      otherCost,
      logisticsCost,
      totalCost,
      bestSellPrice: outputSellPrice,
      grossSell,
      afterTaxSell,
      profit,
      iskPerLp,
      minSellPrice,
      weeklyVolume,
      maxWeeklySellUnits,
      redemptionsAvailable,
    };
  });

  // Sort: offers with calculated ISK/LP first (descending), nulls at the end
  results.sort((a, b) => {
    if (a.iskPerLp === null && b.iskPerLp === null) return 0;
    if (a.iskPerLp === null) return 1;
    if (b.iskPerLp === null) return -1;
    return b.iskPerLp - a.iskPerLp;
  });

  return results;
}
