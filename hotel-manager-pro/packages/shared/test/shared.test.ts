import { describe, expect, it } from 'vitest';
import { ERRORS, PERMISSIONS, SYSTEM_ROLES, computeAccessState, hasPermission, isPermission } from '../src';

describe('catalogue de permissions et rôles', () => {
  it('toutes les permissions respectent le format de la base (ressource:action)', () => {
    for (const p of PERMISSIONS) expect(p).toMatch(/^[a-z_]+:[a-z_]+$/);
  });

  it('aucun doublon dans le catalogue ni dans un rôle', () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
    for (const r of SYSTEM_ROLES) expect(new Set(r.permissions).size, r.key).toBe(r.permissions.length);
  });

  it('chaque permission d\'un rôle existe dans le catalogue', () => {
    for (const r of SYSTEM_ROLES) for (const p of r.permissions) expect(isPermission(p), `${r.key} : ${p}`).toBe(true);
  });

  it('le propriétaire a tout ; l\'administrateur a tout sauf la gestion de l\'abonnement', () => {
    const owner = SYSTEM_ROLES.find((r) => r.key === 'owner')!;
    const admin = SYSTEM_ROLES.find((r) => r.key === 'admin')!;
    expect(owner.permissions).toHaveLength(PERMISSIONS.length);
    expect(PERMISSIONS.filter((p) => !admin.permissions.includes(p))).toEqual(['subscription:manage']);
  });

  it('moindre privilège : un employé de ménage ne voit ni les clients, ni les finances, ni l\'abonnement', () => {
    const staff = SYSTEM_ROLES.find((r) => r.key === 'hk_staff')!;
    for (const forbidden of ['guests:read', 'finances:read', 'billing:read', 'payments:record', 'subscription:read', 'staff:manage'] as const) {
      expect(hasPermission(staff.permissions, forbidden), forbidden).toBe(false);
    }
    expect(hasPermission(staff.permissions, 'housekeeping:update_task')).toBe(true);
  });

  it('séparation des tâches : seuls propriétaire et administrateur lisent les pièces d\'identité et gèrent le personnel', () => {
    for (const perm of ['guests:read_id_document', 'staff:manage', 'settings:manage'] as const) {
      const holders = SYSTEM_ROLES.filter((r) => r.permissions.includes(perm)).map((r) => r.key);
      expect(holders, perm).toEqual(['owner', 'admin']);
    }
  });

  it('le réceptionniste n\'accède ni aux finances, ni aux rapports, ni à l\'abonnement', () => {
    const r = SYSTEM_ROLES.find((x) => x.key === 'receptionist')!;
    for (const forbidden of ['finances:read', 'reports:read', 'subscription:manage', 'payments:refund', 'billing:void'] as const) {
      expect(hasPermission(r.permissions, forbidden), forbidden).toBe(false);
    }
    expect(hasPermission(r.permissions, 'reception:checkin')).toBe(true);
  });

  it('les clés de rôle sont uniques et conformes au format de la base', () => {
    expect(new Set(SYSTEM_ROLES.map((r) => r.key)).size).toBe(SYSTEM_ROLES.length);
    for (const r of SYSTEM_ROLES) expect(r.key).toMatch(/^[a-z0-9_]{2,40}$/);
  });
});

