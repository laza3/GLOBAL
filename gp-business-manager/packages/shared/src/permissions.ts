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
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export interface SystemRole {
  code: string;
  name: string;
  permissions: Permission[];
}

const P = PERMISSIONS;
const all = [...P] as Permission[];

export const SYSTEM_ROLES: SystemRole[] = [
  { code: 'ADMIN', name: 'Administrateur', permissions: all },
  {
    code: 'MANAGER',
    name: 'Gérant',
    permissions: all.filter((p) => !['user.manage', 'role.manage', 'backup.manage', 'organization.manage'].includes(p)),
  },
  {
    code: 'CASHIER',
    name: 'Caissier',
    permissions: ['product.view', 'stock.view', 'customer.view', 'customer.manage', 'sale.create', 'sale.view', 'sale.credit', 'cash.session'],
  },
  {
    code: 'STOCK',
    name: 'Magasinier',
    permissions: ['product.view', 'product.manage', 'stock.view', 'stock.adjust', 'stock.transfer', 'inventory.manage', 'supplier.view', 'purchase.view', 'purchase.manage'],
  },
  {
    code: 'ACCOUNTANT',
    name: 'Comptable',
    permissions: ['dashboard.view', 'finance.view', 'finance.manage', 'expense.manage', 'report.view', 'report.export', 'sale.view', 'customer.view', 'supplier.view', 'purchase.view', 'cash.view_all'],
  },
];
