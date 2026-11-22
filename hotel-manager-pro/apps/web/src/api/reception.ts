import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DateString } from '@hmp/shared';
import { api } from './client';
import { bk } from './billing';
import { calk } from './calendar';
import { resk } from './reservations';
import { rk } from './rooms';

export interface ReceptionLine {
  lineId: string; reservationId: string; reference: string; status: string; guestId: string; guestName: string; isVip: boolean; roomId: string | null; roomNumber: string | null;
  housekeepingStatus: string | null; categoryName: string; checkIn: DateString; checkOut: DateString; adults: number; children: number; actualCheckIn: string | null; actualCheckOut: string | null;
  balanceDue: number; depositRequired: number; depositSatisfied: boolean; currency: string; folioId: string | null; specialRequests: string | null;
}
export interface ReceptionOverview {
  date: DateString; today: DateString; arrivals: ReceptionLine[]; departures: ReceptionLine[]; inHouse: ReceptionLine[]; overdue: ReceptionLine[];
  counts: { arrivals: number; arrivalsDone: number; departures: number; departuresDone: number; inHouse: number; overdue: number };
}

export const recK = { all: ['reception'] as const, overview: (date?: string) => ['reception', 'overview', date ?? 'today'] as const };
export const useReceptionOverview = (date?: DateString) =>
  useQuery({ queryKey: recK.overview(date), queryFn: () => api.get<ReceptionOverview>('/reception/overview', { query: { date } }), placeholderData: (p) => p, refetchInterval: 60_000 });

function useAction<I, O>(fn: (input: I) => Promise<O>) {
  const qc = useQueryClient();
  const refresh = () => Promise.all([recK.all, resk.all, calk.all, rk.all, bk.all, ['hotel', 'overview'] as const].map((queryKey) => qc.invalidateQueries({ queryKey })));
  return useMutation({ mutationFn: fn, onSuccess: refresh, onError: () => void qc.invalidateQueries({ queryKey: recK.all }) });
}

export const useCheckIn = () => useAction((i: { lineIds: string[]; force?: boolean }) => api.post<{ reservationId: string; status: string; forced: boolean }>('/reception/check-in', { lineIds: i.lineIds, force: !!i.force }));
export const useCheckOut = () => useAction((i: { lineIds: string[]; allowUnpaid?: boolean; shorten?: boolean }) => api.post<{ reservationId: string; status: string; unpaid: number; folioClosed: boolean }>('/reception/check-out', { lineIds: i.lineIds, allowUnpaid: !!i.allowUnpaid, shorten: !!i.shorten }));
export const useChangeRoom = () => useAction((i: { lineId: string; roomId: string; reason?: string }) => api.post<{ from: string; to: string }>('/reception/change-room', i));
