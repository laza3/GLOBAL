import type { InvoicePaymentStatus, PaymentStatus, TicketCategory, TicketPriority, TicketStatus } from '../api/types';

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export const SUBSCRIPTION_STATUS: Record<string, { label: string; tone: Tone }> = {
  trialing: { label: 'Essai gratuit', tone: 'info' },
  active: { label: 'Actif', tone: 'success' },
  past_due: { label: 'Paiement en retard', tone: 'warning' },
  expired: { label: 'Expiré', tone: 'danger' },
  cancelled: { label: 'Résilié', tone: 'neutral' },
  cancel_at_period_end: { label: 'Résiliation prévue', tone: 'warning' },
};

export const INVOICE_STATUS: Record<InvoicePaymentStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Brouillon', tone: 'neutral' },
  unpaid: { label: 'À régler', tone: 'warning' },
  partially_paid: { label: 'Partiellement réglée', tone: 'warning' },
  paid: { label: 'Réglée', tone: 'success' },
  void: { label: 'Annulée', tone: 'neutral' },
};

export const PAYMENT_STATUS: Record<PaymentStatus, { label: string; tone: Tone }> = {
  pending: { label: 'En cours', tone: 'neutral' },
  awaiting_validation: { label: 'En attente de validation', tone: 'warning' },
  confirmed: { label: 'Confirmé', tone: 'success' },
  rejected: { label: 'Rejeté', tone: 'danger' },
  failed: { label: 'Échoué', tone: 'danger' },
  refunded: { label: 'Remboursé', tone: 'neutral' },
};

export const PAYMENT_METHOD: Record<string, string> = {
  bank_transfer: 'Virement bancaire',
  mvola: 'MVola',
  orange_money: 'Orange Money',
  airtel_money: 'Airtel Money',
  card: 'Carte bancaire',
  cash: 'Espèces',
  other: 'Autre',
};

export const INVOICE_KIND: Record<string, string> = {
  subscription: 'Abonnement',
  plan_change: 'Changement de formule',
  license: 'Licence définitive',
  other: 'Prestation',
};

export const TICKET_STATUS: Record<TicketStatus, { label: string; tone: Tone }> = {
  open: { label: 'Ouvert', tone: 'info' },
  in_progress: { label: 'En cours', tone: 'info' },
  waiting_customer: { label: 'Réponse attendue de vous', tone: 'warning' },
  resolved: { label: 'Résolu', tone: 'success' },
  closed: { label: 'Clos', tone: 'neutral' },
};

export const TICKET_PRIORITY: Record<TicketPriority, string> = { low: 'Basse', normal: 'Normale', high: 'Haute', urgent: 'Urgente' };

export const TICKET_CATEGORY: Record<TicketCategory, string> = {
  billing: 'Facturation',
  technical: 'Problème technique',
  account: 'Compte et accès',
  feature_request: 'Suggestion',
  other: 'Autre',
};

export const SUBSCRIPTION_EVENT: Record<string, string> = {
  trial_started: 'Essai gratuit démarré',
  activated: 'Abonnement activé',
  renewed: 'Abonnement renouvelé',
  reactivated: 'Abonnement réactivé',
  plan_changed: 'Formule modifiée',
  past_due: 'Paiement en retard',
  expired: 'Abonnement expiré',
  cancelled: 'Abonnement résilié',
  cancel_requested: 'Résiliation demandée',
  trial_extended: 'Essai prolongé',
};

export const INTERVAL_LABEL = { month: 'mensuel', year: 'annuel' } as const;
export const INTERVAL_UNIT = { month: 'mois', year: 'an' } as const;

/** Fonctions des formules, dans l'ordre d'affichage (libellés lisibles, pas les clés techniques). */
export const FEATURE_LABEL: Record<string, string> = {
  reservations: 'Réservations et calendrier',
  billing: 'Facturation des clients',
  housekeeping: 'Housekeeping',
  restaurant: 'Restaurant',
  finances: 'Finances',
  staff_permissions: 'Permissions du personnel',
  exports: 'Exports',
  analytics_advanced: 'Analytique avancée',
  multi_currency: 'Multidevise',
  api: 'API',
  priority_support: 'Support prioritaire',
  multi_property: 'Multi-établissements',
};

export const ROOM_STATUS: Record<string, { label: string; token: 'inhouse' | 'confirmed' | 'pending' | 'cancelled' | 'departed' | 'champagne'; icon: 'door' | 'calendar' | 'bed' | 'sparkles' | 'wrench' | 'ban' | 'archive' }> = {
  available: { label: 'Disponible', token: 'inhouse', icon: 'door' },
  reserved: { label: 'Réservée aujourd\'hui', token: 'confirmed', icon: 'calendar' },
  occupied: { label: 'Occupée', token: 'champagne', icon: 'bed' },
  to_clean: { label: 'À nettoyer', token: 'pending', icon: 'sparkles' },
  cleaning: { label: 'En nettoyage', token: 'pending', icon: 'sparkles' },
  maintenance: { label: 'En maintenance', token: 'cancelled', icon: 'wrench' },
  out_of_service: { label: 'Hors service', token: 'departed', icon: 'ban' },
  archived: { label: 'Archivée', token: 'departed', icon: 'archive' },
};
