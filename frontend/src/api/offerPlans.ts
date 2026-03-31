import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

export interface OfferPlan {
  corporationId:   number;
  offerId:         number;
  typeId:          number;
  corporationName: string;
  typeName:        string;
  status:          'planning' | 'doing';
  addedAt:         string;
}

/** All tracked offers, optionally filtered by status. */
export function useOfferPlans(status?: 'planning' | 'doing') {
  const qs = status ? `?status=${status}` : '';
  return useQuery({
    queryKey: ['offerPlans', status ?? 'all'],
    queryFn:  () => apiFetch<OfferPlan[]>(`/api/offer-plans${qs}`),
  });
}

/** Add or update the status of a tracked offer. */
export function useUpsertOfferPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      corporationId,
      offerId,
      status,
    }: {
      corporationId: number;
      offerId:       number;
      status:        'planning' | 'doing';
    }) =>
      apiFetch<OfferPlan>(`/api/offer-plans/${corporationId}/${offerId}`, {
        method: 'PUT',
        body:   JSON.stringify({ status }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['offerPlans'] });
    },
  });
}

/** Remove an offer from tracking entirely. */
export function useDeleteOfferPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      corporationId,
      offerId,
    }: {
      corporationId: number;
      offerId:       number;
    }) =>
      apiFetch<{ ok: boolean }>(`/api/offer-plans/${corporationId}/${offerId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['offerPlans'] });
    },
  });
}
