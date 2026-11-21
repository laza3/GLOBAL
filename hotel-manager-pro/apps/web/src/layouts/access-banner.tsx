import { Clock3, Lock, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router';
import { useCan, useMe } from '../auth/session';
import { daysLabel, daysUntil, formatDate } from '../lib/format';
import { buttonVariants } from '../ui/button';

const READ_ONLY_TEXT: Record<string, string> = {
  trial_expired: 'Votre essai gratuit est terminé. Vos données sont conservées et consultables ; choisissez une formule pour reprendre la saisie.',
  subscription_expired: 'Votre abonnement a expiré. Vos données sont conservées et consultables ; réglez votre abonnement pour reprendre la saisie.',
  subscription_required: 'Aucun abonnement n\'est en cours. Vos données sont conservées et consultables ; choisissez une formule pour reprendre la saisie.',
};

/**
 * Bandeau d'état de l'abonnement, sous la barre supérieure : dit CE qui se passe, jusqu'à QUAND, et QUOI faire.
 * (essai bientôt terminé · tolérance après échéance · lecture seule). Le compte suspendu a son propre écran.
 */
export function AccessBanner() {
  const me = useMe();
  const can = useCan();
  const canManage = can('subscription:manage');
  const { access, entitlements } = me;

  let tone: 'info' | 'warning' | 'danger' | null = null;
  let message = '';
  let action: { to: string; label: string } | null = null;

  if (access.state === 'grace') {
    tone = 'warning';
    message = `Votre abonnement est échu. Tout reste disponible jusqu'au ${formatDate(access.graceEndsAt, { long: true })} ; ensuite l'application passera en lecture seule.`;
    action = { to: '/settings/invoices', label: 'Régler ma facture' };
  } else if (access.state === 'read_only') {
    tone = 'danger';
    message = READ_ONLY_TEXT[access.reason ?? 'subscription_required'] ?? READ_ONLY_TEXT.subscription_required!;
    action = { to: '/settings/subscription', label: 'Choisir une formule' };
  } else if (entitlements.subscriptionStatus === 'trialing' && entitlements.source === 'subscription') {
    const left = daysUntil(entitlements.validUntil);
    if (left !== null && left <= 5 && left >= 0) {
      tone = 'info';
      message = `Votre essai gratuit se termine ${left === 0 ? "aujourd'hui" : `dans ${daysLabel(left)}`}. Choisissez une formule pour continuer sans interruption.`;
      action = { to: '/settings/subscription', label: 'Choisir une formule' };
    }
  }
  if (!tone) return null;

  const Icon = tone === 'danger' ? Lock : tone === 'warning' ? TriangleAlert : Clock3;
  const color = tone === 'danger' ? 'var(--st-cancelled)' : tone === 'warning' ? 'var(--st-pending)' : 'var(--st-confirmed)';
  const soft = tone === 'danger' ? 'var(--st-cancelled-soft)' : tone === 'warning' ? 'var(--st-pending-soft)' : 'var(--st-confirmed-soft)';

  return (
    <div role="status" className="surface glass-1 flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 [--surface-radius:var(--r-card-sm)]">
      <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full" style={{ background: soft, color }}>
        <Icon className="size-[18px]" />
      </span>
      <p className="min-w-0 flex-1 basis-64 text-[14px] leading-snug text-ink">{message}</p>
      {action &&
        (canManage ? (
          <Link to={action.to} className={buttonVariants({ variant: 'primary' })}>
            {action.label}
          </Link>
        ) : (
          <p className="text-[13px] text-ink-2">Seul le propriétaire ou un gestionnaire d&apos;abonnement peut le faire.</p>
        ))}
    </div>
  );
}
