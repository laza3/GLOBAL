export const PERMISSIONS = [
  'dashboard.view',
  'product.view', 'product.manage', 'product.price',
  'stock.view', 'stock.adjust', 'stock.transfer', 'inventory.manage',
  'customer.view', 'customer.manage',
  'supplier.view', 'supplier.manage',
  'purchase.view', 'purchase.manage',
  'sale.create', 'sale.view', 'sale.discount', 'sale.return', 'sale.credit',
  'cash.session', 'cash.view_all',
  'finance.view', 'finance.manage', 'expense.manage',
  'report.view', 'report.export',
  'user.manage', 'role.manage', 'settings.manage', 'backup.manage', 'audit.view', 'organization.manage',
  /** voir et agir sur TOUTES les boutiques (sans elle, un utilisateur rattaché à une boutique est limité à celle-ci) */
  'branch.all',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export interface SystemRole {
  code: string;
  name: string;
  /** description affichée dans l'écran de création de compte */
  description: string;
  permissions: Permission[];
}

const P = PERMISSIONS;
const all = [...P] as Permission[];

export const SYSTEM_ROLES: SystemRole[] = [
  { code: 'ADMIN', name: 'Administrateur', description: 'Administrateur du logiciel : accès total — comptes, droits, paramètres, sauvegardes.', permissions: all },
  {
    code: 'MANAGER',
    name: 'Gérant',
    description: "Dirige l'entreprise : ventes, stocks, achats, finances et rapports de toutes les boutiques. Ne gère pas les comptes.",
    permissions: all.filter((p) => !['user.manage', 'role.manage', 'backup.manage', 'organization.manage'].includes(p)),
  },
  {
    code: 'SALES_MANAGER',
    name: 'Responsable des ventes',
    description: 'Supervise les ventes de toutes les boutiques : remises, retours, clôtures de caisse, clients, rapports de ventes. Pas d’accès aux finances.',
    permissions: ['dashboard.view', 'product.view', 'stock.view', 'customer.view', 'customer.manage', 'sale.create', 'sale.view', 'sale.discount', 'sale.return', 'sale.credit', 'cash.session', 'cash.view_all', 'report.view', 'report.export', 'branch.all'],
  },
  {
    code: 'CASHIER',
    name: 'Vendeur / Vendeuse',
    description: 'Vend en boutique : caisse, clients, ses propres ventes. Limité(e) à sa boutique.',
    permissions: ['product.view', 'stock.view', 'customer.view', 'customer.manage', 'sale.create', 'sale.view', 'sale.credit', 'cash.session'],
  },
  {
    code: 'STOCK',
    name: 'Magasinier',
    description: 'Gère les produits, les stocks, les inventaires et les achats.',
    permissions: ['product.view', 'product.manage', 'stock.view', 'stock.adjust', 'stock.transfer', 'inventory.manage', 'supplier.view', 'purchase.view', 'purchase.manage'],
  },
  {
    code: 'ACCOUNTANT',
    name: 'Comptable',
    description: 'Finances, dépenses, rapports et suivi des créances/dettes. Lecture des ventes.',
    permissions: ['dashboard.view', 'finance.view', 'finance.manage', 'expense.manage', 'report.view', 'report.export', 'sale.view', 'customer.view', 'supplier.view', 'purchase.view', 'cash.view_all', 'branch.all'],
  },
];
