import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { ApiError, api, hasSessionHint, type Query } from './client';
import type { InvoicePaymentStatus, Interval, PaymentStatus, TicketCategory, TicketPriority, TicketStatus } from './types';

/* Console plateforme : formes des réponses de /platform/* (voir docs/api.md §7). */

export interface PlatformAdmin { id: string; email: string; fullName: string }
export interface Paged<T> { items: T[]; total: number; page: number; pageSize: number }

export interface Stats {
  hotels: Record<string, number>;
  subscriptions: Record<string, number>;
  recurringRevenue: Array<{ currency: string; subscriptions: number; mrr: number; arr: number }>;
  trials: { endingIn7Days: number; startedLast30Days: number; convertedLast30Days: number; conversionRate: number | null };
  churnLast30Days: { cancelled: number; expired: number };
  unpaidInvoices: Array<{ currency: string; invoices: number; due: number; overdue: number }>;
  paymentsAwaitingValidation: Array<{ currency: string; payments: number; amount: number }>;
  openTickets: Record<string, number>;
  newHotelsLast30Days: number;
  collectedThisMonth: Array<{ currency: string; amount: number }>;
  note: string;
}

export interface DirectoryHotel {
  id: string; slug: string; name: string; country: string; city: string | null; status: string; suspendedAt: string | null; suspensionReason?: string | null; createdAt: string;
  ownerEmail: string | null; ownerName: string | null; roomsCount: number; usersCount: number; entitlementSource: string; planCode: string | null; validUntil: string | null; isCurrent: boolean; subscriptionStatus: string | null;
}

export interface PlatformSubscription {
  id: string; status: string; planCode: string; planName: string; billingInterval: Interval; currency: string; priceAmount: number; discountAmount: number;
  startedAt: string; trialEndsAt: string | null; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; endedAt: string | null;
}
export interface SubscriptionRow extends PlatformSubscription { hotelId: string; hotelName: string }

export interface InvoiceBalanceRow {
  id: string; number: string | null; status: string; currency: string; totalAmount: number; amountPaid: number; balanceDue: number; paymentStatus: InvoicePaymentStatus; dueAt: string | null; isOverdue: boolean;
}
export interface InvoiceRow extends InvoiceBalanceRow { hotelId: string; hotelName: string; kind: string; issuedAt: string | null }
export interface InvoiceDetail extends InvoiceRow {
  subtotalAmount: number; taxAmount: number; periodStart: string | null; periodEnd: string | null; notes: string | null;
  lines: Array<{ description: string; quantity: number; unitAmount: number; amount: number; taxAmount: number }>;
  payments: Array<{ id: string; method: string; amount: number; status: PaymentStatus; reference: string | null; payerName: string | null; payerPhone: string | null; submittedAt: string | null; validatedAt: string | null; rejectionReason: string | null }>;
}

export interface PaymentRow {
  id: string; hotelId: string; hotelName: string; invoiceNumber: string | null; method: string; amount: number; currency: string; status: PaymentStatus; reference: string | null;
  payerName: string | null; payerPhone: string | null; submittedAt: string | null; validatedAt: string | null; rejectionReason: string | null;
}

export interface PlanPriceRow { id: string; interval: Interval; currency: string; amount: number; isActive: boolean; validFrom: string }
export interface PlatformPlan {
  id: string; code: string; name: string; description: string | null; tier: number; isPublic: boolean; isActive: boolean; isCustomPriced: boolean; trialDays: number | null;
  maxRooms: number | null; maxUsers: number | null; maxProperties: number | null; features: Record<string, boolean>; sortOrder: number; prices: PlanPriceRow[]; liveSubscriptions: number;
}

export interface PlanChangeRequestRow {
  id: string; hotelId: string; hotelName: string; status: string; fromPlanCode: string | null; toPlanCode: string; toPlanName: string; isCustomPriced: boolean;
  toInterval: Interval; message: string | null; requestedAt: string; decidedAt: string | null; decisionNotes: string | null;
}

export interface Connector { code: string; name: string; mode: 'manual' | 'automated'; status: string; isEnabled: boolean; instructions: string | null; provider: string | null; connectedAt: string | null }

