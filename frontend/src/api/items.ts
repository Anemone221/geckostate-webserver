import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './client';
import { STALE_TIME_STATIC } from '../lib/constants';

export interface ItemType {
  typeId:        number;
  typeName:      string;
  marketGroupId: number | null;
  volume:        number | null;
}

/**
 * Search for items by name. Returns up to 20 matches.
 * Query is only sent when `name` has at least 2 characters.
 */
export function useItemSearch(name: string) {
  return useQuery({
    queryKey: ['items', 'search', name],
    queryFn:  () => apiFetch<ItemType[]>(`/api/items?name=${encodeURIComponent(name)}`),
    enabled:  name.trim().length >= 2,
    staleTime: STALE_TIME_STATIC,  // item names don't change often
  });
}
