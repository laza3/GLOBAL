import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DateString } from '@hmp/shared';
import { api, type Query } from './client';
import { resk } from './reservations';
import { rk } from './rooms';

export interface CalendarRoom { id: string; number: string; name: string | null; floor: number | null; capacity: number; categoryId: string; categoryName: string }
export interface StayItem {
  kind: 'stay'; id: string; roomId: string; startsOn: DateString; endsOn: DateString; reservationId: string; reference: string; status: string;
  guestName: string; isVip: boolean; adults: number; children: number; balanceDue: number; currency: string; version: number;
}
export type BlockReason = 'maintenance' | 'out_of_service' | 'owner_use' | 'other';
export interface BlockItem { kind: 'block'; id: string; roomId: string; startsOn: DateString; endsOn: DateString | null; reason: BlockReason; notes: string | null }
export interface CalendarData {
  from: DateString; to: DateString; days: number; today: DateString;
  rooms: CalendarRoom[]; items: Array<StayItem | BlockItem>; occupancy: Array<{ date: DateString; occupied: number; blocked: number; total: number }>;
}

export const calk = { all: ['calendar'] as const, grid: (q: Query) => ['calendar', 'grid', q] as const };

export const useCalendar = (q: { from?: DateString; days: number; categoryId?: string }) =>
  useQuery({ queryKey: calk.grid(q), queryFn: () => api.get<CalendarData>('/calendar', { query: q }), placeholderData: (p) => p });

function useAction<I, O>(fn: (input: I) => Promise<O>) {
  const qc = useQueryClient();
  const refresh = () => Promise.all([calk.all, resk.all, rk.all].map((queryKey) => qc.invalidateQueries({ queryKey })));
  return useMutation({ mutationFn: fn, onSuccess: refresh, onError: () => void qc.invalidateQueries({ queryKey: calk.all }) });
}

export const useCreateBlock = () => useAction((body: { roomId: string; startsOn: DateString; endsOn: DateString | null; reason: BlockReason; notes?: string | null }) => api.post<{ id: string }>('/calendar/blocks', body));
export const usePatchBlock = () => useAction((i: { id: string; body: { endsOn?: DateString | null; notes?: string | null } }) => api.patch(`/calendar/blocks/${i.id}`, i.body));
export const useDeleteBlock = () => useAction((id: string) => api.delete(`/calendar/blocks/${id}`));
export const useMoveStay = () => useAction((i: { lineId: string; body: { roomId?: string; checkIn?: DateString; checkOut?: DateString } }) => api.post<{ reservationId: string; changed: string[] }>(`/calendar/stays/${i.lineId}/move`, i.body));

export const BLOCK_REASON_LABEL: Record<BlockReason, string> = { maintenance: 'Maintenance', out_of_service: 'Hors service', owner_use: 'Usage propriétaire', other: 'Autre' };
