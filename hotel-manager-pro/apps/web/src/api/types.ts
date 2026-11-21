import type { AccessReason, AccessState } from '@hmp/shared';

/* Formes des réponses de l'API côté établissement (voir docs/api.md). Les dates sont des chaînes ISO 8601. */

export type HotelStatus = 'onboarding' | 'active' | 'suspended' | 'closed';
export type Interval = 'month' | 'year';

export interface Entitlements {
  source: 'license' | 'subscription' | 'none';
  planCode: string | null;
  maxRooms: number | null;
  maxUsers: number | null;
  features: Record<string, boolean>;
  isPerpetual: boolean;
  validUntil: string | null;
  isCurrent: boolean;
  subscriptionStatus: string | null;
  supportActive: boolean | null;
}

export interface Me {
  user: { id: string; email: string; fullName: string };
  hotel: { id: string; name: string; status: HotelStatus };
  role: { key: string; name: string };
  permissions: string[];
  access: { state: AccessState; reason: AccessReason; graceEndsAt: string | null };
  entitlements: Entitlements;
}

export interface HotelProfile {
  id: string;
  slug: string;
  name: string;
  legalName: string | null;
  taxId: string | null;
  country: string;
  city: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  status: HotelStatus;
  defaultCurrency: string;
  locale: string;
  timezone: string;
  checkInTime: string;
  checkOutTime: string;
  invoicePrefix: string;
  reservationPrefix: string;
  invoiceHeader: string | null;
  invoiceFooter: string | null;
}

export interface Usage {
  rooms: { count: number; max: number | null };
  users: { count: number; max: number | null };
}

export interface PlanPrice {
  interval: Interval;
  currency: string;
  amount: string;
}

export interface Plan {
  code: string;
  name: string;
  description: string | null;
  tier: number;
  is_custom_priced: boolean;
  max_rooms: number | null;
  max_users: number | null;
  max_properties: number | null;
  features: Record<string, boolean>;
  trial_days: number | null;
  prices: PlanPrice[];
}

export interface SubscriptionInfo {
  id: string;
  status: 'trialing' | 'active' | 'past_due';
  billingInterval: Interval;
  currency: string;
  priceAmount: number;
  discountAmount: number;
  startedAt: string;
  trialEndsAt: string | null;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  planCode: string;
  planName: string;
  maxRooms: number | null;
  maxUsers: number | null;
  features: Record<string, boolean>;
}

export interface LicenseInfo {
  keyPrefix: string;
  editionCode: string;
  status: string;
  issuedAt: string;
  maintenanceUntil: string | null;
  hostingIncluded: boolean;
  maxRooms: number | null;
  maxUsers: number | null;
  terms: string | null;
}

export interface PendingChangeRequest {
  id: string;
  status: 'pending' | 'approved';
  toPlanCode: string;
  toPlanName: string;
  toInterval: Interval;
  requestedAt: string;
}

export interface NextInvoiceDue {
  id: string;
  number: string;
  totalAmount: number;
  balanceDue: number;
  dueAt: string;
  isOverdue: boolean;
}

export interface SubscriptionResponse {
  subscription: SubscriptionInfo | null;
  license: LicenseInfo | null;
  pendingChangeRequest: PendingChangeRequest | null;
  nextInvoiceDue: NextInvoiceDue | null;
  access: Me['access'];
  entitlements: Entitlements;
}

export interface SubscriptionHistory {
  subscriptions: Array<{
    id: string; status: string; planName: string; planCode: string; billingInterval: Interval; currency: string; priceAmount: number;
    startedAt: string; currentPeriodEnd: string | null; endedAt: string | null;
  }>;
  events: Array<{ id: number; subscriptionId: string; eventType: string; fromStatus: string | null; toStatus: string | null; actorType: string; createdAt: string }>;
}

export type PaymentStatus = 'pending' | 'awaiting_validation' | 'confirmed' | 'rejected' | 'failed' | 'refunded';
export type InvoicePaymentStatus = 'unpaid' | 'partially_paid' | 'paid' | 'void' | 'draft';

export interface InvoiceSummary {
  id: string;
  number: string | null;
  kind: 'subscription' | 'plan_change' | 'license' | 'other';
  status: string;
  currency: string;
  totalAmount: number;
  issuedAt: string | null;
  dueAt: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  amountPaid: number;
  balanceDue: number;
  paymentStatus: InvoicePaymentStatus;
  isOverdue: boolean;
}

export interface Payment {
  id: string;
  method: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  reference: string | null;
  submittedAt: string | null;
  validatedAt: string | null;
  rejectionReason: string | null;
}

export interface InvoiceDetail extends InvoiceSummary {
  subtotalAmount: number;
  taxAmount: number;
  notes: string | null;
  lines: Array<{ description: string; quantity: number; unitAmount: number; amount: number; taxAmount: number }>;
  payments: Payment[];
}

export interface PaymentMethod {
  code: string;
  name: string;
  mode: 'manual' | 'automated';
  instructions: string | null;
}

export interface ChangeRequestResult {
  requestId: string;
  status: 'approved' | 'pending';
  invoice: { id: string; number: string } | null;
}

export type TicketStatus = 'open' | 'in_progress' | 'waiting_customer' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';
export type TicketCategory = 'billing' | 'technical' | 'account' | 'feature_request' | 'other';

export interface TicketSummary {
  id: string;
  number: string;
  subject: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  firstResponseAt: string | null;
}

export interface TicketMessage {
  id: string;
  authorKind: 'hotel_user' | 'platform_admin' | 'system';
  authorName: string;
  body: string;
  createdAt: string;
}

export interface TicketDetail {
  ticket: Omit<TicketSummary, 'firstResponseAt'>;
  messages: TicketMessage[];
}

export interface RegisterInput {
  hotelName: string;
  city?: string;
  country?: string;
  phone?: string;
  ownerName: string;
  email: string;
  password: string;
  planCode?: string;
  acceptTerms: true;
}
