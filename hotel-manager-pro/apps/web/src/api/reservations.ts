import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DateString } from '@hmp/shared';
import { api, type Query } from './client';
import { rk } from './rooms';
import { gk } from './guests';

export type ReservationStatus = 'tentative' | 'pending' | 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled' | 'no_show';
export type ReservationSource = 'direct' | 'phone' | 'walk_in' | 'website' | 'booking_com' | 'airbnb' | 'expedia' | 'agency' | 'other';

export interface ReservationRow {
  id: string; reference: string; status: ReservationStatus; source: ReservationSource; groupName: string | null; currency: string; total: number;
  depositRequired: number; tentativeExpiresAt: string | null; createdAt: string;
  guestId: string; guestFirstName: string; guestLastName: string; guestIsVip: boolean;
  checkIn: string | null; checkOut: string | null; roomsCount: number; roomNumbers: string[]; adults: number; children: number;
  amountPaid: number; balanceDue: number; depositSatisfied: boolean;
}

export interface ReservationNight { night: DateString; rate: number; discount: number }
export interface ReservationLine {
  id: string; status: ReservationStatus; roomId: string | null; roomNumber: string | null; roomCapacity: number | null; categoryId: string; categoryName: string;
  checkIn: DateString; checkOut: DateString; nights: number; adults: number; children: number; actualCheckIn: string | null; actualCheckOut: string | null;
  gross: number; discount: number; nightly: ReservationNight[];
}
export interface ReservationDetail {
  id: string; reference: string; status: ReservationStatus; source: ReservationSource; groupName: string | null; currency: string;
  subtotal: number; discount: number; tax: number; total: number; discountRequested: number; depositRequired: number;
  specialRequests: string | null; internalNotes: string | null; tentativeExpiresAt: string | null; cancelledAt: string | null; cancelReason: string | null;
  taxes: Array<{ ruleId: string; name: string; amount: number; inclusive: boolean }>; version: number; createdAt: string; updatedAt: string;
  guest: { id: string; firstName: string; lastName: string; email: string | null; phone: string | null; isVip: boolean };
  folioId: string | null; amountPaid: number; balanceDue: number; depositSatisfied: boolean;
  rooms: ReservationLine[];
  history: Array<{ id: string; action: string; summary: string; at: string; actorName: string | null }>;
  actions: { edit: boolean; confirm: boolean; cancel: boolean; noShow: boolean; addRoom: boolean; cancelRoom: boolean };
}

export interface AvailableRoom { id: string; number: string; capacity: number; subtotal: number }
export interface AvailabilityCategory {
  id: string; name: string; code: string; freeCount: number; subtotal: number; averageRate: number; minStay: number; minStayRespected: boolean; rooms: AvailableRoom[];
}
export interface Availability { checkIn: DateString; checkOut: DateString; nights: number; adults: number; children: number; categories: AvailabilityCategory[] }

export interface NewLine { categoryId: string; roomId?: string | null; checkIn: DateString; checkOut: DateString; adults: number; children: number }

export const resk = {
  all: ['reservations'] as const,
  list: (q: Query) => ['reservations', 'list', q] as const,
  detail: (id: string) => ['reservations', 'detail', id] as const,
  availability: (q: Query) => ['reservations', 'availability', q] as const,
};

export const useReservations = (q: Query) =>
  useQuery({ queryKey: resk.list(q), queryFn: () => api.get<{ items: ReservationRow[]; total: number; page: number; pageSize: number }>('/reservations', { query: q }), placeholderData: (p) => p });
export const useReservation = (id: string | undefined) => useQuery({ queryKey: resk.detail(id ?? ''), queryFn: () => api.get<ReservationDetail>(`/reservations/${id}`), enabled: !!id });

export const useAvailability = (q: { checkIn?: DateString; checkOut?: DateString; adults: number; children: number; excludeLineId?: string }, enabled = true) =>
  useQuery({
    queryKey: resk.availability(q),
    queryFn: () => api.get<Availability>('/reservations/availability', { query: q }),
    enabled: enabled && !!q.checkIn && !!q.checkOut && q.checkOut > q.checkIn,
    retry: false,
  });

/** Toute modification de réservation rafraîchit aussi les chambres (statut du jour), les clients (historique) et le calendrier. */
function useAction<I, O>(fn: (input: I) => Promise<O>) {
  const qc = useQueryClient();
  const refresh = () => Promise.all([resk.all, rk.all, gk.all, ['calendar'] as const, ['hotel', 'overview'] as const].map((queryKey) => qc.invalidateQueries({ queryKey })));
  // Un refus (chambre prise entre-temps, version périmée) signifie que l'écran est en retard : on le rafraîchit aussi
  return useMutation({ mutationFn: fn, onSuccess: refresh, onError: () => void qc.invalidateQueries({ queryKey: resk.all }) });
}

export const useCreateReservation = () =>
  useAction((i: { body: Record<string, unknown>; idempotencyKey: string }) => api.post<{ id: string; reference: string; total: number; currency: string }>('/reservations', i.body, { idempotencyKey: i.idempotencyKey }));
export const usePatchReservation = () => useAction((i: { id: string; body: Record<string, unknown> }) => api.patch<ReservationDetail>(`/reservations/${i.id}`, i.body));
export const useAddRoom = () => useAction((i: { id: string; body: Record<string, unknown> }) => api.post<ReservationDetail>(`/reservations/${i.id}/rooms`, i.body));
export const usePatchRoom = () => useAction((i: { id: string; lineId: string; body: Record<string, unknown> }) => api.patch<ReservationDetail>(`/reservations/${i.id}/rooms/${i.lineId}`, i.body));
export const useCancelRoom = () => useAction((i: { id: string; lineId: string; version: number }) => api.post<ReservationDetail>(`/reservations/${i.id}/rooms/${i.lineId}/cancel`, { version: i.version }));
export const useConfirmReservation = () => useAction((i: { id: string; version?: number }) => api.post<ReservationDetail>(`/reservations/${i.id}/confirm`, { version: i.version }));
export const useCancelReservation = () => useAction((i: { id: string; reason: string; version?: number }) => api.post<ReservationDetail>(`/reservations/${i.id}/cancel`, { reason: i.reason, version: i.version }));
export const useNoShow = () => useAction((i: { id: string; version?: number }) => api.post<ReservationDetail>(`/reservations/${i.id}/no-show`, { version: i.version }));
