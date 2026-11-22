import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, hasSessionHint } from './client';
import type {
  ChangeRequestResult, HotelProfile, InvoiceDetail, InvoiceSummary, Interval, Me, Payment, PaymentMethod, Plan, RegisterInput,
  SubscriptionHistory, SubscriptionResponse, TicketCategory, TicketDetail, TicketPriority, TicketSummary, Usage,
} from './types';

/** Clés de cache : une seule définition, pour invalider précisément après une modification. */
export const keys = {
  me: ['me'] as const,
  hotel: ['hotel'] as const,
  usage: ['hotel', 'usage'] as const,
  plans: ['plans'] as const,
  subscription: ['subscription'] as const,
  subscriptionHistory: ['subscription', 'history'] as const,
  invoices: ['invoices'] as const,
  invoice: (id: string) => ['invoices', id] as const,
  paymentMethods: ['payment-methods'] as const,
  tickets: ['tickets'] as const,
  ticket: (id: string) => ['tickets', id] as const,
};

/* ------------------------------------------------------------------ Textes légaux (public) */
export const useLegal = () =>
  useQuery({ queryKey: ['legal'], queryFn: () => api.get<{ version: string; company: Record<string, string> | null }>('/legal'), staleTime: 10 * 60_000 });

/* ------------------------------------------------------------------ Session */
export const useMeQuery = () =>
  useQuery({
    queryKey: keys.me,
    queryFn: () => {
      if (!hasSessionHint('hotel')) throw new ApiError(401, 'unauthenticated', 'Vous n\'êtes pas connecté.');
      return api.get<Me>('/me');
    },
    retry: false,
    staleTime: 60_000,
  });

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; password: string }) => api.post<Me & { csrfToken: string }>('/auth/login', input),
    onSuccess: (me) => {
      qc.clear();
      qc.setQueryData(keys.me, me);
    },
  });
}

export function useRegisterHotel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterInput) => api.post<Me & { trialStarted: boolean }>('/auth/register-hotel', input),
    onSuccess: (me) => {
      qc.clear();
      qc.setQueryData(keys.me, me);
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<void>('/auth/logout'),
    onSettled: () => qc.clear(),
  });
}

export const useChangePassword = () =>
  useMutation({ mutationFn: (input: { currentPassword: string; newPassword: string }) => api.post<void>('/auth/change-password', input) });

/* ------------------------------------------------------------------ Établissement */
export const useHotel = () => useQuery({ queryKey: keys.hotel, queryFn: () => api.get<HotelProfile>('/hotel') });
export const useUsage = () => useQuery({ queryKey: keys.usage, queryFn: () => api.get<Usage>('/hotel/usage') });

export function useUpdateHotel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { profile?: Record<string, unknown>; settings?: Record<string, unknown> }) => {
      if (input.profile && Object.keys(input.profile).length) await api.patch('/hotel', input.profile);
      if (input.settings && Object.keys(input.settings).length) await api.patch('/hotel/settings', input.settings);
    },
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: keys.hotel }), qc.invalidateQueries({ queryKey: keys.me })]),
  });
}

export function useCompleteOnboarding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ status: string }>('/hotel/onboarding/complete'),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: keys.hotel }), qc.invalidateQueries({ queryKey: keys.me })]),
  });
}

/* ------------------------------------------------------------------ Abonnement et facturation */
export const usePlans = () =>
  useQuery({ queryKey: keys.plans, queryFn: async () => (await api.get<{ plans: Plan[] }>('/plans')).plans, staleTime: 5 * 60_000 });
export const useSubscription = () => useQuery({ queryKey: keys.subscription, queryFn: () => api.get<SubscriptionResponse>('/subscription') });
export const useSubscriptionHistory = () =>
  useQuery({ queryKey: keys.subscriptionHistory, queryFn: () => api.get<SubscriptionHistory>('/subscription/history') });

export function useRequestPlanChange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { planCode: string; interval: Interval; message?: string }) => api.post<ChangeRequestResult>('/subscription/change-requests', input),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: keys.subscription }), qc.invalidateQueries({ queryKey: keys.invoices })]),
  });
}

export function useCancelPlanChange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/subscription/change-requests/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.subscription }),
  });
}

export const useInvoices = () =>
  useQuery({ queryKey: keys.invoices, queryFn: async () => (await api.get<{ invoices: InvoiceSummary[] }>('/billing/invoices')).invoices });
export const useInvoice = (id: string | null) =>
  useQuery({ queryKey: keys.invoice(id ?? ''), queryFn: () => api.get<InvoiceDetail>(`/billing/invoices/${id}`), enabled: !!id });
export const usePaymentMethods = () =>
  useQuery({ queryKey: keys.paymentMethods, queryFn: () => api.get<{ methods: PaymentMethod[]; notice: string }>('/billing/payment-methods') });

export function useDeclarePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { invoiceId: string; method: string; reference?: string; payerName?: string; amount?: number; idempotencyKey: string }) => {
      const { invoiceId, idempotencyKey, ...body } = input;
      return api.post<{ payment: Payment }>(`/billing/invoices/${invoiceId}/payments`, body, { idempotencyKey });
    },
    onSuccess: (_r, v) =>
      Promise.all([
        qc.invalidateQueries({ queryKey: keys.invoice(v.invoiceId) }),
        qc.invalidateQueries({ queryKey: keys.invoices }),
        qc.invalidateQueries({ queryKey: keys.subscription }),
      ]),
  });
}

/* ------------------------------------------------------------------ Assistance */
export const useTickets = () =>
  useQuery({ queryKey: keys.tickets, queryFn: async () => (await api.get<{ tickets: TicketSummary[] }>('/support/tickets')).tickets });
export const useTicket = (id: string | null) =>
  useQuery({ queryKey: keys.ticket(id ?? ''), queryFn: () => api.get<TicketDetail>(`/support/tickets/${id}`), enabled: !!id });

export function useCreateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { subject: string; category: TicketCategory; priority: TicketPriority; message: string }) =>
      api.post<{ ticket: { id: string; number: string } }>('/support/tickets', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.tickets }),
  });
}

export function useReplyTicket(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => api.post<{ ok: true }>(`/support/tickets/${id}/messages`, { body }),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: keys.ticket(id) }), qc.invalidateQueries({ queryKey: keys.tickets })]),
  });
}
