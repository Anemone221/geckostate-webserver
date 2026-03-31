import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

export interface Settings {
  brokerFeePct:       number;
  salesTaxPct:        number;
  weeklyVolumePct:    number;
  logisticsCostPerM3: number;
}

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn:  () => apiFetch<Settings>('/api/settings'),
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (updates: Partial<Settings>) =>
      apiFetch<Settings>('/api/settings', {
        method: 'PUT',
        body:   JSON.stringify(updates),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });
}
