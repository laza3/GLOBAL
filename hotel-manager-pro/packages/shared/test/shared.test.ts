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
