import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Query } from './client';

export interface GuestRow {
  id: string; firstName: string; lastName: string; email: string | null; phone: string | null; city: string | null; country: string | null;
  isVip: boolean; tags: string[]; staysCount: number; createdAt: string;
}
export interface GuestFull {
  id: string; firstName: string; lastName: string; email: string | null; phone: string | null; birthDate: string | null; address: string | null; city: string | null;
  country: string | null; nationality: string | null; isVip: boolean; tags: string[]; preferences: Record<string, string>; marketingConsent: boolean; version: number;
  createdAt: string; mergedIntoId: string | null; anonymizedAt: string | null;
}
export interface GuestStay { id: string; reference: string; status: string; currency: string; totalAmount: number; checkIn: string; checkOut: string; nights: number }
export interface GuestDetail {
  guest: GuestFull;
  notes: Array<{ id: string; body: string; createdAt: string; author: string | null }>;
  documents: Array<{ id: string; docType: string; last4: string | null; issuingCountry: string | null; expiresOn: string | null; createdAt: string }>;
  stays: GuestStay[];
  stats: { stays: number; nights: number; spentByCurrency: Array<{ currency: string; amount: number }> };
  mergedCount: number;
}
export interface DuplicateCandidate { id: string; firstName: string; lastName: string; email: string | null; phone: string | null; reason: 'email' | 'phone' | 'name' }

export const gk = {
  all: ['guests'] as const,
  list: (q: Query) => ['guests', 'list', q] as const,
  detail: (id: string) => ['guests', 'detail', id] as const,
};

export const useGuests = (q: Query) =>
  useQuery({ queryKey: gk.list(q), queryFn: () => api.get<{ items: GuestRow[]; total: number; page: number; pageSize: number }>('/guests', { query: q }), placeholderData: (p) => p });
export const useGuest = (id: string | undefined) => useQuery({ queryKey: gk.detail(id ?? ''), queryFn: () => api.get<GuestDetail>(`/guests/${id}`), enabled: !!id });

function useAction<I, O>(fn: (input: I) => Promise<O>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: gk.all }) });
}

export const useSaveGuest = () =>
  useAction((i: { id?: string; body: Record<string, unknown> }): Promise<{ id?: string; updated?: string[] }> =>
    i.id ? api.patch<{ updated: string[] }>(`/guests/${i.id}`, i.body) : api.post<{ id: string }>('/guests', i.body));
export const useAddNote = () => useAction((i: { id: string; body: string }) => api.post(`/guests/${i.id}/notes`, { body: i.body }));
export const useAddDocument = () => useAction((i: { id: string; body: Record<string, unknown> }) => api.post<{ id: string }>(`/guests/${i.id}/documents`, i.body));
export const useDeleteDocument = () => useAction((i: { id: string; docId: string }) => api.delete(`/guests/${i.id}/documents/${i.docId}`));
export const useMergeGuest = () => useAction((i: { id: string; intoId: string }) => api.post(`/guests/${i.id}/merge`, { intoId: i.intoId }));
export const useAnonymizeGuest = () => useAction((id: string) => api.post(`/guests/${id}/anonymize`, { confirm: true }));
export const revealDocument = (id: string, docId: string) => api.get<{ number: string }>(`/guests/${id}/documents/${docId}/reveal`);
