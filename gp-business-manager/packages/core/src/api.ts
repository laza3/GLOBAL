import { z, ZodError, type ZodType } from 'zod';
import { PERMISSIONS } from '@gp/shared';
import type { Db } from './db';
import * as auth from './auth';
import * as mdata from './masterdata';
import * as cat from './catalog';
import * as stock from './stock';
import * as parties from './parties';
import * as sales from './sales';
import * as cash from './cash';
import * as fin from './finance';
import * as purch from './purchases';
import { dashboard } from './dashboard';
import { runReport, REPORT_TYPES } from './reports';
import { isConfigured, setupCompany } from './setup';
import { AppError, audit, companyOf, type Ctx } from './util';
import { ensureSystemRoles } from './auth';

const id = z.string().min(1);
const money = z.number().int();
const posMoney = z.number().int().nonnegative();
const qty = z.number().int();
const text = z.string().max(500);
const opt = <T extends ZodType>(s: T) => s.optional().nullable().transform((v) => v ?? undefined);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const range = z.object({ from: date.optional(), to: date.optional() });

type Perm = (typeof PERMISSIONS)[number];
interface Def { perm?: Perm | Perm[] | null; schema?: ZodType; run: (ctx: Ctx, p: any) => unknown | Promise<unknown> }
/** Définit un endpoint en conservant les types précis du schéma (entrée) et du résultat (sortie) pour le client typé. */
function d<S extends ZodType | undefined, R>(perm: Def['perm'], schema: S, run: (ctx: Ctx, p: S extends ZodType ? z.output<S> : undefined) => R): { perm: Def['perm']; schema: S; run: (ctx: Ctx, p: any) => R } {
  return { perm, schema, run: run as any };
}

const variantSchema = z.object({
  id: opt(id), sku: opt(z.string().max(60)), name: opt(text), size: opt(z.string().max(40)), color: opt(z.string().max(40)),
  costPrice: posMoney, price: posMoney, wholesalePrice: opt(posMoney), promoPrice: opt(posMoney), promoStart: opt(date), promoEnd: opt(date),
  alertQtyMilli: opt(posMoney), barcodes: z.array(z.string().max(64)).max(20).optional(), active: z.boolean().optional(),
  openingQtyMilli: opt(posMoney), openingWarehouseId: opt(id),
});
const productSchema = z.object({
  id: opt(id), name: z.string().min(1).max(200), description: opt(z.string().max(2000)), categoryId: opt(id), brandId: opt(id), unitId: opt(id), taxRateId: opt(id),
  trackStock: z.boolean().optional(), trackLots: z.boolean().optional(), image: opt(z.string().max(700_000)), active: z.boolean().optional(), variants: z.array(variantSchema).min(1).max(200),
});
const saleSchema = z.object({
  id: opt(id), registerId: id, customerId: opt(id),
  items: z.array(z.object({ variantId: id, qtyMilli: qty, unitPrice: opt(posMoney), discountBp: opt(z.number().int().min(0).max(10000)), discountAmount: opt(posMoney) })).min(1).max(500),
  cartDiscount: z.union([z.object({ type: z.literal('percent'), bp: z.number().int().min(0).max(10000) }), z.object({ type: z.literal('amount'), amount: posMoney })]).nullable().optional(),
  payments: z.array(z.object({ methodId: id, amount: z.number().int().positive() })).max(10),
  advanceUsed: opt(posMoney), dueDate: opt(date), note: opt(text),
});

