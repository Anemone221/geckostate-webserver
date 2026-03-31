import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import { STALE_TIME_DEFAULT } from '../lib/constants';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LpCorp {
  corporationId:   number;
  corporationName: string;
  iskPerLp:        number | null;  // null = purchase price not set yet
}

export interface LpRequiredItem {
  typeId:    number;
  typeName:  string;
  quantity:  number;       // per single redemption
  unitPrice: number | null;
  totalCost: number | null;
}

export interface LpOffer {
  offerId:            number;
  typeId:             number;
  typeName:           string;
  quantity:           number;

  // BPC metadata — only populated when the LP offer gives a Blueprint Copy
  isBpc:              boolean;
  bpcTypeId:          number | null;   // typeId of the blueprint item from LP store
  bpcTypeName:        string | null;   // name of the blueprint item
  bpcMaterialCost:    number | null;   // total manufacturing material cost for all runs

  lpCost:             number;
  iskCost:            number;
  requiredItems:      LpRequiredItem[];
  otherCost:          number | null;
  logisticsCost:      number;
  totalCost:          number | null;
  bestSellPrice:      number | null;   // current market sell price of the output item
  grossSell:          number | null;
  afterTaxSell:       number | null;
  profit:             number | null;   // after-tax sell minus ISK costs, BEFORE LP purchase cost
  iskPerLp:           number | null;   // profit / lpCost (ISK earned per LP unit)
  minSellPrice:       number | null;
  weeklyVolume:       number | null;
  maxWeeklySellUnits: number | null;
  redemptionsAvailable: number | null;
}

export interface LpRate {
  corporationId:   number;
  corporationName: string;
  iskPerLp:        number | null;
}

export interface LpBalance {
  corporationId:   number;
  corporationName: string;
  currentLp:       number | null;
}

export interface OfferCostHistoryPoint {
  date:               string;         // "YYYY-MM-DD"
  lpCostIsk:          number;         // flat: offer.lpCost × corp iskPerLp (0 if not set)
  iskFee:             number;         // flat: offer.iskCost
  requiredItemsCost:  number | null;  // null if any required item unpriced that day
  mfgCost:            number | null;  // null for non-BPC; null if any material unpriced
  marketRate:         number | null;  // null if no market history for output item that day
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/** All NPC corporations that have LP stores (from SDE). */
export function useLpCorps() {
  return useQuery({
    queryKey: ['lp', 'corps'],
    queryFn:  () => apiFetch<LpCorp[]>('/api/lp/corps'),
  });
}

/**
 * Ranked LP offers for a specific corporation.
 * Pass null to skip the query (e.g. when no corp is selected yet).
 */
export function useLpAnalysis(corporationId: number | null) {
  return useQuery({
    queryKey: ['lp', 'analysis', corporationId],
    queryFn:  () => apiFetch<LpOffer[]>(`/api/lp/${corporationId!}`),
    enabled:  corporationId !== null,
  });
}

/** All LP rate records (ISK/LP purchase price per corporation). */
export function useLpRates() {
  return useQuery({
    queryKey: ['lp', 'rates'],
    queryFn:  () => apiFetch<LpRate[]>('/api/lp-rates'),
  });
}

/** All manually entered LP balance records. */
export function useLpBalances() {
  return useQuery({
    queryKey: ['lp', 'balances'],
    queryFn:  () => apiFetch<LpBalance[]>('/api/lp-balances'),
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/** 30-day daily cost breakdown for a specific LP offer. Used for the hover chart. */
export function useOfferCostHistory(corporationId: number, offerId: number) {
  return useQuery({
    queryKey: ['lp', 'history', corporationId, offerId],
    queryFn:  () => apiFetch<OfferCostHistoryPoint[]>(
      `/api/lp/history/${corporationId}/${offerId}`
    ),
    staleTime: STALE_TIME_DEFAULT,  // historical data changes at most once per day
  });
}

export function useUpdateLpRate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ corporationId, iskPerLp }: { corporationId: number; iskPerLp: number | null }) =>
      apiFetch<LpRate>(`/api/lp-rates/${corporationId}`, {
        method: 'PUT',
        body:   JSON.stringify({ iskPerLp }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['lp', 'rates'] });
      void queryClient.invalidateQueries({ queryKey: ['lp', 'corps'] });
    },
  });
}

export function useUpdateLpBalance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ corporationId, currentLp }: { corporationId: number; currentLp: number | null }) =>
      apiFetch<LpBalance>(`/api/lp-balances/${corporationId}`, {
        method: 'PUT',
        body:   JSON.stringify({ currentLp }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['lp', 'balances'] });
      // LP balances affect the redemptionsAvailable column — invalidate analysis cache too
      void queryClient.invalidateQueries({ queryKey: ['lp', 'analysis'] });
    },
  });
}