describe('état d\'accès', () => {
  const now = new Date('2026-12-01T10:00:00Z');
  const day = 86_400_000;
  const sub = (status: string, validUntil: Date, isCurrent: boolean) => ({
    source: 'subscription' as const, is_current: isCurrent, valid_until: validUntil, subscription_status: status,
  });
  const decide = (hotelStatus: string, entitlements: Parameters<typeof computeAccessState>[0]['entitlements'], graceDays = 7) =>
    computeAccessState({ hotelStatus, entitlements, now, graceDays });

  it('un compte suspendu ou fermé est bloqué, quels que soient ses droits', () => {
    const valid = sub('active', new Date(now.getTime() + 30 * day), true);
    expect(decide('suspended', valid)).toMatchObject({ state: 'blocked', reason: 'hotel_suspended' });
    expect(decide('closed', valid)).toMatchObject({ state: 'blocked', reason: 'hotel_closed' });
  });

  it('abonnement ou essai en cours, licence perpétuelle : accès complet', () => {
    expect(decide('active', sub('trialing', new Date(now.getTime() + day), true)).state).toBe('full');
    expect(decide('active', sub('active', new Date(now.getTime() + 20 * day), true)).state).toBe('full');
    expect(decide('active', { source: 'license', is_current: true, valid_until: null, subscription_status: null }).state).toBe('full');
  });

  it('abonnement payant échu : tolérance de 7 jours, puis lecture seule', () => {
    const expired = new Date(now.getTime() - 3 * day);
    const inGrace = decide('active', sub('active', expired, false));
    expect(inGrace).toMatchObject({ state: 'grace', reason: 'grace_period' });
    expect(inGrace.graceEndsAt!.getTime()).toBe(expired.getTime() + 7 * day);
    expect(decide('active', sub('past_due', expired, false)).state).toBe('grace');
    expect(decide('active', sub('active', new Date(now.getTime() - 8 * day), false))).toMatchObject({ state: 'read_only', reason: 'subscription_expired' });
  });

  it('un essai échu n\'a PAS de tolérance : lecture seule immédiate', () => {
    expect(decide('active', sub('trialing', new Date(now.getTime() - day), false))).toMatchObject({ state: 'read_only', reason: 'trial_expired' });
  });

  it('sans abonnement ni licence : lecture seule, avec le motif « abonnement requis »', () => {
    expect(decide('onboarding', { source: 'none', is_current: false, valid_until: null, subscription_status: null })).toMatchObject({ state: 'read_only', reason: 'subscription_required' });
  });

  it('la durée de tolérance est configurable (0 jour = pas de tolérance)', () => {
    expect(decide('active', sub('active', new Date(now.getTime() - day), false), 0).state).toBe('read_only');
  });
});

describe('messages d\'erreur', () => {
  it('chaque erreur a un statut HTTP valide et un message en français non vide', () => {
    for (const [code, spec] of Object.entries(ERRORS)) {
      expect(spec.status, code).toBeGreaterThanOrEqual(400);
      expect(spec.status, code).toBeLessThan(600);
      expect(spec.message.length, code).toBeGreaterThan(10);
    }
  });

  it('un message d\'erreur n\'expose jamais de détail technique', () => {
    for (const [code, spec] of Object.entries(ERRORS)) {
      expect(spec.message, code).not.toMatch(/sql|postgres|stack|exception|undefined|null/i);
    }
  });
});

import { CURRENCIES, currencyDigits, formatMoney, fromMinorUnits, toMinorUnits } from '../src/money';

describe('montants', () => {
  it('l\'ariary n\'a pas de sous-unité ; l\'euro et le dollar ont des centimes', () => {
    expect(currencyDigits('MGA')).toBe(0);
    expect(currencyDigits('EUR')).toBe(2);
    expect(currencyDigits('USD')).toBe(2);
    expect(currencyDigits('XXX')).toBe(0);
    expect(Object.keys(CURRENCIES)).toEqual(['MGA', 'EUR', 'USD']);
  });

  it('formate avec les espaces insécables français et le bon symbole', () => {
    expect(formatMoney(80000, 'MGA')).toBe('80 000 Ar');
    expect(formatMoney(1250, 'EUR')).toBe('12,50 €');
    expect(formatMoney(0, 'USD')).toBe('0,00 $');
    expect(formatMoney(-5000, 'MGA')).toBe('-5 000 Ar');
    expect(formatMoney(5, 'XXX')).toBe('5 XXX');
  });

  it('convertit la saisie en unités entières sans erreur d\'arrondi', () => {
    expect(toMinorUnits(12.5, 'EUR')).toBe(1250);
    expect(toMinorUnits(0.1 + 0.2, 'EUR')).toBe(30);
    expect(toMinorUnits(19.99, 'EUR')).toBe(1999);
    expect(toMinorUnits(80000, 'MGA')).toBe(80000);
    expect(fromMinorUnits(1999, 'EUR')).toBe(19.99);
  });
});

import { isStrongPassword, passwordProblem } from '../src/password';

describe('politique de mot de passe', () => {
  it('accepte un mot de passe solide et refuse les cas faibles avec le bon message', () => {
    expect(isStrongPassword('Mot-de-passe-solide-42')).toBe(true);
    expect(passwordProblem('Mot-de-passe-solide-42')).toBeNull();
    expect(passwordProblem('court1')).toMatch(/10 caractères/);
    expect(passwordProblem('uniquementdeslettres')).toMatch(/lettre et un chiffre/);
    expect(passwordProblem('1234567890123')).toMatch(/lettre et un chiffre/);
    expect(passwordProblem('motdepasse1')).toMatch(/trop courant/); // 11 caractères, mais dans la liste des mots de passe courants
    expect(passwordProblem('hotelmanager1')).toMatch(/trop courant/);
    expect(passwordProblem('Aina.Rakoto2026', 'aina.rakoto2026')).toMatch(/identique à votre e-mail/);
    expect(passwordProblem('x'.repeat(129) + '1')).toMatch(/trop long/);
  });
});

