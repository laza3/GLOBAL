import { audit, branchScope, fail, nowIso, outbox, uuid, type Ctx } from './util';
import { ownerMovement, recordFT } from './finance';

export function openSession(ctx: Ctx, i: { registerId: string; openingFloat: number }) {
  if (!Number.isInteger(i.openingFloat) || i.openingFloat < 0) fail('INVALID_AMOUNT', 'Fond de caisse invalide');
  const reg = ctx.db.get<any>('SELECT * FROM cash_registers WHERE id = ? AND active = 1', i.registerId);
  if (!reg) fail('NOT_FOUND', 'Caisse introuvable');
  if (branchScope(ctx) && reg.branch_id !== branchScope(ctx)) fail('BRANCH_FORBIDDEN', 'Cette caisse appartient à une autre boutique que la vôtre.');
  if (ctx.db.get("SELECT 1 FROM cash_sessions WHERE register_id = ? AND status = 'OPEN'", i.registerId)) fail('SESSION_OPEN', 'Cette caisse est déjà ouverte');
  return ctx.db.tx(() => {
    const id = uuid();
    ctx.db.run("INSERT INTO cash_sessions (id, register_id, user_id, opened_at, opening_float, status) VALUES (?,?,?,?,?,'OPEN')", id, i.registerId, ctx.user.id, nowIso(), i.openingFloat);
    outbox(ctx.db, 'cash_session', id, 'INSERT', { registerId: i.registerId });
    audit(ctx, 'cash.open', 'cash_session', id, { openingFloat: i.openingFloat });
    return { id };
  });
}

export function sessionSummary(ctx: Ctx, sessionId: string) {
  const s = ctx.db.get<any>(
    `SELECT s.*, r.name AS register_name, r.account_id, u.display_name AS user_name FROM cash_sessions s JOIN cash_registers r ON r.id = s.register_id JOIN users u ON u.id = s.user_id WHERE s.id = ?`, sessionId);
  if (!s) fail('NOT_FOUND', 'Session introuvable');
  const mv = Object.fromEntries(ctx.db.all<{ type: string; total: number }>('SELECT type, SUM(amount) AS total FROM cash_movements WHERE session_id = ? GROUP BY type', sessionId).map((r) => [r.type, r.total]));
  const cashNet = Object.values(mv).reduce((a: number, b) => a + (b as number), 0);
  const expected = s.opening_float + cashNet;
  const sales = ctx.db.get<any>('SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS total, COALESCE(SUM(returned_total),0) AS returned FROM sales WHERE session_id = ?', sessionId)!;
  const byMethod = ctx.db.all(
    `SELECT m.name, m.kind, COALESCE(SUM(CASE WHEN p.direction='IN' THEN p.amount ELSE -p.amount END),0) AS total
     FROM payments p JOIN payment_methods m ON m.id = p.method_id WHERE p.session_id = ? GROUP BY m.id ORDER BY total DESC`, sessionId);
  return {
    id: s.id, registerId: s.register_id, registerName: s.register_name, userName: s.user_name, userId: s.user_id, status: s.status,
    openedAt: s.opened_at, closedAt: s.closed_at, openingFloat: s.opening_float,
    movements: mv as Record<string, number>, expectedCash: s.status === 'CLOSED' ? s.expected_cash : expected,
    countedCash: s.counted_cash, difference: s.difference, closeNote: s.close_note,
    salesCount: sales.n, salesTotal: sales.total, returnedTotal: sales.returned, byMethod,
  };
}

