import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CorpDivision {
  division: number;
  name:     string;
}

export interface CorpOrder {
  orderId:        number;
  corporationId:  number;
  characterId:    number;
  typeId:         number;
  typeName:       string;
  locationId:     number;
  regionId:       number;
  price:          number;
  volumeRemain:   number;
  volumeTotal:    number;
  isBuyOrder:     boolean;
  issued:         string;
  duration:       number;
  minVolume:      number;
  range:          string;
  escrow:         number | null;
  walletDivision: number;
}

export interface InterpretedTransaction {
  transactionId:  number;
  date:           string;
  typeId:         number;
  typeName:       string;
  quantity:       number;
  unitPrice:      number;
  totalIsk:       number;
  isBuy:          boolean;
  clientId:       number;
  brokerFee:      number | null;
  salesTax:       number | null;
  netProfit:      number | null;
  matchedOrderId: number | null;
}

export type WithdrawalCategory = 'lp_purchase' | 'private_sale' | 'investor_payout' | 'other';

export interface JournalEntry {
  journalId:     number;
  division:      number;
  date:          string;
  refType:       string;
  amount:        number;
  balance:       number;
  firstPartyId:  number | null;
  secondPartyId: number | null;
  description:   string;
  contextId:     number | null;
  contextIdType: string | null;
  reason:        string;
  isLpPurchase:  boolean | null;
  category:      WithdrawalCategory | null;
}

export interface FeeSummary {
  totalBrokerFees:    number;
  totalSalesTax:      number;
  grossRevenue:       number;
  grossSpend:         number;
  lpPurchases:        number;
  miscWithdrawals:    number;
  industryCosts:      number;
  netRevenue:         number;
  profit:             number;
  potentialRevenue:   number;
  potentialSalesTax:  number;
  potentialProfit:    number;
  periodDays:         number;
}

export interface CorpTradingSettings {
  corporationId:       number;
  walletDivision:      number;
  lastOrderSync:       string | null;
  lastTransactionSync: string | null;
  lastJournalSync:     string | null;
}

export interface SyncResult {
  ok:     boolean;
  synced: {
    orders:       number;
    transactions: number;
    journal:      number;
  };
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export function useCorpDivisions() {
  return useQuery({
    queryKey: ['corp-trading', 'divisions'],
    queryFn:  () => apiFetch<CorpDivision[]>('/api/corp-trading/divisions'),
  });
}

export function useCorpOrders() {
  return useQuery({
    queryKey: ['corp-trading', 'orders'],
    queryFn:  () => apiFetch<CorpOrder[]>('/api/corp-trading/orders'),
  });
}

export function useCorpTransactions(division: number, limit = 100) {
  return useQuery({
    queryKey: ['corp-trading', 'transactions', division, limit],
    queryFn:  () => apiFetch<InterpretedTransaction[]>(
      `/api/corp-trading/transactions?division=${division}&limit=${limit}`
    ),
  });
}

export function useCorpJournal(division: number, limit = 100) {
  return useQuery({
    queryKey: ['corp-trading', 'journal', division, limit],
    queryFn:  () => apiFetch<JournalEntry[]>(
      `/api/corp-trading/journal?division=${division}&limit=${limit}`
    ),
  });
}

export function useCorpWithdrawals(division: number) {
  return useQuery({
    queryKey: ['corp-trading', 'withdrawals', division],
    queryFn:  () => apiFetch<JournalEntry[]>(
      `/api/corp-trading/withdrawals?division=${division}`
    ),
  });
}

export function useCorpLpStorePurchases(division: number, since?: string) {
  return useQuery({
    queryKey: ['corp-trading', 'lp-store-purchases', division, since],
    queryFn:  () => {
      const params = new URLSearchParams({ division: String(division) });
      if (since) params.set('since', since);
      return apiFetch<JournalEntry[]>(`/api/corp-trading/lp-store-purchases?${params}`);
    },
  });
}

export function useCorpFeeSummary(division: number, days: number) {
  return useQuery({
    queryKey: ['corp-trading', 'fee-summary', division, days],
    queryFn:  () => apiFetch<FeeSummary>(
      `/api/corp-trading/fee-summary?division=${division}&days=${days}`
    ),
  });
}

export function useCorpTradingSettings() {
  return useQuery({
    queryKey: ['corp-trading', 'settings'],
    queryFn:  () => apiFetch<CorpTradingSettings>('/api/corp-trading/settings'),
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export function useUpdateCorpTradingSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { walletDivision: number }) =>
      apiFetch<CorpTradingSettings>('/api/corp-trading/settings', {
        method: 'PUT',
        body:   JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['corp-trading', 'settings'] });
    },
  });
}

export function useUpdateWithdrawalCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ journalId, division, category }: { journalId: number; division: number; category: WithdrawalCategory }) =>
      apiFetch<{ ok: boolean; category: WithdrawalCategory }>(
        `/api/corp-trading/withdrawals/${journalId}`,
        { method: 'PATCH', body: JSON.stringify({ division, category }) },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['corp-trading', 'withdrawals'] });
      void queryClient.invalidateQueries({ queryKey: ['corp-trading', 'fee-summary'] });
    },
  });
}

export function useUpdateLpStorePurchaseCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ journalId, division, category }: { journalId: number; division: number; category: WithdrawalCategory }) =>
      apiFetch<{ ok: boolean; category: WithdrawalCategory }>(
        `/api/corp-trading/lp-store-purchases/${journalId}`,
        { method: 'PATCH', body: JSON.stringify({ division, category }) },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['corp-trading', 'lp-store-purchases'] });
      void queryClient.invalidateQueries({ queryKey: ['corp-trading', 'fee-summary'] });
    },
  });
}

export function useTriggerCorpSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<SyncResult>('/api/corp-trading/sync', { method: 'POST' }),
    onSuccess: () => {
      // Refresh all corp trading data after sync
      void queryClient.invalidateQueries({ queryKey: ['corp-trading'] });
    },
  });
}