export interface LicenseRow {
  id: string; hotelId: string; hotelName: string; keyPrefix: string; editionCode: string; status: string; issuedAt: string; activatedAt: string | null;
  maxRooms: number | null; maxUsers: number | null; features: Record<string, boolean>; maintenanceUntil: string | null; hostingIncluded: boolean; terms: string | null;
}

export interface TicketRow {
  id: string; number: string; hotelId: string; hotelName: string; subject: string; category: TicketCategory; priority: TicketPriority; status: TicketStatus;
  assignedAdminId: string | null; createdAt: string; updatedAt: string; firstResponseAt: string | null;
}
export interface TicketThread {
  ticket: Omit<TicketRow, 'updatedAt' | 'firstResponseAt'>;
  messages: Array<{ id: string; authorKind: 'hotel_user' | 'platform_admin' | 'system'; body: string; isInternal: boolean; createdAt: string }>;
}

export interface SettingRow { key: string; value: unknown; description: string | null }
export interface AuditRow { id: number; action: string; targetType: string | null; targetId: string | null; hotelId: string | null; details: Record<string, unknown>; createdAt: string; adminEmail: string | null }

export interface HotelDetail {
  hotel: DirectoryHotel;
  subscriptions: PlatformSubscription[];
  invoices: InvoiceBalanceRow[];
  payments: Array<{ id: string; method: string; amount: number; currency: string; status: PaymentStatus; reference: string | null; submittedAt: string | null; validatedAt: string | null }>;
  licenses: Array<{ id: string; keyPrefix: string; editionCode: string; status: string; issuedAt: string; maintenanceUntil: string | null; maxRooms: number | null; maxUsers: number | null }>;
  planChangeRequests: Array<{ id: string; status: string; toPlanCode: string; toInterval: Interval; requestedAt: string; message: string | null }>;
  tickets: Array<{ id: string; number: string; subject: string; status: TicketStatus; priority: TicketPriority; updatedAt: string }>;
  auditLog: Array<{ action: string; details: Record<string, unknown>; createdAt: string }>;
}

/* ------------------------------------------------------------------ Requêtes */
const P = { scope: 'platform' as const };
const get = <T>(path: string, query?: Query) => api.get<T>(path, { ...P, query });
const post = <T>(path: string, body?: unknown) => api.post<T>(path, body, P);
const patch = <T>(path: string, body?: unknown) => api.patch<T>(path, body, P);

export const pk = {
  me: ['platform', 'me'] as const,
  all: ['platform'] as const,
  stats: ['platform', 'stats'] as const,
  hotels: (q: Query) => ['platform', 'hotels', q] as const,
  hotel: (id: string) => ['platform', 'hotel', id] as const,
  subscriptions: (q: Query) => ['platform', 'subscriptions', q] as const,
  requests: (q: Query) => ['platform', 'requests', q] as const,
  invoices: (q: Query) => ['platform', 'invoices', q] as const,
  invoice: (id: string) => ['platform', 'invoice', id] as const,
  payments: (q: Query) => ['platform', 'payments', q] as const,
  plans: ['platform', 'plans'] as const,
  licenses: ['platform', 'licenses'] as const,
  tickets: (q: Query) => ['platform', 'tickets', q] as const,
  ticket: (id: string) => ['platform', 'ticket', id] as const,
  settings: ['platform', 'settings'] as const,
  connectors: ['platform', 'connectors'] as const,
  audit: (q: Query) => ['platform', 'audit', q] as const,
};

export const usePlatformMeQuery = () =>
  useQuery({
    queryKey: pk.me,
    queryFn: async () => {
      if (!hasSessionHint('platform')) throw new ApiError(401, 'unauthenticated', 'Vous n\'êtes pas connecté.');
      return (await get<{ admin: PlatformAdmin }>('/platform/me')).admin;
    },
    retry: false,
    staleTime: 60_000,
  });

export function usePlatformLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; password: string }) => post<{ admin: { id: string; email: string } }>('/platform/auth/login', input),
    onSuccess: () => qc.clear(),
  });
}
export function usePlatformLogout() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => post<void>('/platform/auth/logout'), onSettled: () => qc.clear() });
}

