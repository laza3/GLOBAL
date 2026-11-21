/**
 * État d'accès d'un établissement : ce qu'il peut faire AUJOURD'HUI, selon son compte et ses droits d'usage.
 *
 *  full       tout est permis
 *  grace      abonnement payant échu depuis peu : tout est permis, avec un bandeau (délai de tolérance)
 *  read_only  consultation et exports seulement ; la facturation SaaS et l'assistance restent accessibles
 *  blocked    compte suspendu ou fermé par la plateforme : plus aucun accès aux données
 *
 * Fonction pure : calculée à partir des dates à chaque requête, donc correcte même si la tâche planifiée de
 * bascule d'état n'a pas encore tourné.
 */
export type AccessState = 'full' | 'grace' | 'read_only' | 'blocked';

export type AccessReason =
  | 'hotel_suspended'
  | 'hotel_closed'
  | 'subscription_required'
  | 'trial_expired'
  | 'subscription_expired'
  | 'grace_period'
  | null;

export interface EntitlementsInput {
  source: 'license' | 'subscription' | 'none';
  is_current: boolean;
  valid_until: Date | null;
  subscription_status: string | null;
}

export interface AccessDecision {
  state: AccessState;
  reason: AccessReason;
  /** Fin de la tolérance (état « grace » uniquement). */
  graceEndsAt: Date | null;
}

const DAY_MS = 86_400_000;

export function computeAccessState(input: {
  hotelStatus: string;
  entitlements: EntitlementsInput;
  now: Date;
  graceDays: number;
}): AccessDecision {
  const { hotelStatus, entitlements: e, now, graceDays } = input;
  if (hotelStatus === 'suspended') return { state: 'blocked', reason: 'hotel_suspended', graceEndsAt: null };
  if (hotelStatus === 'closed') return { state: 'blocked', reason: 'hotel_closed', graceEndsAt: null };

  if (e.source === 'license' || (e.source === 'subscription' && e.is_current)) {
    return { state: 'full', reason: null, graceEndsAt: null };
  }

  if (e.source === 'subscription') {
    // La tolérance ne vaut que pour un abonnement payant : un essai échu passe directement en lecture seule.
    const paid = e.subscription_status === 'active' || e.subscription_status === 'past_due';
    if (paid && e.valid_until) {
      const graceEndsAt = new Date(e.valid_until.getTime() + graceDays * DAY_MS);
      if (now < graceEndsAt) return { state: 'grace', reason: 'grace_period', graceEndsAt };
    }
    return {
      state: 'read_only',
      reason: e.subscription_status === 'trialing' ? 'trial_expired' : 'subscription_expired',
      graceEndsAt: null,
    };
  }

  return { state: 'read_only', reason: 'subscription_required', graceEndsAt: null };
}
