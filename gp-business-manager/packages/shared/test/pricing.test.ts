import { describe, expect, it } from 'vitest';
import { computeCart, formatDocNumber, proratedReturn, settlePayments, SYSTEM_ROLES, PERMISSIONS } from '../src';

describe('computeCart', () => {
  it('prix HT + taxe ajoutée', () => {
    const r = computeCart([{ qtyMilli: 2000, unitPrice: 1000, taxRateBp: 2000 }], { pricesIncludeTax: false });
    expect(r.netTotal).toBe(2000);
    expect(r.taxTotal).toBe(400);
    expect(r.total).toBe(2400);
  });
  it('prix TTC : la taxe est extraite', () => {
    const r = computeCart([{ qtyMilli: 1000, unitPrice: 1200, taxRateBp: 2000 }], { pricesIncludeTax: true });
    expect(r.total).toBe(1200);
    expect(r.netTotal).toBe(1000);
    expect(r.taxTotal).toBe(200);
  });
  it('invariant : net + taxe = total, quelle que soit la remise', () => {
    const lines = [
      { qtyMilli: 3000, unitPrice: 333, taxRateBp: 2000, discountBp: 1000 },
      { qtyMilli: 1500, unitPrice: 799, taxRateBp: 500, discountAmount: 50 },
      { qtyMilli: 1000, unitPrice: 15, taxRateBp: 0 },
    ];
    for (const inc of [true, false]) {
      const r = computeCart(lines, { pricesIncludeTax: inc, cartDiscount: { type: 'percent', bp: 777 } });
      expect(r.netTotal + r.taxTotal).toBe(r.total);
      expect(r.subtotal - r.lineDiscountTotal - r.cartDiscountTotal).toBe(inc ? r.total : r.netTotal);
      for (const l of r.lines) expect(l.net + l.tax).toBe(l.total);
    }
  });
  it('remise globale en montant plafonnée et répartie', () => {
    const r = computeCart(
      [{ qtyMilli: 1000, unitPrice: 100, taxRateBp: 0 }, { qtyMilli: 1000, unitPrice: 200, taxRateBp: 0 }],
      { pricesIncludeTax: true, cartDiscount: { type: 'amount', amount: 10_000 } },
    );
    expect(r.total).toBe(0);
    expect(r.cartDiscountTotal).toBe(300);
  });
  it('remise ligne plafonnée au brut', () => {
    const r = computeCart([{ qtyMilli: 1000, unitPrice: 100, taxRateBp: 0, discountAmount: 500 }], { pricesIncludeTax: true });
    expect(r.total).toBe(0);
  });
});

describe('settlePayments', () => {
  it('espèces avec rendu de monnaie', () => {
    const s = settlePayments(4500, [{ methodId: 'c', kind: 'CASH', amount: 5000 }]);
    expect(s.paidTotal).toBe(4500);
    expect(s.change).toBe(500);
    expect(s.status).toBe('PAID');
    expect(s.payments[0]).toMatchObject({ applied: 4500, tendered: 5000 });
  });
  it('paiements multiples : le mobile money est imputé avant les espèces', () => {
    const s = settlePayments(10_000, [
      { methodId: 'c', kind: 'CASH', amount: 8000 },
      { methodId: 'm', kind: 'MOBILE', amount: 4000 },
    ]);
    expect(s.payments.find((p) => p.kind === 'MOBILE')!.applied).toBe(4000);
    expect(s.payments.find((p) => p.kind === 'CASH')!.applied).toBe(6000);
    expect(s.change).toBe(2000);
  });
  it('paiement partiel => créance', () => {
    const s = settlePayments(10_000, [{ methodId: 'c', kind: 'CASH', amount: 3000 }]);
    expect(s).toMatchObject({ paidTotal: 3000, creditAmount: 7000, status: 'PARTIAL', change: 0 });
  });
  it('vente 100 % à crédit', () => {
    expect(settlePayments(500, [])).toMatchObject({ creditAmount: 500, status: 'UNPAID' });
  });
  it('refuse un trop-perçu non-espèces et les montants invalides', () => {
    expect(() => settlePayments(100, [{ methodId: 'k', kind: 'CARD', amount: 200 }])).toThrow();
    expect(() => settlePayments(100, [{ methodId: 'c', kind: 'CASH', amount: 0 }])).toThrow();
    expect(() => settlePayments(100, [{ methodId: 'c', kind: 'CASH', amount: 1.5 }])).toThrow();
  });
});

describe('proratedReturn', () => {
  it('les retours successifs somment exactement au total', () => {
    const total = 1000;
    const a = proratedReturn(total, 3000, 0, 1000);
    const b = proratedReturn(total, 3000, 1000, 1000);
    const c = proratedReturn(total, 3000, 2000, 1000);
    expect(a + b + c).toBe(total);
  });
});

describe('numbering & permissions', () => {
  it('formate les numéros', () => {
    expect(formatDocNumber('FAC-{YYYY}-{000000}', 42, new Date('2026-03-05'))).toBe('FAC-2026-000042');
  });
  it('les rôles système ne référencent que des permissions connues', () => {
    for (const r of SYSTEM_ROLES) for (const p of r.permissions) expect(PERMISSIONS).toContain(p);
  });
});