export const useStats = () => useQuery({ queryKey: pk.stats, queryFn: () => get<Stats>('/platform/stats'), refetchInterval: 60_000 });
export const useDirectory = (q: Query) => useQuery({ queryKey: pk.hotels(q), queryFn: () => get<Paged<DirectoryHotel>>('/platform/hotels', q), placeholderData: (prev) => prev });
export const useHotelDetail = (id: string) => useQuery({ queryKey: pk.hotel(id), queryFn: () => get<HotelDetail>(`/platform/hotels/${id}`) });
export const useSubscriptionsList = (q: Query) => useQuery({ queryKey: pk.subscriptions(q), queryFn: () => get<Paged<SubscriptionRow>>('/platform/subscriptions', q), placeholderData: (prev) => prev });
export const useChangeRequests = (q: Query) => useQuery({ queryKey: pk.requests(q), queryFn: async () => (await get<{ requests: PlanChangeRequestRow[] }>('/platform/plan-change-requests', q)).requests });
export const usePlatformInvoices = (q: Query) => useQuery({ queryKey: pk.invoices(q), queryFn: () => get<Paged<InvoiceRow>>('/platform/invoices', q), placeholderData: (prev) => prev });
export const usePlatformInvoice = (id: string | null) => useQuery({ queryKey: pk.invoice(id ?? ''), queryFn: () => get<InvoiceDetail>(`/platform/invoices/${id}`), enabled: !!id });
export const usePlatformPayments = (q: Query) => useQuery({ queryKey: pk.payments(q), queryFn: () => get<Paged<PaymentRow>>('/platform/payments', q), placeholderData: (prev) => prev });
export const usePlatformPlans = () => useQuery({ queryKey: pk.plans, queryFn: async () => (await get<{ plans: PlatformPlan[] }>('/platform/plans')).plans });
export const useLicenses = () => useQuery({ queryKey: pk.licenses, queryFn: async () => (await get<{ licenses: LicenseRow[] }>('/platform/licenses')).licenses });
export const usePlatformTickets = (q: Query) => useQuery({ queryKey: pk.tickets(q), queryFn: () => get<Paged<TicketRow>>('/platform/tickets', q), placeholderData: (prev) => prev });
export const usePlatformTicket = (id: string | null) => useQuery({ queryKey: pk.ticket(id ?? ''), queryFn: () => get<TicketThread>(`/platform/tickets/${id}`), enabled: !!id });
export const usePlatformSettings = () => useQuery({ queryKey: pk.settings, queryFn: () => get<{ settings: SettingRow[]; editableKeys: string[] }>('/platform/settings') });
export const useConnectors = () => useQuery({ queryKey: pk.connectors, queryFn: () => get<{ connectors: Connector[]; note: string }>('/platform/payment-connectors') });
export const useAuditLogs = (q: Query) => useQuery({ queryKey: pk.audit(q), queryFn: () => get<Paged<AuditRow>>('/platform/audit-logs', q), placeholderData: (prev) => prev });

/* ------------------------------------------------------------------ Actions : chaque mutation invalide tout ce qu'elle peut avoir changé */
function useAction<I, O>(fn: (input: I) => Promise<O>, invalidate: QueryKey[] = [pk.all]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all(invalidate.map((queryKey) => qc.invalidateQueries({ queryKey }))),
  });
}

export const useSuspendHotel = () => useAction((i: { id: string; reason: string }) => post(`/platform/hotels/${i.id}/suspend`, { reason: i.reason }));
export const useReactivateHotel = () => useAction((id: string) => post(`/platform/hotels/${id}/reactivate`));
export const useActivateSubscription = () =>
  useAction((i: { hotelId: string; planCode: string; interval: Interval; currency: string; priceAmount?: number; discountAmount?: number; reason: string }) => {
    const { hotelId, ...body } = i;
    return post(`/platform/hotels/${hotelId}/subscription/activate`, body);
  });