const defs = {
  // --- auth & session ---
  'auth.me': d(null, undefined, (): { id: string; username: string; displayName: string; roleCode: string; roleName: string; branchId: string | null; mustChangePassword: boolean; permissions: string[] } => { throw new Error('handled'); }),
  'auth.changePassword': d(null, z.object({ oldPassword: z.string(), newPassword: z.string() }), (c, p) => auth.changeOwnPassword(c, p.oldPassword, p.newPassword)),
  // --- entreprise ---
  'company.get': d(null, undefined, (c) => mdata.getCompany(c)),
  'company.update': d('settings.manage', z.object({
    name: z.string().min(1).max(200).optional(), legalName: opt(text), taxId: opt(text), statNo: opt(text), address: opt(text), phone: opt(text), email: opt(text), logo: opt(z.string().max(700_000)),
    currency: z.string().length(3).optional(), locale: z.enum(['fr', 'en']).optional(), timezone: z.string().max(60).optional(), pricesIncludeTax: z.boolean().optional(), allowNegativeStock: z.boolean().optional(),
    maxCashierDiscountBp: z.number().int().min(0).max(10000).optional(), receiptFooter: opt(text), invoiceNotes: opt(z.string().max(1000)), numbering: z.record(z.string(), z.string().max(60)).optional(),
  }), (c, p) => mdata.updateCompany(c, p)),
  'org.branches': d(null, undefined, (c) => mdata.listBranches(c)),
  'org.saveBranch': d('organization.manage', z.object({ id: opt(id), name: z.string().min(1).max(120), code: opt(z.string().max(20)), address: opt(text), phone: opt(text), active: z.boolean().optional() }), (c, p) => mdata.saveBranch(c, p)),
  'org.warehouses': d(null, undefined, (c) => mdata.listWarehouses(c)),
  'org.saveWarehouse': d('organization.manage', z.object({ id: opt(id), branchId: id, name: z.string().min(1).max(120), active: z.boolean().optional() }), (c, p) => mdata.saveWarehouse(c, p)),
  'org.registers': d(null, undefined, (c) => mdata.listRegisters(c)),
  'org.saveRegister': d('organization.manage', z.object({ id: opt(id), branchId: id, warehouseId: id, name: z.string().min(1).max(120), active: z.boolean().optional() }), (c, p) => mdata.saveRegister(c, p)),
  'ref.paymentMethods': d(null, z.object({ all: z.boolean().optional() }).optional(), (c, p) => mdata.listPaymentMethods(c, p?.all)),
  'ref.savePaymentMethod': d('settings.manage', z.object({ id: opt(id), code: z.string().min(2).max(30), name: z.string().min(1).max(80), kind: z.enum(['CASH', 'CARD', 'MOBILE', 'BANK', 'CHEQUE', 'OTHER']), accountId: opt(id), active: z.boolean().optional() }), (c, p) => mdata.savePaymentMethod(c, p)),
  'ref.taxRates': d(null, undefined, (c) => mdata.listTaxRates(c)),
  'ref.saveTaxRate': d('settings.manage', z.object({ id: opt(id), name: z.string().min(1).max(80), rateBp: z.number().int().min(0).max(10000), isDefault: z.boolean().optional() }), (c, p) => mdata.saveTaxRate(c, p)),
  'ref.units': d(null, undefined, (c) => mdata.listUnits(c)),
  'ref.saveUnit': d('product.manage', z.object({ code: z.string().min(1).max(20), name: z.string().min(1).max(60), allowDecimal: z.boolean().optional() }), (c, p) => mdata.saveUnit(c, p)),
  'ref.expenseCategories': d(null, undefined, (c) => mdata.listExpenseCategories(c)),
  'ref.saveExpenseCategory': d('expense.manage', z.object({ name: z.string().min(1).max(80) }), (c, p) => mdata.saveExpenseCategory(c, p)),
  'ref.permissions': d('role.manage', undefined, () => [...PERMISSIONS]),
  // --- administration ---
  'users.list': d(['user.manage', 'cash.view_all'], undefined, (c) => auth.listUsers(c)),
  'users.create': d('user.manage', z.object({ username: z.string().min(3).max(40), displayName: z.string().min(1).max(100), password: z.string().min(8).max(200), roleId: id, branchId: opt(id), email: opt(text), phone: opt(text), mustChangePassword: z.boolean().optional() }), (c, p) => auth.createUser(c, p)),
  'users.update': d('user.manage', z.object({ id, displayName: z.string().min(1).max(100).optional(), roleId: id.optional(), branchId: opt(id), email: opt(text), phone: opt(text), active: z.boolean().optional(), password: z.string().min(8).max(200).optional() }), (c, p) => auth.updateUser(c, p.id, p)),
  'users.delete': d('user.manage', z.object({ id }), (c, p) => auth.deleteUser(c, p.id)),
  'roles.list': d(['role.manage', 'user.manage'], undefined, (c) => auth.listRoles(c)),
  'roles.save': d('role.manage', z.object({ id: opt(id), name: z.string().min(1).max(80), permissions: z.array(z.string()).max(100) }), (c, p) => auth.saveRole(c, p)),
  'roles.delete': d('role.manage', z.object({ id }), (c, p) => auth.deleteRole(c, p.id)),
  'audit.list': d('audit.view', z.object({ limit: z.number().int().max(1000).optional(), action: z.string().max(60).optional() }).optional(), (c, p) => auth.listAudit(c, p ?? {})),
  // --- catalogue ---
  'catalog.categories': d(null, undefined, (c) => cat.listCategories(c)),
  'catalog.saveCategory': d('product.manage', z.object({ id: opt(id), name: z.string().min(1).max(100), parentId: opt(id), active: z.boolean().optional() }), (c, p) => cat.saveCategory(c, p)),
  'catalog.deleteCategory': d('product.manage', z.object({ id }), (c, p) => cat.deleteCategory(c, p.id)),
  'catalog.brands': d(null, undefined, (c) => cat.listBrands(c)),
  'catalog.saveBrand': d('product.manage', z.object({ id: opt(id), name: z.string().min(1).max(100) }), (c, p) => cat.saveBrand(c, p)),
  'catalog.deleteBrand': d('product.manage', z.object({ id }), (c, p) => cat.deleteBrand(c, p.id)),
  'products.list': d('product.view', z.object({ q: z.string().max(100).optional(), categoryId: opt(id), brandId: opt(id), active: z.boolean().optional(), limit: z.number().int().max(1000).optional(), offset: z.number().int().optional() }).optional(), (c, p) => cat.listProducts(c, p ?? {})),
  'products.get': d('product.view', z.object({ id }), (c, p) => cat.getProduct(c, p.id)),
  'products.save': d('product.manage', productSchema, (c, p) => cat.saveProduct(c, p)),
  'products.delete': d('product.manage', z.object({ id }), (c, p) => cat.deleteProduct(c, p.id)),
  'sellable.search': d(['sale.create', 'product.view'], z.object({ q: z.string().max(100).optional(), warehouseId: opt(id), tier: z.enum(['RETAIL', 'WHOLESALE']).optional(), categoryId: opt(id), limit: z.number().int().max(200).optional() }), (c, p) => cat.searchSellable(c, p)),
  'sellable.byCode': d(['sale.create', 'product.view'], z.object({ code: z.string().max(100), warehouseId: opt(id), tier: z.enum(['RETAIL', 'WHOLESALE']).optional() }), (c, p) => cat.findByCode(c, p.code, p.warehouseId, p.tier)),
  // --- stock ---
  'stock.levels': d('stock.view', z.object({ warehouseId: opt(id), q: z.string().max(100).optional(), lowOnly: z.boolean().optional(), categoryId: opt(id), limit: z.number().int().max(5000).optional(), offset: z.number().int().optional() }).optional(), (c, p) => stock.stockLevels(c, p ?? {})),
  'stock.movements': d('stock.view', z.object({ variantId: opt(id), warehouseId: opt(id), type: z.string().optional(), from: opt(date), to: opt(date), limit: z.number().int().max(2000).optional() }).optional(), (c, p) => stock.stockMovements(c, p ?? {})),
  'stock.adjust': d('stock.adjust', z.object({ warehouseId: id, variantId: id, type: z.enum(['IN', 'OUT', 'ADJUSTMENT', 'LOSS', 'DAMAGED']), qtyMilli: qty, reason: opt(text), unitCost: opt(posMoney), lotNo: opt(z.string().max(60)), expiryDate: opt(date) }), (c, p) => stock.adjustStock(c, p)),
  'stock.transfer': d('stock.transfer', z.object({ fromWarehouseId: id, toWarehouseId: id, items: z.array(z.object({ variantId: id, qtyMilli: qty })).min(1).max(500), note: opt(text) }), (c, p) => stock.createTransfer(c, p)),
  'stock.transfers': d('stock.view', undefined, (c) => stock.listTransfers(c)),
  'stock.valuation': d('stock.view', z.object({ warehouseId: opt(id) }).optional(), (c, p) => stock.stockValuation(c, p?.warehouseId)),
  'stock.expiring': d('stock.view', z.object({ days: z.number().int().max(3650).optional() }).optional(), (c, p) => stock.expiringLots(c, p?.days)),
  'inventory.create': d('inventory.manage', z.object({ warehouseId: id, categoryId: opt(id), note: opt(text) }), (c, p) => stock.createInventory(c, p)),
  'inventory.list': d('inventory.manage', undefined, (c) => stock.listInventories(c)),
  'inventory.get': d('inventory.manage', z.object({ id }), (c, p) => stock.getInventory(c, p.id)),
  'inventory.count': d('inventory.manage', z.object({ inventoryId: id, variantId: id, countedMilli: z.number().int().nonnegative().nullable() }), (c, p) => stock.setInventoryCount(c, p)),
  'inventory.validate': d('inventory.manage', z.object({ id }), (c, p) => stock.validateInventory(c, p.id)),
  // --- tiers ---
  'customers.list': d(['customer.view', 'sale.create'], z.object({ q: z.string().max(100).optional(), withDebt: z.boolean().optional(), limit: z.number().int().max(2000).optional() }).optional(), (c, p) => parties.listCustomers(c, p ?? {})),
  'customers.get': d('customer.view', z.object({ id }), (c, p) => parties.getCustomer(c, p.id)),
  'customers.save': d(['customer.manage'], z.object({ id: opt(id), name: z.string().min(1).max(150), code: opt(z.string().max(30)), phone: opt(z.string().max(40)), email: opt(z.string().max(120)), address: opt(text), taxId: opt(z.string().max(40)), priceTier: z.enum(['RETAIL', 'WHOLESALE']).optional(), creditLimit: opt(posMoney), notes: opt(z.string().max(1000)), active: z.boolean().optional() }), (c, p) => parties.saveCustomer(c, p)),
  'customers.delete': d('customer.manage', z.object({ id }), (c, p) => parties.deleteCustomer(c, p.id)),
  'customers.receivePayment': d(['customer.manage', 'finance.manage'], z.object({ customerId: id, methodId: id, amount: z.number().int().positive(), note: opt(text) }), (c, p) => parties.receiveCustomerPayment(c, p)),
  'suppliers.list': d('supplier.view', z.object({ q: z.string().max(100).optional() }).optional(), (c, p) => parties.listSuppliers(c, p ?? {})),
  'suppliers.get': d('supplier.view', z.object({ id }), (c, p) => parties.getSupplier(c, p.id)),
  'suppliers.save': d('supplier.manage', z.object({ id: opt(id), name: z.string().min(1).max(150), code: opt(z.string().max(30)), contact: opt(text), phone: opt(z.string().max(40)), email: opt(z.string().max(120)), address: opt(text), taxId: opt(z.string().max(40)), paymentTermsDays: opt(z.number().int().min(0).max(365)), notes: opt(z.string().max(1000)), active: z.boolean().optional() }), (c, p) => parties.saveSupplier(c, p)),
  'suppliers.delete': d('supplier.manage', z.object({ id }), (c, p) => parties.deleteSupplier(c, p.id)),
  'suppliers.pay': d(['finance.manage', 'purchase.manage'], z.object({ supplierId: id, methodId: id, amount: z.number().int().positive(), purchaseId: opt(id), note: opt(text) }), (c, p) => parties.paySupplier(c, p)),
  'purchases.list': d('purchase.view', z.object({ supplierId: opt(id), status: z.string().optional() }).optional(), (c, p) => purch.listPurchases(c, p ?? {})),
  'purchases.get': d('purchase.view', z.object({ id }), (c, p) => purch.getPurchase(c, p.id)),
  'purchases.create': d('purchase.manage', z.object({ supplierId: id, warehouseId: id, items: z.array(z.object({ variantId: id, qtyMilli: qty, unitCost: posMoney, taxRateBp: opt(z.number().int().min(0).max(10000)) })).min(1).max(500), supplierRef: opt(z.string().max(80)), expectedDate: opt(date), dueDate: opt(date), shippingCost: opt(posMoney), note: opt(text) }), (c, p) => purch.createPurchase(c, p)),
  'purchases.receive': d('purchase.manage', z.object({ purchaseId: id, items: z.array(z.object({ purchaseItemId: id, qtyMilli: qty, lotNo: opt(z.string().max(60)), expiryDate: opt(date) })).min(1), note: opt(text) }), (c, p) => purch.receivePurchase(c, p)),
  'purchases.cancel': d('purchase.manage', z.object({ id }), (c, p) => purch.cancelPurchase(c, p.id)),
  'purchases.returnToSupplier': d('purchase.manage', z.object({ supplierId: id, warehouseId: id, items: z.array(z.object({ variantId: id, qtyMilli: qty, unitCost: posMoney })).min(1), reason: opt(text) }), (c, p) => purch.returnToSupplier(c, p)),
  'finance.payables': d(['finance.view', 'purchase.view'], undefined, (c) => parties.payables(c)),
  'finance.receivables': d(['finance.view', 'customer.view'], undefined, (c) => parties.receivables(c)),
  // --- ventes ---
  'sales.create': d('sale.create', saleSchema, (c, p) => sales.createSale(c, p)),
  'sales.list': d('sale.view', z.object({ from: opt(date), to: opt(date), customerId: opt(id), userId: opt(id), status: opt(z.enum(['PAID', 'PARTIAL', 'UNPAID'])), q: z.string().max(60).optional(), registerId: opt(id), limit: z.number().int().max(1000).optional(), offset: z.number().int().optional() }).optional(), (c, p) => sales.listSales(c, p ?? {})),
  'sales.get': d('sale.view', z.object({ id }), (c, p) => sales.getSale(c, p.id)),
  'sales.return': d('sale.return', z.object({ saleId: id, items: z.array(z.object({ saleItemId: id, qtyMilli: qty })).min(1), refundMode: z.enum(['METHOD', 'STORE_CREDIT']).optional(), refundMethodId: opt(id), restock: z.boolean().optional(), reason: opt(text) }), (c, p) => sales.createReturn(c, p)),
  'sales.invoice': d('sale.view', z.object({ saleId: id }), (c, p) => sales.issueInvoice(c, p.saleId)),
  'held.list': d('sale.create', undefined, (c) => sales.listHeld(c)),
  'held.save': d('sale.create', z.object({ label: opt(z.string().max(80)), payload: z.any() }), (c, p) => sales.holdCart(c, p)),
  'held.resume': d('sale.create', z.object({ id }), (c, p) => sales.resumeHeld(c, p.id)),
  'held.discard': d('sale.create', z.object({ id }), (c, p) => sales.discardHeld(c, p.id)),
  // --- caisse ---
  'cash.open': d('cash.session', z.object({ registerId: id, openingFloat: posMoney }), (c, p) => cash.openSession(c, p)),
  'cash.close': d('cash.session', z.object({ sessionId: id, countedCash: posMoney, note: opt(text) }), (c, p) => cash.closeSession(c, p)),
  'cash.current': d(['cash.session', 'sale.create'], z.object({ registerId: opt(id) }).optional(), (c, p) => cash.currentSession(c, p?.registerId)),
  'cash.summary': d('cash.session', z.object({ sessionId: id }), (c, p) => cash.sessionSummary(c, p.sessionId)),
  'cash.sessions': d('cash.session', z.object({ registerId: opt(id), limit: z.number().int().max(500).optional() }).optional(), (c, p) => cash.listSessions(c, p ?? {})),
  'cash.inOut': d('cash.session', z.object({ sessionId: id, direction: z.enum(['IN', 'OUT']), amount: z.number().int().positive(), note: z.string().min(1).max(300) }), (c, p) => cash.cashInOut(c, p)),
  // --- finances ---
  'finance.accounts': d(['finance.view', 'sale.create'], undefined, (c) => fin.listAccounts(c)),
  'finance.saveAccount': d('finance.manage', z.object({ id: opt(id), name: z.string().min(1).max(100), type: z.enum(['CASH', 'BANK', 'MOBILE']), openingBalance: opt(money), active: z.boolean().optional() }), (c, p) => fin.saveAccount(c, p)),
  'finance.transactions': d('finance.view', z.object({ accountId: opt(id), kind: z.string().optional(), from: opt(date), to: opt(date), limit: z.number().int().max(3000).optional() }).optional(), (c, p) => fin.listTransactions(c, p ?? {})),
  'finance.expenses': d('finance.view', z.object({ from: opt(date), to: opt(date), categoryId: opt(id) }).optional(), (c, p) => fin.listExpenses(c, p ?? {})),
  'finance.createExpense': d('expense.manage', z.object({ categoryId: opt(id), accountId: id, amount: z.number().int().positive(), description: z.string().min(1).max(300), beneficiary: opt(z.string().max(150)), reference: opt(z.string().max(80)), date: opt(date) }), (c, p) => fin.createExpense(c, p)),
  'finance.ownerMovement': d('finance.manage', z.object({ accountId: id, kind: z.enum(['CAPITAL_CONTRIBUTION', 'OWNER_WITHDRAWAL']), amount: z.number().int().positive(), note: opt(text) }), (c, p) => fin.ownerMovement(c, p)),
  'finance.transfer': d('finance.manage', z.object({ fromAccountId: id, toAccountId: id, amount: z.number().int().positive(), note: opt(text) }), (c, p) => fin.transferFunds(c, p)),
  'finance.cashflow': d('finance.view', range, (c, p) => fin.cashflow(c, p.from ?? '0000-01-01', p.to ?? '9999-12-31')),
  // --- tableau de bord & rapports ---
  'dashboard.get': d('dashboard.view', z.object({ from: opt(date), to: opt(date), registerId: opt(id), userId: opt(id) }).optional(), (c, p) => dashboard(c, p ?? {})),
  'reports.types': d(null, undefined, (c) => REPORT_TYPES.filter((r) => c.user.permissions.has(r.perm))),
  'reports.run': d(['report.view', 'finance.view'], z.object({ type: z.string(), from: opt(date), to: opt(date), userId: opt(id) }), (c, p) => runReport(c, p)),
  // --- synchronisation (préparation) ---
  'sync.status': d(null, undefined, (c) => ({
    pending: c.db.value<number>("SELECT COUNT(*) FROM outbox WHERE status = 'PENDING'"), failed: c.db.value<number>("SELECT COUNT(*) FROM outbox WHERE status IN ('FAILED','CONFLICT')"),
    lastSentAt: c.db.value<string>("SELECT MAX(sent_at) FROM outbox WHERE status = 'SENT'") ?? null, enabled: false,
  })),
};

