import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROLE, createTestDb, ensurePaymentMethod, registerHotel, seedGuest, sqlState, withTenant, type HotelFixture, type TestDb } from './helpers.js';

let db: TestDb;
let H: HotelFixture;
let guest: string;

const as = <T>(fn: (tx: pg.PoolClient) => Promise<T>) => withTenant(db.app, { hotelId: H.hotelId, userId: H.userId }, fn, ROLE);

async function newFolio(): Promise<string> {
  const id = randomUUID();
  await as((tx) => tx.query(`INSERT INTO folios (id, hotel_id, guest_id, currency) VALUES ($1, $2, $3, 'MGA')`, [id, H.hotelId, guest]));
  return id;
}

async function charge(folioId: string, amount: number, tax = 0, kind = 'service'): Promise<string> {
  const id = randomUUID();
  await as((tx) => tx.query(
    `INSERT INTO folio_charges (id, hotel_id, folio_id, kind, description, unit_amount, amount, tax_amount) VALUES ($1, $2, $3, $4, 'Prestation', $5, $5, $6)`,
    [id, H.hotelId, folioId, kind, amount, tax]));
  return id;
}

interface PayOpts { kind?: 'deposit' | 'payment' | 'refund'; status?: string; method?: string; currency?: string; rate?: number; base?: number; of?: string; key?: string }
async function pay(folioId: string, amount: number, o: PayOpts = {}): Promise<string> {
  const id = randomUUID();
  const kind = o.kind ?? 'payment';
  await as((tx) => tx.query(
    `INSERT INTO payments (id, hotel_id, folio_id, kind, method_code, amount, currency, exchange_rate, base_amount, status, refund_of_payment_id, reason, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [id, H.hotelId, folioId, kind, o.method ?? 'cash', amount, o.currency ?? 'MGA', o.rate ?? 1, o.base ?? amount, o.status ?? 'confirmed', o.of ?? null, kind === 'refund' ? 'Geste commercial' : null, o.key ?? null]));
  return id;
}

const balance = async (folioId: string) =>
  (await as((tx) => tx.query('SELECT charges_total::int AS charges, payments_total::int AS paid, balance_due::int AS due, payment_status AS status FROM folio_balances WHERE folio_id = $1', [folioId]))).rows[0] as
  { charges: number; paid: number; due: number; status: string };

async function draftInvoice(folioId: string, lines: Array<{ amount: number; tax?: number }>, opts: { kind?: string; creditFor?: string } = {}): Promise<{ id: string; subtotal: number; tax: number; total: number }> {
  const id = randomUUID();
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const tax = lines.reduce((s, l) => s + (l.tax ?? 0), 0);
  await as(async (tx) => {
    await tx.query(
      `INSERT INTO invoices (id, hotel_id, folio_id, guest_id, kind, credit_for_invoice_id, currency, subtotal_amount, tax_amount, total_amount)
       VALUES ($1, $2, $3, $4, $5, $6, 'MGA', $7, $8, $9)`,
      [id, H.hotelId, folioId, guest, opts.kind ?? 'invoice', opts.creditFor ?? null, subtotal, tax, subtotal + tax]);
    for (const [i, l] of lines.entries()) {
      await tx.query(`INSERT INTO invoice_lines (hotel_id, invoice_id, position, description, unit_amount, amount, tax_amount) VALUES ($1, $2, $3, 'Ligne', $4, $4, $5)`,
        [H.hotelId, id, i, l.amount, l.tax ?? 0]);
    }
  });
  return { id, subtotal, tax, total: subtotal + tax };
}

async function issue(invoiceId: string, dueIn = '7 days'): Promise<string> {
  return as(async (tx) => {
    const { rows } = await tx.query<{ n: string }>("SELECT next_hotel_counter('invoice') AS n");
    const number = `FAC-${rows[0]!.n.padStart(6, '0')}`;
    await tx.query(`UPDATE invoices SET status = 'issued', number = $2, issued_at = now(), due_at = now() + $3::interval WHERE id = $1`, [invoiceId, number, dueIn]);
    return number;
  });
}

const invBalance = async (invoiceId: string) =>
  (await as((tx) => tx.query(
    'SELECT effective_total::int AS eff, amount_paid::int AS paid, balance_due::int AS due, payment_status AS status, is_overdue FROM invoice_balances WHERE invoice_id = $1', [invoiceId]))).rows[0] as
  { eff: number; paid: number; due: number; status: string; is_overdue: boolean };

beforeAll(async () => {
  db = await createTestDb();
  H = await registerHotel(db, { plan: 'business' });
  guest = await seedGuest(db, H);
  await ensurePaymentMethod(db, H, 'cash');
  await ensurePaymentMethod(db, H, 'mvola');
});
afterAll(async () => {
  await db.drop();
});

describe('solde du folio : calculé depuis les transactions, jamais « payé » sans paiement', () => {
  it('un folio chargé sans paiement est impayé', async () => {
    const f = await newFolio();
    await charge(f, 100_000);
    expect(await balance(f)).toEqual({ charges: 100_000, paid: 0, due: 100_000, status: 'unpaid' });
  });

  it('gère acompte, paiements partiels puis solde, taxes incluses', async () => {
    const f = await newFolio();
    await charge(f, 100_000, 20_000); // 120 000 TTC
    await pay(f, 30_000, { kind: 'deposit' });
    expect(await balance(f)).toMatchObject({ charges: 120_000, paid: 30_000, due: 90_000, status: 'partially_paid' });
    await pay(f, 50_000, { method: 'mvola' });
    expect(await balance(f)).toMatchObject({ paid: 80_000, due: 40_000, status: 'partially_paid' });
    await pay(f, 40_000);
    expect(await balance(f)).toMatchObject({ paid: 120_000, due: 0, status: 'paid' });
  });

  it('un paiement en attente ou échoué ne compte pas ; il compte une fois confirmé', async () => {
    const f = await newFolio();
    await charge(f, 50_000);
    const pending = await pay(f, 50_000, { status: 'pending', method: 'mvola' });
    await pay(f, 50_000, { status: 'failed' });
    expect(await balance(f)).toMatchObject({ paid: 0, status: 'unpaid' });
    await as((tx) => tx.query(`UPDATE payments SET status = 'confirmed' WHERE id = $1`, [pending]));
    expect(await balance(f)).toMatchObject({ paid: 50_000, due: 0, status: 'paid' });
  });

  it('une charge annulée (void) sort du solde ; une remise le réduit', async () => {
    const f = await newFolio();
    await charge(f, 80_000);
    const extra = await charge(f, 20_000);
    await as((tx) => tx.query(`UPDATE folio_charges SET voided_at = now(), void_reason = 'Erreur de saisie' WHERE id = $1`, [extra]));
    expect((await balance(f)).charges).toBe(80_000);
    await as((tx) => tx.query(
      `INSERT INTO folio_charges (hotel_id, folio_id, kind, description, unit_amount, amount) VALUES ($1, $2, 'discount', 'Remise fidélité', -10000, -10000)`, [H.hotelId, f]));
    expect((await balance(f)).charges).toBe(70_000);
    expect((await sqlState(as((tx) => tx.query(
      `INSERT INTO folio_charges (hotel_id, folio_id, kind, description, unit_amount, amount) VALUES ($1, $2, 'discount', 'Remise positive', 5, 5)`, [H.hotelId, f])))).code).toBe('23514');
  });

  it('un paiement en devise étrangère est converti avec le taux enregistré (EUR -> MGA)', async () => {
    const f = await newFolio();
    await charge(f, 500_000);
    // 20,00 EUR = 2000 centimes, taux saisi 4800 MGA/EUR -> 96 000 MGA
    await pay(f, 2000, { currency: 'EUR', rate: 4800, base: 96_000 });
    expect(await balance(f)).toMatchObject({ paid: 96_000, due: 404_000, status: 'partially_paid' });
  });
});

describe('grand livre des paiements : ajout seul', () => {
  it('un paiement ne peut ni être modifié ni supprimé', async () => {
    const f = await newFolio();
    await charge(f, 10_000);
    const p = await pay(f, 10_000);
    for (const sql of ['UPDATE payments SET amount = 1 WHERE id = $1', 'UPDATE payments SET base_amount = 1 WHERE id = $1', "UPDATE payments SET kind = 'deposit' WHERE id = $1", 'UPDATE payments SET folio_id = NULL WHERE id = $1']) {
      const r = await sqlState(as((tx) => tx.query(sql, [p])));
      expect(r.message, sql).toMatch(/payment_immutable|violates check/);
    }
    expect((await sqlState(as((tx) => tx.query('DELETE FROM payments WHERE id = $1', [p])))).code).toBe('42501');
    // même un administrateur de base de données est arrêté par le trigger
    const viaAdmin = await sqlState(db.admin.query('DELETE FROM payments WHERE id = $1', [p]));
    expect(viaAdmin.message).toBe('payment_not_deletable');
  });

  it('un paiement confirmé ne peut plus changer de statut', async () => {
    const f = await newFolio();
    const p = await pay(f, 5_000);
    const r = await sqlState(as((tx) => tx.query(`UPDATE payments SET status = 'failed' WHERE id = $1`, [p])));
    expect(r.message).toBe('payment_status_transition_invalid');
  });

  it('une clé d\'idempotence empêche d\'enregistrer deux fois le même paiement rejoué', async () => {
    const f = await newFolio();
    const key = randomUUID();
    await pay(f, 7_000, { key });
    expect((await sqlState(pay(f, 7_000, { key }))).code).toBe('23505');
    expect((await db.admin.query('SELECT count(*)::int AS n FROM payments WHERE idempotency_key = $1', [key])).rows[0].n).toBe(1);
  });

  it('refuse un moyen de paiement inconnu de l\'établissement et un paiement sans cible', async () => {
    const f = await newFolio();
    expect((await sqlState(pay(f, 1_000, { method: 'bitcoin' }))).code).toBe('23503');
    expect((await sqlState(as((tx) => tx.query(
      `INSERT INTO payments (hotel_id, kind, method_code, amount, currency, base_amount) VALUES ($1, 'payment', 'cash', 1000, 'MGA', 1000)`, [H.hotelId])))).code).toBe('23514');
    expect((await sqlState(pay(f, 0))).code).toBe('23514');
  });
});

describe('remboursements', () => {
  it('rembourse partiellement puis jusqu\'au plafond, jamais au-delà ; le solde en tient compte', async () => {
    const f = await newFolio();
    await charge(f, 100_000);
    const p = await pay(f, 100_000);
    await pay(f, 30_000, { kind: 'refund', of: p });
    expect(await balance(f)).toMatchObject({ paid: 70_000, due: 30_000, status: 'partially_paid' });
    const over = await sqlState(pay(f, 80_000, { kind: 'refund', of: p }));
    expect(over.message).toBe('refund_exceeds_payment');
    await pay(f, 70_000, { kind: 'refund', of: p });
    expect(await balance(f)).toMatchObject({ paid: 0, status: 'unpaid' });
    expect((await sqlState(pay(f, 1, { kind: 'refund', of: p }))).message).toBe('refund_exceeds_payment');
  });

  it('deux remboursements simultanés ne peuvent pas dépasser ensemble le paiement', async () => {
    const f = await newFolio();
    const p = await pay(f, 100_000);
    const results = await Promise.allSettled([60_000, 60_000, 60_000].map((a) => pay(f, a, { kind: 'refund', of: p })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const { rows } = await db.admin.query(`SELECT COALESCE(sum(amount), 0)::int AS refunded FROM payments WHERE refund_of_payment_id = $1`, [p]);
    expect(rows[0].refunded).toBeLessThanOrEqual(100_000);
  });

  it('refuse de rembourser un remboursement, un paiement non confirmé ou dans une autre devise ; la raison est obligatoire', async () => {
    const f = await newFolio();
    const p = await pay(f, 10_000);
    const r1 = await pay(f, 1_000, { kind: 'refund', of: p });
    expect((await sqlState(pay(f, 100, { kind: 'refund', of: r1 }))).message).toBe('refund_invalid_target');
    const pending = await pay(f, 10_000, { status: 'pending' });
    expect((await sqlState(pay(f, 100, { kind: 'refund', of: pending }))).message).toBe('refund_invalid_target');
    expect((await sqlState(pay(f, 100, { kind: 'refund', of: p, currency: 'EUR' }))).message).toBe('refund_currency_mismatch');
    const noReason = await sqlState(as((tx) => tx.query(
      `INSERT INTO payments (hotel_id, folio_id, kind, method_code, amount, currency, base_amount, refund_of_payment_id) VALUES ($1, $2, 'refund', 'cash', 100, 'MGA', 100, $3)`, [H.hotelId, f, p])));
    expect(noReason.code).toBe('23514');
  });
});

describe('factures : numérotation, immutabilité, avoirs', () => {
  it('une facture émise est immuable : montants, lignes, suppression, retour au brouillon', async () => {
    const f = await newFolio();
    await charge(f, 100_000);
    const inv = await draftInvoice(f, [{ amount: 100_000, tax: 20_000 }]);
    await issue(inv.id);
    expect((await sqlState(as((tx) => tx.query('UPDATE invoices SET subtotal_amount = 1, total_amount = 1 + tax_amount WHERE id = $1', [inv.id])))).message).toBe('invoice_immutable');
    expect((await sqlState(as((tx) => tx.query("UPDATE invoices SET number = 'FAC-TRUQUE' WHERE id = $1", [inv.id])))).message).toBe('invoice_immutable');
    expect((await sqlState(as((tx) => tx.query("INSERT INTO invoice_lines (hotel_id, invoice_id, description, unit_amount, amount) VALUES ($1, $2, 'Ajout', 5, 5)", [H.hotelId, inv.id])))).message).toBe('invoice_immutable');
    expect((await sqlState(as((tx) => tx.query('UPDATE invoice_lines SET amount = 1 WHERE invoice_id = $1', [inv.id])))).message).toBe('invoice_immutable');
    expect((await sqlState(as((tx) => tx.query('DELETE FROM invoice_lines WHERE invoice_id = $1', [inv.id])))).message).toBe('invoice_immutable');
    expect((await sqlState(as((tx) => tx.query('DELETE FROM invoices WHERE id = $1', [inv.id])))).message).toBe('invoice_not_deletable');
    expect((await sqlState(as((tx) => tx.query("UPDATE invoices SET status = 'draft' WHERE id = $1", [inv.id])))).message).toBe('invoice_status_transition_invalid');
  });

  it('refuse d\'émettre une facture sans lignes ou dont les totaux ne correspondent pas aux lignes', async () => {
    const f = await newFolio();
    const empty = randomUUID();
    await as((tx) => tx.query(`INSERT INTO invoices (id, hotel_id, folio_id, currency) VALUES ($1, $2, $3, 'MGA')`, [empty, H.hotelId, f]));
    expect((await sqlState(issue(empty))).message).toBe('invoice_without_lines');
    const inv = await draftInvoice(f, [{ amount: 1_000 }]);
    await as((tx) => tx.query('UPDATE invoices SET subtotal_amount = 5000, total_amount = 5000 WHERE id = $1', [inv.id]));
    expect((await sqlState(issue(inv.id))).message).toBe('invoice_totals_mismatch');
  });

  it('un brouillon reste modifiable et supprimable', async () => {
    const f = await newFolio();
    const inv = await draftInvoice(f, [{ amount: 2_000 }]);
    await as((tx) => tx.query("UPDATE invoice_lines SET description = 'Modifiée' WHERE invoice_id = $1", [inv.id]));
    await as((tx) => tx.query('DELETE FROM invoices WHERE id = $1', [inv.id]));
  });

  it('annuler (void) une facture émise exige un motif ; le montant reste intact', async () => {
    const f = await newFolio();
    const inv = await draftInvoice(f, [{ amount: 9_000 }]);
    await issue(inv.id);
    expect((await sqlState(as((tx) => tx.query("UPDATE invoices SET status = 'void' WHERE id = $1", [inv.id])))).code).toBe('23514');
    await as((tx) => tx.query("UPDATE invoices SET status = 'void', voided_at = now(), void_reason = 'Erreur de client' WHERE id = $1", [inv.id]));
    expect((await sqlState(as((tx) => tx.query("UPDATE invoices SET status = 'issued' WHERE id = $1", [inv.id])))).message).toBe('invoice_status_transition_invalid');
  });

  it('les numéros de facture sont uniques par établissement, séquentiels et sans trou', async () => {
    const f = await newFolio();
    const numbers: string[] = [];
    for (let i = 0; i < 3; i++) {
      const inv = await draftInvoice(f, [{ amount: 1_000 }]);
      numbers.push(await issue(inv.id));
    }
    const n = numbers.map((x) => Number(x.split('-')[1]));
    expect(n[1]).toBe(n[0]! + 1);
    expect(n[2]).toBe(n[1]! + 1);
    // même numéro dans le même établissement : refusé
    const dup = await draftInvoice(f, [{ amount: 1_000 }]);
    const r = await sqlState(as((tx) => tx.query(`UPDATE invoices SET status = 'issued', number = $2, issued_at = now() WHERE id = $1`, [dup.id, numbers[0]])));
    expect(r.code).toBe('23505');
  });

  it('un avoir réduit le montant dû, sans jamais dépasser la facture d\'origine', async () => {
    const f = await newFolio();
    await charge(f, 100_000);
    const inv = await draftInvoice(f, [{ amount: 100_000 }]);
    await issue(inv.id);
    const c1 = await draftInvoice(f, [{ amount: 30_000 }], { kind: 'credit_note', creditFor: inv.id });
    await issue(c1.id);
    expect(await invBalance(inv.id)).toMatchObject({ eff: 70_000, due: 70_000, status: 'unpaid' });
    const c2 = await draftInvoice(f, [{ amount: 80_000 }], { kind: 'credit_note', creditFor: inv.id });
    expect((await sqlState(issue(c2.id))).message).toBe('credit_exceeds_invoice');
    const c3 = await draftInvoice(f, [{ amount: 70_000 }], { kind: 'credit_note', creditFor: inv.id });
    await issue(c3.id); // exactement le reste : accepté
    expect(await invBalance(inv.id)).toMatchObject({ eff: 0, status: 'no_payment_due' });
  });

  it('un avoir doit viser une facture émise et le type doit être cohérent', async () => {
    const f = await newFolio();
    const draft = await draftInvoice(f, [{ amount: 1_000 }]);
    const credit = await draftInvoice(f, [{ amount: 500 }], { kind: 'credit_note', creditFor: draft.id });
    expect((await sqlState(issue(credit.id))).message).toBe('credit_note_invalid_target');
    expect((await sqlState(as((tx) => tx.query(`INSERT INTO invoices (hotel_id, folio_id, kind, currency) VALUES ($1, $2, 'credit_note', 'MGA')`, [H.hotelId, f])))).code).toBe('23514');
  });

  it('une charge déjà facturée ne peut plus changer de montant', async () => {
    const f = await newFolio();
    const c = await charge(f, 40_000);
    const inv = await draftInvoice(f, [{ amount: 40_000 }]);
    await as((tx) => tx.query('UPDATE folio_charges SET invoice_id = $2 WHERE id = $1', [c, inv.id]));
    await issue(inv.id);
    expect((await sqlState(as((tx) => tx.query('UPDATE folio_charges SET amount = 1, unit_amount = 1 WHERE id = $1', [c])))).message).toBe('charge_already_invoiced');
  });
});

describe('soldes de facture : imputation des paiements du folio, sans « payée » sans transaction', () => {
  it('une facture émise sans aucun paiement est impayée, puis partiellement payée, puis payée', async () => {
    const f = await newFolio();
    await charge(f, 100_000);
    const inv = await draftInvoice(f, [{ amount: 100_000 }]);
    await issue(inv.id);
    expect(await invBalance(inv.id)).toMatchObject({ paid: 0, due: 100_000, status: 'unpaid' });
    await pay(f, 25_000, { kind: 'deposit' }); // l'acompte versé avant la facture est imputé
    expect(await invBalance(inv.id)).toMatchObject({ paid: 25_000, due: 75_000, status: 'partially_paid' });
    await pay(f, 75_000);
    expect(await invBalance(inv.id)).toMatchObject({ paid: 100_000, due: 0, status: 'paid' });
    await pay(f, 5_000); // trop-perçu : la facture ne dépasse pas son montant
    expect(await invBalance(inv.id)).toMatchObject({ paid: 100_000, due: 0, status: 'paid' });
  });

  it('un remboursement fait repasser la facture en partiellement payée', async () => {
    const f = await newFolio();
    await charge(f, 50_000);
    const inv = await draftInvoice(f, [{ amount: 50_000 }]);
    await issue(inv.id);
    const p = await pay(f, 50_000);
    expect(await invBalance(inv.id)).toMatchObject({ status: 'paid' });
    await pay(f, 20_000, { kind: 'refund', of: p });
    expect(await invBalance(inv.id)).toMatchObject({ paid: 30_000, due: 20_000, status: 'partially_paid' });
  });

  it('impute les paiements dans l\'ordre d\'émission quand un folio a plusieurs factures', async () => {
    const f = await newFolio();
    await charge(f, 100_000);
    const first = await draftInvoice(f, [{ amount: 60_000 }]);
    await issue(first.id);
    const second = await draftInvoice(f, [{ amount: 40_000 }]);
    await issue(second.id);
    await pay(f, 70_000);
    expect(await invBalance(first.id)).toMatchObject({ paid: 60_000, status: 'paid' });
    expect(await invBalance(second.id)).toMatchObject({ paid: 10_000, due: 30_000, status: 'partially_paid' });
  });

  it('signale les factures en retard uniquement si un solde reste dû', async () => {
    const f = await newFolio();
    await charge(f, 10_000);
    const inv = await draftInvoice(f, [{ amount: 10_000 }]);
    await issue(inv.id, '-1 day');
    expect((await invBalance(inv.id)).is_overdue).toBe(true);
    await pay(f, 10_000);
    expect((await invBalance(inv.id)).is_overdue).toBe(false);
  });

  it('les brouillons et factures annulées n\'apparaissent pas dans les soldes', async () => {
    const f = await newFolio();
    const draft = await draftInvoice(f, [{ amount: 1_000 }]);
    expect(await invBalance(draft.id)).toBeUndefined();
  });
});

describe('numérotation sans trou', () => {
  it('20 demandes simultanées produisent 20 numéros distincts et consécutifs', async () => {
    const key = `conc-${randomUUID()}`;
    const results = await Promise.all(Array.from({ length: 20 }, () => as(async (tx) => Number((await tx.query<{ n: string }>('SELECT next_hotel_counter($1) AS n', [key])).rows[0]!.n))));
    expect([...results].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('une transaction annulée ne laisse aucun trou dans la séquence', async () => {
    const key = `rb-${randomUUID()}`;
    const next = () => as(async (tx) => Number((await tx.query<{ n: string }>('SELECT next_hotel_counter($1) AS n', [key])).rows[0]!.n));
    expect(await next()).toBe(1);
    expect(await next()).toBe(2);
    await as(async (tx) => {
      await tx.query('SELECT next_hotel_counter($1)', [key]);
      throw new Error('échec simulé après l\'attribution du numéro');
    }).catch(() => undefined);
    expect(await next()).toBe(3);
  });

  it('les compteurs de deux établissements sont indépendants', async () => {
    const other = await registerHotel(db, { plan: 'starter' });
    const nextOther = () => withTenant(db.app, { hotelId: other.hotelId }, async (tx) => Number((await tx.query<{ n: string }>("SELECT next_hotel_counter('invoice') AS n")).rows[0]!.n), ROLE);
    expect(await nextOther()).toBe(1);
  });
});

describe('restaurant -> chambre : une commande n\'est imputée qu\'une fois', () => {
  it('refuse d\'imputer deux fois la même commande sur le folio', async () => {
    const f = await newFolio();
    const orderId = randomUUID();
    await as((tx) => tx.query(
      `INSERT INTO orders (id, hotel_id, number, folio_id, status, currency, subtotal_amount, total_amount) VALUES ($1, $2, $3, $4, 'posted_to_room', 'MGA', 15000, 15000)`,
      [orderId, H.hotelId, `CMD-${orderId}`, f]));
    const post = () => as((tx) => tx.query(
      `INSERT INTO folio_charges (hotel_id, folio_id, kind, description, unit_amount, amount, source, source_ref) VALUES ($1, $2, 'restaurant', 'Dîner', 15000, 15000, 'restaurant_order', $3)`,
      [H.hotelId, f, orderId]));
    await post();
    expect((await sqlState(post())).code).toBe('23505');
    expect((await balance(f)).charges).toBe(15_000);
  });

  it('une commande « imputée à la chambre » doit avoir un folio', async () => {
    const r = await sqlState(as((tx) => tx.query(
      `INSERT INTO orders (hotel_id, number, status, currency) VALUES ($1, $2, 'posted_to_room', 'MGA')`, [H.hotelId, `CMD-${randomUUID()}`])));
    expect(r.code).toBe('23514');
  });
});
