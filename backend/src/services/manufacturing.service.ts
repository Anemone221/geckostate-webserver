// manufacturing.service.ts
// Calculates the profit for manufacturing an item from its blueprint.
//
// How manufacturing profit works:
//   You buy raw materials from the market (sell orders = lowest ask price),
//   build the item, then list it on the market (sell order).
//   Profit = (sell_price × output_qty × (1 - fees)) - sum(material × price) - logistics
//
// Pricing convention:
//   - Material cost  = lowest sell order price (you buy from other players' sell orders)
//   - Output revenue = lowest sell order price (you list at current market, undercutting by 0.01 ISK)
//   This gives a slightly conservative estimate, which is appropriate for planning.
//
// Data sources:
//   - blueprints    collection → materials and products (from SDE import)
//   - market_orders collection → current prices (from ESI sync)
//   - item_types    collection → item names and m³ volumes (from SDE import)
//   - settings      collection → broker fee, sales tax, logistics cost/m³

import { Blueprint } from '../models/blueprint.model';
import { MarketOrder } from '../models/market-order.model';
import { ItemType } from '../models/item-type.model';
import { Settings } from '../models/settings.model';
import { AppError } from '../middleware/error.middleware';

// ─── Result types ─────────────────────────────────────────────────────────────

export interface ManufacturingMaterial {
  typeId: number;
  typeName: string;
  quantity: number;
  unitPrice: number | null;   // null = no sell orders in market
  totalCost: number | null;
}

export interface ManufacturingResult {
  // Blueprint info
  blueprintTypeId: number;
  activityId: number;
  buildTimeSeconds: number;

  // Output item
  outputTypeId: number;
  outputTypeName: string;
  outputQuantity: number;

  // Materials
  materials: ManufacturingMaterial[];
  totalMaterialCost: number | null;  // null if any material has no price

  // Extra costs
  logisticsCost: number;
  totalCost: number | null;

  // Revenue
  outputSellPrice: number | null;   // null = no sell orders for output
  grossRevenue: number | null;
  brokerFee: number | null;
  salesTax: number | null;
  netRevenue: number | null;

  // Profit
  netProfit: number | null;
  profitPerUnit: number | null;
  profitMarginPct: number | null;   // as a percentage, e.g. 12.5 = 12.5%
}

// ─── Main export ──────────────────────────────────────────────────────────────

// Returns manufacturing profit breakdown for an item.
// Throws AppError(404) if no manufacturing blueprint exists for that item.
export async function getManufacturingAnalysis(
  outputTypeId: number,
  regionId: number,
  characterId?: number,
): Promise<ManufacturingResult> {
  // ── 1. Find the blueprint that produces this item ──
  // activityId 1 = manufacturing (as opposed to 8 = invention)
  const blueprint = await Blueprint.findOne({
    'products.typeId': outputTypeId,
    activityId: 1,
  }).lean();

  if (!blueprint) {
    throw new AppError(404, `No manufacturing blueprint found for typeId ${outputTypeId}`);
  }

  // Find the specific product entry (a blueprint can produce multiple items, though rare)
  const product = blueprint.products.find((p) => p.typeId === outputTypeId)!;
  const outputQuantity = product.quantity;

  // ── 2. Collect all typeIds we need prices for ──
  const materialTypeIds = blueprint.materials.map((m) => m.typeId);
  const allTypeIds = [...materialTypeIds, outputTypeId];

  // ── 3. Load prices, item info, and settings in parallel ──
  const [bestSellOrders, itemInfos, settings] = await Promise.all([
    // Lowest sell price per typeId (what you pay to buy, and what you list output at)
    MarketOrder.aggregate<{ _id: number; lowestSell: number }>([
      { $match: { regionId, typeId: { $in: allTypeIds }, isBuyOrder: false } },
      { $sort: { price: 1 } },
      { $group: { _id: '$typeId', lowestSell: { $first: '$price' } } },
    ]),

    ItemType.find(
      { typeId: { $in: allTypeIds } },
      { typeId: 1, typeName: 1, volume: 1 }
    ).lean(),

    characterId
      ? Settings.findOne({ characterId }).lean()
      : Settings.findOne().lean(),
  ]);

  // Build lookup maps
  const priceMap = new Map<number, number>(
    bestSellOrders.map((r) => [r._id, r.lowestSell])
  );
  const itemMap = new Map(
    itemInfos.map((i) => [i.typeId, { name: i.typeName, volume: i.volume }])
  );

  const brokerFeePct = settings?.brokerFeePct ?? 0.0202;
  const salesTaxPct = settings?.salesTaxPct ?? 0.018;
  const logisticsCostPerM3 = settings?.logisticsCostPerM3 ?? 0;

  // ── 4. Build material rows ──
  const materials: ManufacturingMaterial[] = blueprint.materials.map((mat) => {
    const unitPrice = priceMap.get(mat.typeId) ?? null;
    return {
      typeId: mat.typeId,
      typeName: itemMap.get(mat.typeId)?.name ?? `Item ${mat.typeId}`,
      quantity: mat.quantity,
      unitPrice,
      totalCost: unitPrice !== null ? unitPrice * mat.quantity : null,
    };
  });

  const allMaterialsPriced = materials.every((m) => m.totalCost !== null);
  const totalMaterialCost = allMaterialsPriced
    ? materials.reduce((sum, m) => sum + (m.totalCost ?? 0), 0)
    : null;

  // ── 5. Logistics cost (hauling output to Jita) ──
  const outputVolume = itemMap.get(outputTypeId)?.volume ?? 0;
  const logisticsCost = outputVolume * outputQuantity * logisticsCostPerM3;
  const totalCost =
    totalMaterialCost !== null ? totalMaterialCost + logisticsCost : null;

  // ── 6. Revenue ──
  const outputSellPrice = priceMap.get(outputTypeId) ?? null;
  const grossRevenue =
    outputSellPrice !== null ? outputSellPrice * outputQuantity : null;

  const brokerFee = grossRevenue !== null ? grossRevenue * brokerFeePct : null;
  const salesTax = grossRevenue !== null ? grossRevenue * salesTaxPct : null;
  const netRevenue =
    grossRevenue !== null ? grossRevenue * (1 - brokerFeePct - salesTaxPct) : null;

  // ── 7. Profit ──
  const netProfit =
    netRevenue !== null && totalCost !== null ? netRevenue - totalCost : null;
  const profitPerUnit =
    netProfit !== null ? netProfit / outputQuantity : null;
  const profitMarginPct =
    netProfit !== null && grossRevenue !== null && grossRevenue > 0
      ? (netProfit / grossRevenue) * 100
      : null;

  return {
    blueprintTypeId: blueprint.blueprintTypeId,
    activityId: blueprint.activityId,
    buildTimeSeconds: blueprint.time,
    outputTypeId,
    outputTypeName: itemMap.get(outputTypeId)?.name ?? `Item ${outputTypeId}`,
    outputQuantity,
    materials,
    totalMaterialCost,
    logisticsCost,
    totalCost,
    outputSellPrice,
    grossRevenue,
    brokerFee,
    salesTax,
    netRevenue,
    netProfit,
    profitPerUnit,
    profitMarginPct,
  };
}