export type ApiMethod = keyof typeof defs;
export type ApiResult<M extends ApiMethod> = Awaited<ReturnType<(typeof defs)[M]['run']>>;
export type ApiParams<M extends ApiMethod> = (typeof defs)[M]['schema'] extends ZodType ? z.input<(typeof defs)[M]['schema']> : void;

export type Envelope<T = unknown> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; details?: unknown } };

const VERSION = '0.1.0';

export class App {
  readonly sessions: auth.SessionStore;
  constructor(readonly db: Db, private log: (m: string, e?: unknown) => void = () => {}) {
    this.sessions = new auth.SessionStore(db);
    if (isConfigured(db)) ensureSystemRoles(db); // mise à jour du logiciel : nouveaux rôles / droits sur une base existante
  }

  status() {
    const configured = isConfigured(this.db);
    return { configured, version: VERSION, company: configured ? { name: companyOf(this.db).name, locale: companyOf(this.db).locale, currency: companyOf(this.db).currency } : null };
  }

  /** Point d'entrée unique de l'IPC : authentifie, autorise (côté processus principal), valide, exécute. */
  async call(method: string, params: unknown, token?: string, device?: string): Promise<Envelope> {
    try {
      switch (method) {
        case 'app.status': return ok(this.status());
        case 'app.setup': {
          const p = z.object({
            companyName: z.string().min(1).max(200), currency: z.string().length(3).optional(), locale: z.enum(['fr', 'en']).optional(), timezone: z.string().max(60).optional(), pricesIncludeTax: z.boolean().optional(),
            admin: z.object({ username: z.string().min(3).max(40), displayName: z.string().min(1).max(100), password: z.string().min(8).max(200) }),
          }).parse(params);
          setupCompany(this.db, p);
          return ok(this.sessions.login(p.admin.username, p.admin.password, device));
        }
        case 'auth.login': {
          const p = z.object({ username: z.string().min(1).max(100), password: z.string().min(1).max(200) }).parse(params);
          return ok(this.sessions.login(p.username, p.password, device));
        }
        case 'auth.logout': if (token) this.sessions.logout(token); return ok(true);
        case 'auth.me': return ok(this.sessions.me(token ?? ''));
      }
      const def = (defs as Record<string, Def>)[method];
      if (!def) throw new AppError('UNKNOWN_METHOD', `Méthode inconnue : ${method}`);
      const ctx = this.sessions.resolve(token);
      // compte avec mot de passe temporaire : rien d'autre n'est autorisé tant qu'il n'a pas été changé
      if (ctx.user.mustChangePassword && method !== 'auth.changePassword') throw new AppError('PASSWORD_CHANGE_REQUIRED', 'Vous devez d’abord choisir votre propre mot de passe.');
      if (def.perm) {
        const needed = Array.isArray(def.perm) ? def.perm : [def.perm];
        if (!needed.some((p) => ctx.user.permissions.has(p))) {
          audit(ctx, 'security.forbidden', undefined, undefined, { method });
          throw new AppError('FORBIDDEN', `Permission requise : ${needed.join(' ou ')}`);
        }
      }
      const parsed = def.schema ? def.schema.parse(params ?? undefined) : undefined;
      return ok(await def.run(ctx, parsed));
    } catch (e) {
      return this.toError(e, method);
    }
  }

  private toError(e: unknown, method: string): Envelope {
    if (e instanceof AppError) return { ok: false, error: { code: e.code, message: e.message, details: e.details } };
    if (e instanceof ZodError) {
      const first = e.issues[0];
      return { ok: false, error: { code: 'VALIDATION', message: `Données invalides${first ? ` (${first.path.join('.') || 'valeur'} : ${first.message})` : ''}`, details: e.issues } };
    }
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith('IMMUTABLE_RECORD')) return { ok: false, error: { code: 'IMMUTABLE_RECORD', message: msg.replace('IMMUTABLE_RECORD: ', '') } };
    if (/UNIQUE constraint failed/.test(msg)) return { ok: false, error: { code: 'DUPLICATE', message: 'Cet enregistrement existe déjà' } };
    if (/FOREIGN KEY constraint failed/.test(msg)) return { ok: false, error: { code: 'IN_USE', message: 'Opération impossible : des données liées existent' } };
    this.log(`Erreur interne dans ${method}`, e);
    return { ok: false, error: { code: 'INTERNAL', message: 'Erreur interne. Consultez le journal.' } };
  }
}
const ok = <T>(data: T): Envelope<T> => ({ ok: true, data });

export { defs as apiDefinitions };
