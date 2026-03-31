import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './client';

export interface ManufacturingMaterial {
  typeId:    number;
  typeName:  string;
  quantity:  number;
  unitPrice: number | null;
  totalCost: number | null;
}

export interface ManufacturingResult {
  blueprintTypeId:    number;
  activityId:         number;
  buildTimeSeconds:   number;
  outputTypeId:       number;
  outputTypeName:     string;
  outputQuantity:     number;
  materials:          ManufacturingMaterial[];
  totalMaterialCost:  number | null;
  logisticsCost:      number;
  totalCost:          number | null;
  outputSellPrice:    number | null;
  grossRevenue:       number | null;
  brokerFee:          number | null;
  salesTax:           number | null;
  netRevenue:         number | null;
  netProfit:          number | null;
  profitPerUnit:      number | null;
  profitMarginPct:    number | null;
}

/**
 * Manufacturing profit breakdown for a given output item.
 * Pass null to skip the query (e.g. no item selected yet).
 */
export function useManufacturing(typeId: number | null) {
  return useQuery({
    queryKey: ['manufacturing', typeId],
    queryFn:  () => apiFetch<ManufacturingResult>(`/api/manufacturing/${typeId!}`),
    enabled:  typeId !== null,
    retry:    false,  // Don't retry 404s (item has no blueprint)
  });
}