import { addDays, eachNight, isDateString, isWeekendNight, nightsBetween, overlaps, todayIn, weekday } from '../src/dates';
import { periodFor, priceNight, quoteStay, type RatePeriod } from '../src/pricing';

describe('dates calendaires', () => {
  it('valide les dates réelles et refuse les autres', () => {
    expect(isDateString('2026-11-22')).toBe(true);
    expect(isDateString('2024-02-29')).toBe(true);
    expect(isDateString('2026-02-29')).toBe(false);
    expect(isDateString('2026-13-01')).toBe(false);
    expect(isDateString('22/11/2026')).toBe(false);
    expect(() => addDays('pas-une-date', 1)).toThrow(RangeError);
  });
  it('calcule les nuits : arrivée incluse, départ exclu', () => {
    expect(nightsBetween('2026-11-21', '2026-11-24')).toBe(3);
    expect(eachNight('2026-12-30', '2027-01-02')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01']);
    expect(eachNight('2026-11-21', '2026-11-21')).toEqual([]);
    expect(nightsBetween('2026-11-24', '2026-11-21')).toBe(-3);
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('« départ le 21 » et « arrivée le 21 » ne se chevauchent pas', () => {
    expect(overlaps('2026-11-18', '2026-11-21', '2026-11-21', '2026-11-23')).toBe(false);
    expect(overlaps('2026-11-18', '2026-11-22', '2026-11-21', '2026-11-23')).toBe(true);
  });
  it('week-end = nuits du vendredi et du samedi', () => {
    expect(weekday('2026-11-22')).toBe(0); // dimanche
    expect(isWeekendNight('2026-11-20')).toBe(true); // vendredi
    expect(isWeekendNight('2026-11-21')).toBe(true); // samedi
    expect(isWeekendNight('2026-11-22')).toBe(false);
  });
  it('« aujourd\'hui » dépend du fuseau : à Madagascar il est déjà demain à 22 h UTC', () => {
    const now = new Date('2026-11-21T22:30:00Z');
    expect(todayIn('Indian/Antananarivo', now)).toBe('2026-11-22');
    expect(todayIn('UTC', now)).toBe('2026-11-21');
  });
});

describe('tarification', () => {
  const season = (over: Partial<RatePeriod>): RatePeriod => ({ startsOn: '2026-12-01', endsOn: '2026-12-31', nightlyRate: 200000, weekendRate: null, minStay: 1, priority: 0, ...over });

  it('tarif de base hors saison ; la saison l\'emporte ; le tarif de la chambre l\'emporte sur tout', () => {
    const periods = [season({ name: 'Fêtes' })];
    expect(priceNight('2026-11-15', { periods, baseRate: 100000 })).toMatchObject({ rate: 100000, source: 'base' });
    expect(priceNight('2026-12-10', { periods, baseRate: 100000 })).toMatchObject({ rate: 200000, source: 'season', periodName: 'Fêtes' });
    expect(priceNight('2026-12-10', { periods, baseRate: 100000, roomRate: 150000 })).toMatchObject({ rate: 150000, source: 'room' });
    expect(priceNight('2026-12-10', { periods, baseRate: 100000, roomRate: 0 })).toMatchObject({ rate: 0, source: 'room' }); // 0 = gratuité explicite, pas « absent »
  });
  it('la date de fin de la période est incluse', () => {
    const periods = [season({})];
    expect(priceNight('2026-12-31', { periods, baseRate: 1 }).source).toBe('season');
    expect(priceNight('2027-01-01', { periods, baseRate: 1 }).source).toBe('base');
    expect(priceNight('2026-11-30', { periods, baseRate: 1 }).source).toBe('base');
  });
  it('tarif de week-end le vendredi et le samedi seulement', () => {
    const periods = [season({ weekendRate: 260000 })];
    expect(priceNight('2026-12-04', { periods, baseRate: 1 }).rate).toBe(260000); // vendredi
    expect(priceNight('2026-12-05', { periods, baseRate: 1 }).rate).toBe(260000); // samedi
    expect(priceNight('2026-12-06', { periods, baseRate: 1 }).rate).toBe(200000); // dimanche
  });
  it('chevauchement : priorité la plus haute, puis la période la plus courte, puis la plus récente ; les inactives sont ignorées', () => {
    const large = season({ name: 'Haute saison', nightlyRate: 200000 });
    const court = season({ name: 'Noël', startsOn: '2026-12-24', endsOn: '2026-12-26', nightlyRate: 300000 });
    expect(periodFor('2026-12-25', [large, court])?.name).toBe('Noël');
    expect(periodFor('2026-12-25', [large, { ...court, priority: -1 }])?.name).toBe('Haute saison'); // la priorité d'abord
    expect(periodFor('2026-12-25', [large, { ...court, isActive: false }])?.name).toBe('Haute saison');
    expect(periodFor('2026-12-25', [])).toBeNull();
  });
  it('devis d\'un séjour : somme nuit par nuit à cheval sur deux tarifs, séjour minimal de la nuit d\'arrivée', () => {
    const periods = [season({ minStay: 3 })];
    const q = quoteStay('2026-11-30', '2026-12-03', { periods, baseRate: 100000 });
    expect(q.nights.map((n) => n.rate)).toEqual([100000, 200000, 200000]);
    expect(q.subtotal).toBe(500000);
    expect(q.minStay).toBe(1); // la nuit d'arrivée (30/11) est hors période
    const q2 = quoteStay('2026-12-10', '2026-12-12', { periods, baseRate: 100000 });
    expect(q2).toMatchObject({ minStay: 3, minStayRespected: false, subtotal: 400000 });
    expect(quoteStay('2026-12-10', '2026-12-13', { periods, baseRate: 100000 }).minStayRespected).toBe(true);
  });
});

import { normalizePhone } from '../src/phone';

describe('téléphone normalisé', () => {
  it('rapproche les écritures d\'un même numéro malgache', () => {
    const same = ['034 00 000 00', '+261 34 00 000 00', '00261 34 00 000 00', '(0)34-00-000-00'.replace('(0)', '0'), '261340000000'];
    for (const s of same) expect(normalizePhone(s), s).toBe('261340000000');
  });
  it('respecte l\'indicatif d\'un numéro international et refuse les saisies sans numéro', () => {
    expect(normalizePhone('+33 6 12 34 56 78')).toBe('33612345678');
    expect(normalizePhone('0033 6 12 34 56 78')).toBe('33612345678');
    expect(normalizePhone('0612345678', '33')).toBe('33612345678');
    expect(normalizePhone('abc')).toBeNull();
    expect(normalizePhone('12 34')).toBeNull();
    expect(normalizePhone('1'.repeat(20))).toBeNull();
  });
});

import { computeTotals, type TaxRule } from '../src/taxes';
import { canTransition, isActiveStatus } from '../src/reservations';

describe('totaux d\'un séjour et taxes', () => {
  const vat = (inclusive: boolean, bps = 2000): TaxRule => ({ id: 'vat', name: 'TVA', kind: 'percentage', rateBps: bps, inclusive });
  const stay: TaxRule = { id: 'stay', name: 'Taxe de séjour', kind: 'fixed_per_person_night', fixedAmount: 1000, inclusive: false };
  const rates = [100000, 100000, 100000];
  it('sans taxe : total = somme des nuits − remise', () => {
    expect(computeTotals({ rates, discount: 0, personNights: 6, rules: [] })).toEqual({ subtotal: 300000, discount: 0, tax: 0, total: 300000, taxes: [] });
    expect(computeTotals({ rates, discount: 50000, personNights: 6, rules: [] })).toMatchObject({ subtotal: 300000, discount: 50000, total: 250000 });
    expect(computeTotals({ rates, discount: 9_999_999, personNights: 6, rules: [] })).toMatchObject({ discount: 300000, total: 0 }); // jamais plus que le tarif
    expect(computeTotals({ rates: [], discount: 5, personNights: 0, rules: [] }).total).toBe(0);
  });

  it('taxe en pourcentage AJOUTÉE : calculée sur le hors taxe après remise', () => {
    const t = computeTotals({ rates, discount: 60000, personNights: 6, rules: [vat(false)] });
    expect(t).toMatchObject({ subtotal: 300000, discount: 60000, tax: 48000, total: 288000 });
    expect(t.taxes).toEqual([{ ruleId: 'vat', name: 'TVA', amount: 48000, inclusive: false }]);
    expect(t.total).toBe(t.subtotal - t.discount + t.tax);
  });

  it('taxe INCLUSE (tarif TTC) : le total ne change pas, la taxe en est extraite ; la remise suit le TTC', () => {
    const t = computeTotals({ rates, discount: 0, personNights: 6, rules: [vat(true)] });
    expect(t.total).toBe(300000); // le client paie le tarif affiché
    expect(t.subtotal).toBe(250000);
    expect(t.tax).toBe(50000);
    expect(t.subtotal - t.discount + t.tax).toBe(t.total);
    const d = computeTotals({ rates, discount: 30000, personNights: 6, rules: [vat(true)] });
    expect(d.total).toBe(270000);
    expect(d.subtotal - d.discount + d.tax).toBe(d.total);
    expect(d.tax).toBe(45000);
  });

  it('taxe de séjour fixe : par personne et par nuit, jamais remisée ; cumulée avec une TVA', () => {
    const t = computeTotals({ rates, discount: 30000, personNights: 6, rules: [vat(false), stay] });
    expect(t.taxes.map((x) => [x.name, x.amount])).toEqual([['TVA', 54000], ['Taxe de séjour', 6000]]);
    expect(t.total).toBe(270000 + 54000 + 6000);
    expect(t.subtotal - t.discount + t.tax).toBe(t.total);
  });

  it('plusieurs taxes incluses : répartition exacte au prorata, sans centime perdu', () => {
    const rules: TaxRule[] = [vat(true, 1000), { ...vat(true, 500), id: 'tourism', name: 'Taxe tourisme' }];
    for (const r of [[33333], [100001, 99999], [7, 11, 13]]) {
      const t = computeTotals({ rates: r, discount: 0, personNights: 0, rules });
      expect(t.subtotal - t.discount + t.tax, `${r}`).toBe(t.total);
      expect(t.total).toBe(r.reduce((a, b) => a + b, 0));
      expect(t.taxes.reduce((s, x) => s + x.amount, 0)).toBe(t.tax);
    }
  });

  it('l\'identité total = hors taxe − remise + taxes tient pour des milliers de combinaisons', () => {
    let seed = 42;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    for (let i = 0; i < 2000; i++) {
      const r = Array.from({ length: 1 + rnd(6) }, () => rnd(500000));
      const rules: TaxRule[] = [];
      if (rnd(2)) rules.push(vat(rnd(2) === 0, 1 + rnd(3000)));
      if (rnd(3) === 0) rules.push({ ...vat(rnd(2) === 0, 1 + rnd(1500)), id: 'b', name: 'B' });
      if (rnd(2)) rules.push(stay);
      const t = computeTotals({ rates: r, discount: rnd(300000), personNights: rnd(20), rules });
      expect(t.subtotal - t.discount + t.tax, JSON.stringify({ r, rules })).toBe(t.total);
      expect(t.discount).toBeLessThanOrEqual(t.subtotal);
      expect(t.total).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('transitions de réservation', () => {
  it('suit le cycle de vie réel et interdit les retours en arrière', () => {
    expect(canTransition('tentative', 'confirmed')).toBe(true);
    expect(canTransition('confirmed', 'checked_in')).toBe(true);
    expect(canTransition('checked_in', 'checked_out')).toBe(true);
    expect(canTransition('checked_in', 'cancelled')).toBe(false); // un client présent ne s'« annule » pas
    expect(canTransition('checked_out', 'confirmed')).toBe(false);
    expect(canTransition('cancelled', 'confirmed')).toBe(false);
    expect(canTransition('confirmed', 'no_show')).toBe(true);
    expect(isActiveStatus('confirmed')).toBe(true);
    expect(isActiveStatus('cancelled')).toBe(false);
    expect(isActiveStatus('checked_out')).toBe(false);
  });
});

import { spreadDiscount } from '../src/taxes';

describe('répartition d\'une remise sur les nuits', () => {
  it('prorata, somme exacte, jamais plus que le tarif d\'une nuit', () => {
    expect(spreadDiscount([100000, 100000, 100000], 30000)).toEqual([10000, 10000, 10000]);
    expect(spreadDiscount([100, 100, 100], 100)).toEqual([34, 33, 33]); // le plus fort reste d'abord, à égalité la première nuit
    expect(spreadDiscount([100000, 300000], 40000)).toEqual([10000, 30000]);
    expect(spreadDiscount([100, 200], 9999)).toEqual([100, 200]); // plafonnée au tarif
    expect(spreadDiscount([100, 200], 0)).toEqual([0, 0]);
    expect(spreadDiscount([], 50)).toEqual([]);
    expect(spreadDiscount([0, 0], 50)).toEqual([0, 0]);
  });
  it('la somme est toujours exacte (propriété sur des milliers de cas)', () => {
    let seed = 7;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    for (let i = 0; i < 3000; i++) {
      const rates = Array.from({ length: 1 + rnd(8) }, () => rnd(400000));
      const d = rnd(1_500_000);
      const out = spreadDiscount(rates, d);
      expect(out.reduce((a, b) => a + b, 0), JSON.stringify({ rates, d })).toBe(Math.min(d, rates.reduce((a, b) => a + b, 0)));
      out.forEach((x, k) => { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(rates[k]!); });
    }
  });
});
