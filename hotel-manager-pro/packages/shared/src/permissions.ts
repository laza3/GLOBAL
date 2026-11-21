/**
 * Catalogue des permissions (« ressource:action ») et rôles système d'un établissement.
 * Source de vérité unique : l'API applique ces permissions, l'interface s'en sert pour masquer les actions.
 * Le contrôle réel se fait TOUJOURS côté API ; masquer un bouton n'est jamais une protection.
 */
export const PERMISSIONS = [
  'reservations:read', 'reservations:create', 'reservations:update', 'reservations:cancel',
  'calendar:read', 'calendar:move',
  'rooms:read', 'rooms:manage',
  'guests:read', 'guests:manage', 'guests:read_id_document', 'guests:export',
  'reception:checkin', 'reception:checkout',
  'housekeeping:read', 'housekeeping:manage', 'housekeeping:update_task',
  'restaurant:read', 'restaurant:manage', 'restaurant:order',
  'billing:read', 'billing:manage', 'billing:void',
  'payments:read', 'payments:record', 'payments:refund',
  'finances:read', 'finances:manage',
  'staff:read', 'staff:manage',
  'reports:read', 'reports:export',
  'settings:read', 'settings:manage',
  'subscription:read', 'subscription:manage',
  'support:read', 'support:create',
  'audit:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type SystemRoleKey =
  | 'owner'
  | 'admin'
  | 'receptionist'
  | 'accountant'
  | 'hk_manager'
  | 'hk_staff'
  | 'restaurant_manager';

export interface SystemRole {
  key: SystemRoleKey;
  name: string;
  description: string;
  permissions: readonly Permission[];
}

const all = PERMISSIONS;
const without = (excluded: readonly Permission[]) => all.filter((p) => !excluded.includes(p));
const prefix = (...resources: string[]) => all.filter((p) => resources.some((r) => p.startsWith(`${r}:`)));

export const SYSTEM_ROLES: readonly SystemRole[] = [
  {
    key: 'owner',
    name: 'Propriétaire',
    description: 'Tous les droits, y compris la gestion de l\'abonnement et des factures de la plateforme.',
    permissions: all,
  },
  {
    key: 'admin',
    name: 'Administrateur',
    description: 'Tous les droits d\'exploitation ; ne gère pas l\'abonnement de l\'établissement.',
    permissions: without(['subscription:manage']),
  },
  {
    key: 'receptionist',
    name: 'Réceptionniste',
    description: 'Réservations, arrivées et départs, clients, encaissements.',
    permissions: [
      ...prefix('reservations', 'calendar', 'reception'),
      'rooms:read', 'guests:read', 'guests:manage', 'billing:read', 'payments:read', 'payments:record',
      'housekeeping:read', 'support:read', 'support:create',
    ],
  },
  {
    key: 'accountant',
    name: 'Comptable',
    description: 'Facturation, paiements, finances et rapports.',
    permissions: [
      ...prefix('billing', 'payments', 'finances', 'reports'),
      'reservations:read', 'guests:read', 'subscription:read', 'support:read', 'support:create',
    ],
  },
  {
    key: 'hk_manager',
    name: 'Responsable housekeeping',
    description: 'Planifie et suit le ménage et la maintenance.',
    permissions: [...prefix('housekeeping'), 'rooms:read', 'reservations:read', 'calendar:read', 'support:read', 'support:create'],
  },
  {
    key: 'hk_staff',
    name: 'Employé housekeeping',
    description: 'Consulte ses chambres et met à jour l\'avancement des tâches.',
    permissions: ['housekeeping:read', 'housekeeping:update_task', 'rooms:read'],
  },
  {
    key: 'restaurant_manager',
    name: 'Responsable restaurant',
    description: 'Carte, tables, commandes et imputation à la chambre.',
    permissions: [
      ...prefix('restaurant'),
      'reservations:read', 'guests:read', 'billing:read', 'payments:record', 'reports:read',
      'support:read', 'support:create',
    ],
  },
] as const;

export const isPermission = (value: string): value is Permission => (PERMISSIONS as readonly string[]).includes(value);

export function hasPermission(granted: readonly string[], required: Permission): boolean {
  return granted.includes(required);
}
