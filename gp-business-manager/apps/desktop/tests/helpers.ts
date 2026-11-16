import { Db } from '../src/main/core/db';
import { App, type Envelope } from '../src/main/core/api';

export class Harness {
  app: App;
  db: Db;
  token = '';
  ids: Record<string, string> = {};
  constructor() {
    this.db = new Db(':memory:');
    this.app = new App(this.db);
  }
  async call<T = any>(method: string, params?: unknown, token = this.token): Promise<T> {
    const r = (await this.app.call(method, params, token)) as Envelope<T>;
    if (!r.ok) throw Object.assign(new Error(`${r.error.code}: ${r.error.message}`), { code: r.error.code });
    return r.data;
  }
  async fails(method: string, params: unknown, code: string, token = this.token) {
    const r = await this.app.call(method, params, token);
    if (r.ok) throw new Error(`${method} aurait dû échouer avec ${code}`);
    if (r.error.code !== code) throw new Error(`${method} : code attendu ${code}, reçu ${r.error.code} (${r.error.message})`);
  }
  async boot() {
    const r: any = await this.call('app.setup', { companyName: 'Boutique Test', currency: 'MGA', admin: { username: 'admin', displayName: 'Admin', password: 'Admin#2026' } }, '');
    this.token = r.token;
    const regs = await this.call('org.registers');
    this.ids.register = regs[0].id;
    this.ids.account = regs[0].accountId;
    this.ids.warehouse = regs[0].warehouseId;
    const pm = await this.call('ref.paymentMethods');
    for (const m of pm) this.ids[`pm_${m.code}`] = m.id;
    const taxes = await this.call('ref.taxRates');
    this.ids.tax20 = taxes.find((t: any) => t.rateBp === 2000).id;
    this.ids.tax0 = taxes.find((t: any) => t.rateBp === 0).id;
    return this;
  }
  async openCash(float = 10_000) {
    return this.call('cash.open', { registerId: this.ids.register, openingFloat: float });
  }
  async product(name: string, o: { price: number; cost?: number; qty?: number; tax?: string; barcode?: string; sku?: string; lots?: boolean; alert?: number; wholesale?: number }) {
    const r = await this.call('products.save', {
      name, taxRateId: o.tax ?? this.ids.tax0, trackLots: o.lots,
      variants: [{ sku: o.sku, costPrice: o.cost ?? 0, price: o.price, wholesalePrice: o.wholesale, openingQtyMilli: o.qty ? o.qty * 1000 : undefined, alertQtyMilli: o.alert, barcodes: o.barcode ? [o.barcode] : [] }],
    });
    const p = await this.call('products.get', { id: r.id });
    return { productId: r.id, variantId: p.variants[0].id as string, sku: p.variants[0].sku as string };
  }
  stock(variantId: string, wh = this.ids.warehouse): number {
    return this.db.value<number>('SELECT COALESCE(qty_milli,0) FROM stock WHERE variant_id = ? AND warehouse_id = ?', variantId, wh) ?? 0;
  }
  async user(username: string, roleCode: string, branchId?: string) {
    const roles = await this.call('roles.list');
    const roleId = roles.find((r: any) => r.code === roleCode).id;
    await this.call('users.create', { username, displayName: username, password: 'Passw0rd!x', roleId, branchId, mustChangePassword: false });
    const l = await this.app.call('auth.login', { username, password: 'Passw0rd!x' });
    if (!l.ok) throw new Error('login failed');
    return (l.data as any).token as string;
  }
}