export function closeSession(ctx: Ctx, i: { sessionId: string; countedCash: number; note?: string }) {
  if (!Number.isInteger(i.countedCash) || i.countedCash < 0) fail('INVALID_AMOUNT', 'Montant compté invalide');
  return ctx.db.tx(() => {
    const s = ctx.db.get<any>('SELECT * FROM cash_sessions WHERE id = ?', i.sessionId);
    if (!s) fail('NOT_FOUND', 'Session introuvable');
    if (s.status !== 'OPEN') fail('SESSION_CLOSED', 'Session déjà clôturée');
    if (s.user_id !== ctx.user.id && !ctx.user.permissions.has('cash.view_all')) fail('FORBIDDEN', "Seul le caissier ou un responsable peut clôturer cette session");
    const summary = sessionSummary(ctx, i.sessionId);
    const diff = i.countedCash - summary.expectedCash;
    if (diff !== 0 && !i.note?.trim()) fail('NOTE_REQUIRED', "Un commentaire est obligatoire en cas d'écart de caisse");
    ctx.db.run("UPDATE cash_sessions SET status='CLOSED', closed_at=?, counted_cash=?, expected_cash=?, difference=?, close_note=? WHERE id=?", nowIso(), i.countedCash, summary.expectedCash, diff, i.note ?? null, i.sessionId);
    // l'écart (manque / excédent) corrige le solde du compte espèces : les comptes reflètent ce qui est réellement en caisse
    if (diff !== 0) {
      const accountId = ctx.db.value<string>('SELECT account_id FROM cash_registers WHERE id = ?', s.register_id)!;
      recordFT(ctx, { accountId, kind: 'ADJUSTMENT', amount: diff, refType: 'cash_session', refId: i.sessionId, note: `Écart de caisse${i.note ? ` : ${i.note}` : ''}` });
    }
    outbox(ctx.db, 'cash_session', i.sessionId, 'UPDATE', { closed: true, difference: diff });
    audit(ctx, 'cash.close', 'cash_session', i.sessionId, { expected: summary.expectedCash, counted: i.countedCash, difference: diff });
    return { expectedCash: summary.expectedCash, difference: diff };
  });
}

/** Session ouverte : pour un utilisateur (sa caisse) ou pour une caisse donnée. */
export function currentSession(ctx: Ctx, registerId?: string) {
  const row = registerId
    ? ctx.db.get<any>("SELECT id FROM cash_sessions WHERE register_id = ? AND status = 'OPEN'", registerId)
    : ctx.db.get<any>("SELECT id FROM cash_sessions WHERE user_id = ? AND status = 'OPEN' ORDER BY opened_at DESC LIMIT 1", ctx.user.id);
  return row ? sessionSummary(ctx, row.id) : null;
}

export function listSessions(ctx: Ctx, q: { limit?: number; registerId?: string }) {
  const own = ctx.user.permissions.has('cash.view_all') ? null : ctx.user.id;
  return ctx.db.all(
    `SELECT s.id, s.status, s.opened_at AS openedAt, s.closed_at AS closedAt, s.opening_float AS openingFloat, s.expected_cash AS expectedCash, s.counted_cash AS countedCash, s.difference,
            r.name AS registerName, u.display_name AS userName,
            (SELECT COUNT(*) FROM sales x WHERE x.session_id = s.id) AS salesCount, (SELECT COALESCE(SUM(total),0) FROM sales x WHERE x.session_id = s.id) AS salesTotal
     FROM cash_sessions s JOIN cash_registers r ON r.id = s.register_id JOIN users u ON u.id = s.user_id
     WHERE (? IS NULL OR s.user_id = ?) AND (? IS NULL OR s.register_id = ?) ORDER BY s.opened_at DESC LIMIT ?`, own, own, q.registerId ?? null, q.registerId ?? null, q.limit ?? 100);
}

/** Entrée / sortie d'espèces manuelle dans la caisse ouverte (apport ou prélèvement, jamais une vente). */
export function cashInOut(ctx: Ctx, i: { sessionId: string; direction: 'IN' | 'OUT'; amount: number; note: string }) {
  if (!i.note?.trim()) fail('NOTE_REQUIRED', 'Un motif est obligatoire');
  const s = ctx.db.get<any>("SELECT s.id, r.account_id FROM cash_sessions s JOIN cash_registers r ON r.id = s.register_id WHERE s.id = ? AND s.status = 'OPEN'", i.sessionId);
  if (!s) fail('SESSION_CLOSED', 'Session de caisse non ouverte');
  return ownerMovement(ctx, { accountId: s.account_id, kind: i.direction === 'IN' ? 'CAPITAL_CONTRIBUTION' : 'OWNER_WITHDRAWAL', amount: i.amount, note: i.note });
}
