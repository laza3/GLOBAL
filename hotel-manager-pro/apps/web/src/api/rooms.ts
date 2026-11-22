import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { DateString, StayQuote } from '@hmp/shared';
import { api, type Query } from './client';

export interface Category {
  id: string; code: string; name: string; description: string | null; baseRate: number; sortOrder: number; isActive: boolean; roomsCount: number;
}

export type RoomDisplayStatus = 'available' | 'reserved' | 'occupied' | 'to_clean' | 'cleaning' | 'maintenance' | 'out_of_service' | 'archived';

export interface Room {
  id: string; number: string; name: string | null; floor: number | null; capacity: number; beds: number; categoryId: string; categoryName: string; categoryCode: string;
  nightlyRate: number | null; baseNightlyRate: number; description: string | null; amenities: string[]; housekeepingStatus: string; isArchived: boolean; version: number;
  displayStatus: RoomDisplayStatus;
}

export interface RatePeriod {
  id: string; categoryId: string; categoryName: string; name: string; startsOn: string; endsOn: string; nightlyRate: number; weekendRate: number | null;
  minStay: number; priority: number; isActive: boolean;
}

export const rk = {
  all: ['rooms'] as const,
  categories: ['rooms', 'categories'] as const,
  list: (q: Query) => ['rooms', 'list', q] as const,
  rates: ['rooms', 'rates'] as const,
  quote: (q: Query) => ['rooms', 'quote', q] as const,
};

export const useCategories = () => useQuery({ queryKey: rk.categories, queryFn: async () => (await api.get<{ categories: Category[] }>('/rooms/categories')).categories });
export const useRooms = (q: Query = {}) => useQuery({ queryKey: rk.list(q), queryFn: async () => (await api.get<{ rooms: Room[] }>('/rooms', { query: q })).rooms, placeholderData: (p) => p });
export const useRates = () => useQuery({ queryKey: rk.rates, queryFn: async () => (await api.get<{ periods: RatePeriod[] }>('/rooms/rates')).periods });
export const useQuote = (q: { categoryId?: string; roomId?: string; checkIn?: DateString; checkOut?: DateString }) =>
  useQuery({
    queryKey: rk.quote(q),
    queryFn: () => api.get<StayQuote & { category: string }>('/rooms/pricing', { query: q }),
    enabled: !!(q.categoryId && q.checkIn && q.checkOut && q.checkOut > q.checkIn),
    retry: false,
  });

function useAction<I, O>(fn: (input: I) => Promise<O>, invalidate: QueryKey[] = [rk.all]) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => Promise.all([...invalidate.map((queryKey) => qc.invalidateQueries({ queryKey })), qc.invalidateQueries({ queryKey: ['hotel', 'usage'] })]) });
}

export const useSaveCategory = () =>
  useAction((i: { id?: string; body: Record<string, unknown> }) => (i.id ? api.patch(`/rooms/categories/${i.id}`, i.body) : api.post<{ id: string }>('/rooms/categories', i.body)));
export const useSaveRoom = () =>
  useAction((i: { id?: string; body: Record<string, unknown> }) => (i.id ? api.patch(`/rooms/${i.id}`, i.body) : api.post<{ id: string }>('/rooms', i.body)));
export const useBulkRooms = () => useAction((body: Record<string, unknown>) => api.post<{ created: number; numbers: string[] }>('/rooms/bulk', body));
export const useArchiveRoom = () => useAction((i: { id: string; restore?: boolean }) => api.post(`/rooms/${i.id}/${i.restore ? 'restore' : 'archive'}`));
export const useSaveRate = () =>
  useAction((i: { id?: string; body: Record<string, unknown> }) => (i.id ? api.patch(`/rooms/rates/${i.id}`, i.body) : api.post<{ id: string }>('/rooms/rates', i.body)));
export const useDeleteRate = () => useAction((id: string) => api.delete(`/rooms/rates/${id}`));