export const useGrantTrial = () => useAction((i: { hotelId: string; days: number; planCode: string; reason: string }) => post(`/platform/hotels/${i.hotelId}/trial/grant`, { days: i.days, planCode: i.planCode, reason: i.reason }));
export const useExtendTrial = () => useAction((i: { subscriptionId: string; days: number; reason: string }) => post(`/platform/subscriptions/${i.subscriptionId}/extend-trial`, { days: i.days, reason: i.reason }));
export const useCancelSubscription = () => useAction((i: { subscriptionId: string; reason: string; atPeriodEnd: boolean }) => post(`/platform/subscriptions/${i.subscriptionId}/cancel`, { reason: i.reason, atPeriodEnd: i.atPeriodEnd }));
export const useRenewSubscription = () => useAction((id: string) => post<{ invoiceId: string; number: string }>(`/platform/subscriptions/${id}/renew`));
export const useApproveRequest = () => useAction((i: { id: string; priceAmount?: number; discountAmount?: number; currency: string; notes?: string }) => { const { id, ...body } = i; return post(`/platform/plan-change-requests/${id}/approve`, body); });
export const useRejectRequest = () => useAction((i: { id: string; notes: string }) => post(`/platform/plan-change-requests/${i.id}/reject`, { notes: i.notes }));
export const useValidatePayment = () => useAction((id: string) => post<{ invoiceId: string | null; effects: string[] }>(`/platform/payments/${id}/validate`));
export const useRejectPayment = () => useAction((i: { id: string; reason: string }) => post(`/platform/payments/${i.id}/reject`, { reason: i.reason }));
export const useCreateInvoice = () => useAction((i: { hotelId: string; currency: string; lines: Array<{ description: string; quantity?: number; unitAmount: number }>; notes?: string; issue: boolean }) => post<{ invoiceId: string; number: string | null }>('/platform/invoices', i));
export const useIssueInvoice = () => useAction((id: string) => post<{ number: string }>(`/platform/invoices/${id}/issue`));
export const useVoidInvoice = () => useAction((i: { id: string; reason: string }) => post(`/platform/invoices/${i.id}/void`, { reason: i.reason }));
export const useRecordPayment = () => useAction((i: { invoiceId: string; method: string; amount?: number; reference?: string; payerName?: string }) => { const { invoiceId, ...body } = i; return post<{ paymentId: string; effects: string[] }>(`/platform/invoices/${invoiceId}/payments`, body); });
export const useCreatePlan = () => useAction((i: Record<string, unknown>) => post<{ id: string }>('/platform/plans', i));
export const useUpdatePlan = () => useAction((i: { id: string; patch: Record<string, unknown> }) => patch(`/platform/plans/${i.id}`, i.patch));
export const useSetPrice = () => useAction((i: { id: string; interval: Interval; currency: string; amount: number }) => post(`/platform/plans/${i.id}/prices`, { interval: i.interval, currency: i.currency, amount: i.amount }));
export const useIssueLicense = () =>
  useAction((i: { hotelId: string } & Record<string, unknown>) => { const { hotelId, ...body } = i; return post<{ licenseId: string; status: string; licenseKey: string; invoice: { id: string; number: string } | null; warning: string }>(`/platform/hotels/${hotelId}/licenses`, body); });
export const useLicenseAction = () => useAction((i: { id: string; action: 'revoke' | 'suspend' | 'reinstate' | 'extend-maintenance'; reason?: string; until?: string }) => post(`/platform/licenses/${i.id}/${i.action}`, i.action === 'extend-maintenance' ? { until: i.until } : i.reason ? { reason: i.reason } : undefined));
export const useReplyPlatformTicket = () => useAction((i: { id: string; body: string; internal: boolean }) => post(`/platform/tickets/${i.id}/messages`, { body: i.body, internal: i.internal }));
export const useUpdateTicket = () => useAction((i: { id: string; status?: TicketStatus; priority?: TicketPriority; assignToMe?: boolean }) => { const { id, ...body } = i; return patch(`/platform/tickets/${id}`, body); });
export const useUpdateSetting = () => useAction((i: { key: string; value: unknown }) => patch(`/platform/settings/${i.key}`, { value: i.value }));
export const useUpdateConnector = () => useAction((i: { code: string; instructions?: string | null; isEnabled?: boolean }) => { const { code, ...body } = i; return patch(`/platform/payment-connectors/${code}`, body); });
export const useRunLifecycle = () => useAction(() => post<{ trialsExpired: number; cancelledAtPeriodEnd: number; pastDue: number; expired: number; renewalInvoices: number }>('/platform/jobs/lifecycle'));
