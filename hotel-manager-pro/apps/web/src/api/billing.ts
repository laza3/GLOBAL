import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DateString } from '@hmp/shared';
import { api, type Query } from './client';
import { resk } from './reservations';

export interface FolioRow {
  id: string; status: 'open' | 'closed'; currency: string; reservationId: string | null; reference: string | null; reservationStatus: string | null;
  guestId: string | null; guestName: string | null; chargesTotal: number; paymentsTotal: number; balanceDue: number; paymentStatus: 'no_charges' | 'unpaid' | 'partially_paid' | 'paid'; createdAt: string;
}
export interface Charge {
  id: string; kind: string; description: string; quantity: number; unitAmount: number; amount: number; taxAmount: number; serviceDate: DateString; source: string;
  invoiceId: string | null; invoiceNumber: string | null; voidedAt: string | null; voidReason: string | null; createdAt: string;
}
export interface Payment {
  id: string; kind: 'deposit' | 'payment' | 'refund'; methodCode: string; methodLabel: string | null; amount: number; currency: string; exchangeRate: number; baseAmount: number;
  reference: string | null; status: string; reason: string | null; refundOfId: string | null; receivedAt: string; refundedAmount: number;
}
export interface FolioInvoice { id: string; kind: 'invoice' | 'credit_note'; number: string; status: string; total: number; issuedAt: string; creditForId: string | null }
export interface FolioDetail {
  id: string; status: 'open' | 'closed'; currency: string; reservationId: string | null; reservationReference: string | null; reservationStatus: string | null;
  guestId: string | null; guestName: string | null; guestEmail: string | null; chargesTotal: number; paymentsTotal: number; balanceDue: number; paymentStatus: string; depositRequired: number | null;
  charges: Charge[]; payments: Payment[]; invoices: FolioInvoice[];
}
export interface InvoiceRow {
  id: string; kind: 'invoice' | 'credit_note'; number: string; status: 'issued' | 'void'; currency: string; subtotal: number; tax: number; total: number; issuedAt: string; dueAt: string | null;
  guestName: string | null; reservationReference: string | null; folioId: string | null; creditForId: string | null; credited: number;
}
export interface JournalRow {
  id: string; kind: 'deposit' | 'payment' | 'refund'; methodCode: string; methodLabel: string | null; amount: number; currency: string; baseAmount: number; reference: string | null; reason: string | null;
  receivedAt: string; folioId: string | null; reservationReference: string | null; guestName: string | null; folioCurrency: string | null;
}
export interface TaxRule {
  id: string; name: string; kind: 'percentage' | 'fixed_per_person_night'; rateBps: number | null; fixedAmount: number | null; appliesTo: string[]; isInclusive: boolean; isActive: boolean; validFrom: string | null; validTo: string | null;
}
export interface PaymentMethod { code: string; label: string; kind: string; isActive: boolean; sortOrder: number }
export interface ExchangeRate { baseCurrency: string; quoteCurrency: string; rate: number; effectiveAt: string }

export const bk = {
  all: ['billing'] as const,
  folios: (q: Query) => ['billing', 'folios', q] as const,
  folio: (id: string) => ['billing', 'folio', id] as const,
  invoices: (q: Query) => ['billing', 'invoices', q] as const,
  payments: (q: Query) => ['billing', 'payments', q] as const,
  taxes: ['billing', 'taxes'] as const,
  methods: ['billing', 'methods'] as const,
  rates: ['billing', 'rates'] as const,
};

export const useFolios = (q: Query) => useQuery({ queryKey: bk.folios(q), queryFn: () => api.get<{ items: FolioRow[]; total: number; page: number; pageSize: number }>('/folios', { query: q }), placeholderData: (p) => p });
export const useFolio = (id: string | undefined) => useQuery({ queryKey: bk.folio(id ?? ''), queryFn: () => api.get<FolioDetail>(`/folios/${id}`), enabled: !!id });
export const useInvoices = (q: Query) => useQuery({ queryKey: bk.invoices(q), queryFn: () => api.get<{ items: InvoiceRow[]; total: number; page: number; pageSize: number }>('/invoices', { query: q }), placeholderData: (p) => p });
export const usePayments = (q: Query) => useQuery({ queryKey: bk.payments(q), queryFn: () => api.get<{ items: JournalRow[]; total: number; page: number; pageSize: number; netCollected: number; currency: string }>('/payments', { query: q }), placeholderData: (p) => p });
export const useTaxRules = () => useQuery({ queryKey: bk.taxes, queryFn: async () => (await api.get<{ taxRules: TaxRule[] }>('/tax-rules')).taxRules });
export const usePaymentMethods = () => useQuery({ queryKey: bk.methods, queryFn: async () => (await api.get<{ methods: PaymentMethod[] }>('/payment-methods')).methods });
export const useExchangeRates = () => useQuery({ queryKey: bk.rates, queryFn: async () => (await api.get<{ rates: ExchangeRate[] }>('/exchange-rates')).rates });

function useAction<I, O>(fn: (input: I) => Promise<O>) {
  const qc = useQueryClient();
  const refresh = () => Promise.all([bk.all, resk.all, ['calendar'] as const, ['hotel', 'overview'] as const].map((queryKey) => qc.invalidateQueries({ queryKey })));
  return useMutation({ mutationFn: fn, onSuccess: refresh, onError: () => void qc.invalidateQueries({ queryKey: bk.all }) });
}

export const useAddCharge = () => useAction((i: { folioId: string; body: Record<string, unknown> }) => api.post<{ id: string }>(`/folios/${i.folioId}/charges`, i.body));
export const useVoidCharge = () => useAction((i: { folioId: string; chargeId: string; reason: string }) => api.post(`/folios/${i.folioId}/charges/${i.chargeId}/void`, { reason: i.reason }));
export const useRecordPayment = () => useAction((i: { folioId: string; body: Record<string, unknown>; idempotencyKey: string }) => api.post<{ id: string; baseAmount: number; balanceDue: number }>(`/folios/${i.folioId}/payments`, i.body, { idempotencyKey: i.idempotencyKey }));
export const useRefund = () => useAction((i: { paymentId: string; body: Record<string, unknown> }) => api.post<{ id: string }>(`/payments/${i.paymentId}/refund`, i.body));
export const useIssueInvoice = () => useAction((i: { folioId: string; body: Record<string, unknown> }) => api.post<{ id: string; number: string; total: number }>(`/folios/${i.folioId}/invoices`, i.body));
export const useVoidInvoice = () => useAction((i: { id: string; reason: string }) => api.post(`/invoices/${i.id}/void`, { reason: i.reason }));
export const useCreditNote = () => useAction((i: { id: string; body: Record<string, unknown> }) => api.post<{ id: string; number: string; total: number }>(`/invoices/${i.id}/credit-notes`, i.body));
export const useSaveTaxRule = () => useAction((i: { id?: string; body: Record<string, unknown> }) => (i.id ? api.patch(`/tax-rules/${i.id}`, i.body) : api.post<{ id: string }>('/tax-rules', i.body)));
export const useToggleMethod = () => useAction((i: { code: string; isActive: boolean }) => api.patch(`/payment-methods/${i.code}`, { isActive: i.isActive }));
export const useSetRate = () => useAction((i: { baseCurrency: string; rate: number }) => api.post('/exchange-rates', i));

export const invoicePdfUrl = (id: string) => `/api/v1/invoices/${id}/pdf`;
