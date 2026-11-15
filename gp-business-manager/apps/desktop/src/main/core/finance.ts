import { audit, businessDate, fail, nextNumber, nowIso, numberingOf, outbox, uuid, type Ctx } from './util';

export type FtKind = 'SALE_RECEIPT' | 'CUSTOMER_PAYMENT' | 'CUSTOMER_ADVANCE' | 'REFUND' | 'EXPENSE' | 'SUPPLIER_PAYMENT' | 'CAPITAL_CONTRIBUTION' | 'OWNER_WITHDRAWAL' | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'ADJUSTMENT';
type CashType = 'SALE' | 'REFUND' | 'EXPENSE' | 'DEPOSIT' | 'WITHDRAWAL' | 'CUSTOMER_PAYMENT' | 'SUPPLIER_PAYMENT';

/** Écriture de trésorerie immuable (un flux d'argent = une ligne, jamais deux). */
export function recordFT(ctx: Ctx, f: { accountId: string; kind: FtKind; amount: number; refType?: string; refId?: string; transferId?: string; note?: string }) {
  const id = uuid();
  ctx.db.run(
    `INSERT INTO financial_transactions (id, account_id, kind, amount, ref_type, ref_id, transfer_id, note, user_id, at, business_date) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    id, f.accountId, f.kind, f.amount, f.refType ?? null, f.refId ?? null, f.transferId ?? null, f.note ?? null, ctx.user.id, nowIso(), businessDate(ctx.company().timezone),
  );
  return id;
}

/** Mouvement d'espèces dans la session de caisse ouverte dont le compte est `accountId` (s'il y en a une). */
export function cashMovementForAccount(ctx: Ctx, accountId: string, signed: number, type: CashType, ref: { refType?: string; refId?: string; note?: string }, sessionId?: string | null) {
  const sid = sessionId ?? ctx.db.value<string>(
    `SELECT s.id FROM cash_sessions s JOIN cash_registers r ON r.id = s.register_id WHERE s.status = 'OPEN' AND r.account_id = ?`, accountId);
  if (!sid) return null;
  ctx.db.run('INSERT INTO cash_movements (id, session_id, type, amount, ref_type, ref_id, note, user_id, at) VALUES (?,?,?,?,?,?,?,?,?)', uuid(), sid, type, signed, ref.refType ?? null, ref.refId ?? null, ref.note ?? null, ctx.user.id, nowIso());
  return sid;
}

export interface PaymentRecord {
  direction: 'IN' | 'OUT';
  methodId: string;
  amount: number;
  tendered?: number;
  saleId?: string;
  returnId?: string;
  customerId?: string;
  supplierId?: string;
  purchaseId?: string;
  sessionId?: string | null;
  /** compte espèces à utiliser pour un paiement en espèces (sinon : caisse de la session, sinon premier compte CASH) */
  cashAccountId?: string | null;
  ftKind: FtKind;
  cashType: CashType;
  reference?: string;
  note?: string;
}

function resolveAccount(ctx: Ctx, method: { kind: string; account_id: string | null }, p: PaymentRecord): string {
  if (method.kind === 'CASH') {
    if (p.cashAccountId) return p.cashAccountId;
    if (p.sessionId) {
      const a = ctx.db.value<string>('SELECT r.account_id FROM cash_sessions s JOIN cash_registers r ON r.id = s.register_id WHERE s.id = ?', p.sessionId);
      if (a) return a;
    }
    return ctx.db.value<string>("SELECT id FROM financial_accounts WHERE type = 'CASH' AND active = 1 ORDER BY created_at LIMIT 1") ?? fail('NO_ACCOUNT', 'Aucun compte espèces');
  }
  return method.account_id ?? ctx.db.value<string>("SELECT id FROM financial_accounts WHERE active = 1 AND type <> 'CASH' ORDER BY created_at LIMIT 1") ?? fail('NO_ACCOUNT', 'Aucun compte financier pour ce mode de paiement');
}

/** Enregistre un paiement + son écriture de trésorerie + son mouvement de caisse (si espèces) — toujours ensemble. */
export function recordPayment(ctx: Ctx, p: PaymentRecord): { id: string; accountId: string } {
  if (!Number.isInteger(p.amount) || p.amount <= 0) fail('INVALID_AMOUNT', 'Montant invalide');
  const method = ctx.db.get<any>('SELECT id, kind, account_id, name FROM payment_methods WHERE id = ? AND active = 1', p.methodId);
  if (!method) fail('NOT_FOUND', 'Mode de paiement introuvable');
  const accountId = resolveAccount(ctx, method, p);
  const id = uuid();
  ctx.db.run(
    `INSERT INTO payments (id, direction, method_id, account_id, amount, tendered, sale_id, return_id, customer_id, supplier_id, purchase_id, session_id, reference, note, user_id, at, business_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, p.direction, p.methodId, accountId, p.amount, p.tendered ?? p.amount, p.saleId ?? null, p.returnId ?? null, p.customerId ?? null, p.supplierId ?? null, p.purchaseId ?? null,
    p.sessionId ?? null, p.reference ?? null, p.note ?? null, ctx.user.id, nowIso(), businessDate(ctx.company().timezone),
  );
  const signed = p.direction === 'IN' ? p.amount : -p.amount;
  recordFT(ctx, { accountId, kind: p.ftKind, amount: signed, refType: 'payment', refId: id, note: p.note });
  if (method.kind === 'CASH') cashMovementForAccount(ctx, accountId, signed, p.cashType, { refType: 'payment', refId: id }, p.sessionId);
  outbox(ctx.db, 'payment', id, 'INSERT', { amount: p.amount, direction: p.direction });
  return { id, accountId };
}

// ---------- comptes financiers ----------
export function listAccounts(ctx: Ctx) {
  return ctx.db.all(
    `SELECT a.id, a.name, a.type, a.active, a.opening_balance AS openingBalance,
            a.opening_balance + COALESCE((SELECT SUM(amount) FROM financial_transactions f WHERE f.account_id = a.id), 0) AS balance
     FROM financial_accounts a ORDER BY a.type, a.name`);
}
export function saveAccount(ctx: Ctx, i: { id?: string; name: string; type: 'CASH' | 'BANK' | 'MOBILE'; openingBalance?: number; active?: boolean }) {
  const t = nowIso();
  const id = i.id ?? uuid();
  if (i.id) ctx.db.run('UPDATE financial_accounts SET name=?, active=?, updated_at=? WHERE id=?', i.name, i.active === false ? 0 : 1, t, id);
  else ctx.db.run('INSERT INTO financial_accounts (id, name, type, opening_balance, created_at, updated_at) VALUES (?,?,?,?,?,?)', id, i.name, i.type, i.openingBalance ?? 0, t, t);
  audit(ctx, 'account.save', 'account', id);
  return { id };
}

export function listTransactions(ctx: Ctx, q: { accountId?: string; kind?: string; from?: string; to?: string; limit?: number }) {
  return ctx.db.all(
    `SELECT f.id, f.at, f.business_date AS businessDate, f.kind, f.amount, f.note, f.ref_type AS refType, f.ref_id AS refId, a.name AS accountName, u.display_name AS userName
     FROM financial_transactions f JOIN financial_accounts a ON a.id = f.account_id LEFT JOIN users u ON u.id = f.user_id
     WHERE (? IS NULL OR f.account_id = ?) AND (? IS NULL OR f.kind = ?) AND (? IS NULL OR f.business_date >= ?) AND (? IS NULL OR f.business_date <= ?)
     ORDER BY f.at DESC, f.rowid DESC LIMIT ?`,
    q.accountId ?? null, q.accountId ?? null, q.kind ?? null, q.kind ?? null, q.from ?? null, q.from ?? null, q.to ?? null, q.to ?? null, Math.min(q.limit ?? 300, 3000));
}

// ---------- dépenses ----------
export function createExpense(ctx: Ctx, i: { categoryId?: string | null; accountId: string; amount: number; description: string; beneficiary?: string; reference?: string; date?: string }) {
  if (!Number.isInteger(i.amount) || i.amount <= 0) fail('INVALID_AMOUNT', 'Montant invalide');
  if (!i.description.trim()) fail('INVALID', 'Le libellé est obligatoire');
  return ctx.db.tx(() => {
    const acc = ctx.db.get<any>('SELECT * FROM financial_accounts WHERE id = ? AND active = 1', i.accountId);
    if (!acc) fail('NOT_FOUND', 'Compte introuvable');
    const bal = ctx.db.value<number>('SELECT opening_balance + COALESCE((SELECT SUM(amount) FROM financial_transactions WHERE account_id = ?),0) FROM financial_accounts WHERE id = ?', i.accountId, i.accountId)!;
    if (bal < i.amount) fail('INSUFFICIENT_FUNDS', `Solde insuffisant sur « ${acc.name} »`);
    const id = uuid();
    const number = nextNumber(ctx.db, 'EXPENSE', numberingOf(ctx.company()));
    const at = nowIso();
    const bd = i.date ?? businessDate(ctx.company().timezone);
    const sessionId = acc.type === 'CASH'
      ? ctx.db.value<string>("SELECT s.id FROM cash_sessions s JOIN cash_registers r ON r.id = s.register_id WHERE s.status='OPEN' AND r.account_id = ?", i.accountId) ?? null
      : null;
    ctx.db.run(
      'INSERT INTO expenses (id, number, category_id, account_id, session_id, amount, description, beneficiary, reference, user_id, at, business_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      id, number, i.categoryId ?? null, i.accountId, sessionId, i.amount, i.description.trim(), i.beneficiary ?? null, i.reference ?? null, ctx.user.id, at, bd,
    );
    recordFT(ctx, { accountId: i.accountId, kind: 'EXPENSE', amount: -i.amount, refType: 'expense', refId: id, note: i.description });
    if (sessionId) cashMovementForAccount(ctx, i.accountId, -i.amount, 'EXPENSE', { refType: 'expense', refId: id, note: i.description }, sessionId);
    outbox(ctx.db, 'expense', id, 'INSERT', { amount: i.amount });
    audit(ctx, 'expense.create', 'expense', id, { number, amount: i.amount });
    return { id, number };
  });
}
export function listExpenses(ctx: Ctx, q: { from?: string; to?: string; categoryId?: string; limit?: number }) {
  return ctx.db.all(
    `SELECT e.id, e.number, e.at, e.business_date AS businessDate, e.amount, e.description, e.beneficiary, e.reference, c.name AS categoryName, a.name AS accountName, u.display_name AS userName
     FROM expenses e LEFT JOIN expense_categories c ON c.id = e.category_id JOIN financial_accounts a ON a.id = e.account_id LEFT JOIN users u ON u.id = e.user_id
     WHERE (? IS NULL OR e.business_date >= ?) AND (? IS NULL OR e.business_date <= ?) AND (? IS NULL OR e.category_id = ?)
     ORDER BY e.at DESC LIMIT ?`, q.from ?? null, q.from ?? null, q.to ?? null, q.to ?? null, q.categoryId ?? null, q.categoryId ?? null, q.limit ?? 500);
}

/** Apport de l'exploitant (entrée) ou prélèvement (sortie) — jamais comptés comme chiffre d'affaires ni comme dépense. */
export function ownerMovement(ctx: Ctx, i: { accountId: string; kind: 'CAPITAL_CONTRIBUTION' | 'OWNER_WITHDRAWAL'; amount: number; note?: string }) {
  if (!Number.isInteger(i.amount) || i.amount <= 0) fail('INVALID_AMOUNT', 'Montant invalide');
  return ctx.db.tx(() => {
    const signed = i.kind === 'CAPITAL_CONTRIBUTION' ? i.amount : -i.amount;
    if (signed < 0) {
      const bal = ctx.db.value<number>('SELECT opening_balance + COALESCE((SELECT SUM(amount) FROM financial_transactions WHERE account_id = ?),0) FROM financial_accounts WHERE id = ?', i.accountId, i.accountId) ?? 0;
      if (bal < i.amount) fail('INSUFFICIENT_FUNDS', 'Solde insuffisant');
    }
    const id = recordFT(ctx, { accountId: i.accountId, kind: i.kind, amount: signed, note: i.note });
    cashMovementForAccount(ctx, i.accountId, signed, signed > 0 ? 'DEPOSIT' : 'WITHDRAWAL', { refType: 'ft', refId: id, note: i.note });
    audit(ctx, `finance.${i.kind.toLowerCase()}`, 'account', i.accountId, { amount: i.amount });
    return { id };
  });
}

/** Virement interne : deux écritures liées, neutres pour la trésorerie globale et exclues des recettes/dépenses. */
export function transferFunds(ctx: Ctx, i: { fromAccountId: string; toAccountId: string; amount: number; note?: string }) {
  if (i.fromAccountId === i.toAccountId) fail('INVALID', 'Comptes identiques');
  if (!Number.isInteger(i.amount) || i.amount <= 0) fail('INVALID_AMOUNT', 'Montant invalide');
  return ctx.db.tx(() => {
    const bal = ctx.db.value<number>('SELECT opening_balance + COALESCE((SELECT SUM(amount) FROM financial_transactions WHERE account_id = ?),0) FROM financial_accounts WHERE id = ?', i.fromAccountId, i.fromAccountId);
    if (bal === undefined) fail('NOT_FOUND', 'Compte introuvable');
    if (bal! < i.amount) fail('INSUFFICIENT_FUNDS', 'Solde insuffisant sur le compte source');
    const tid = uuid();
    const out = recordFT(ctx, { accountId: i.fromAccountId, kind: 'TRANSFER_OUT', amount: -i.amount, transferId: tid, note: i.note });
    const inn = recordFT(ctx, { accountId: i.toAccountId, kind: 'TRANSFER_IN', amount: i.amount, transferId: tid, note: i.note });
    cashMovementForAccount(ctx, i.fromAccountId, -i.amount, 'WITHDRAWAL', { refType: 'transfer', refId: tid, note: i.note });
    cashMovementForAccount(ctx, i.toAccountId, i.amount, 'DEPOSIT', { refType: 'transfer', refId: tid, note: i.note });
    audit(ctx, 'finance.transfer', 'transfer', tid, { ...i });
    return { transferId: tid, out, in: inn };
  });
}

/** Synthèse de trésorerie sur une période : chaque catégorie est séparée pour éviter tout double comptage. */
export function cashflow(ctx: Ctx, from: string, to: string) {
  const rows = ctx.db.all<{ kind: string; total: number }>(
    'SELECT kind, SUM(amount) AS total FROM financial_transactions WHERE business_date BETWEEN ? AND ? GROUP BY kind', from, to);
  const by = Object.fromEntries(rows.map((r) => [r.kind, r.total])) as Record<string, number>;
  const g = (k: string) => by[k] ?? 0;
  const inflow = g('SALE_RECEIPT') + g('CUSTOMER_PAYMENT') + g('CUSTOMER_ADVANCE');
  const outflow = g('EXPENSE') + g('SUPPLIER_PAYMENT') + g('REFUND');
  return {
    from, to,
    saleReceipts: g('SALE_RECEIPT'), customerPayments: g('CUSTOMER_PAYMENT'), customerAdvances: g('CUSTOMER_ADVANCE'),
    refunds: -g('REFUND'), expenses: -g('EXPENSE'), supplierPayments: -g('SUPPLIER_PAYMENT'),
    capitalContributions: g('CAPITAL_CONTRIBUTION'), ownerWithdrawals: -g('OWNER_WITHDRAWAL'),
    transfersNet: g('TRANSFER_IN') + g('TRANSFER_OUT'),
    operatingNet: inflow + outflow,
    netChange: Object.values(by).reduce((a, b) => a + b, 0),
  };
}
