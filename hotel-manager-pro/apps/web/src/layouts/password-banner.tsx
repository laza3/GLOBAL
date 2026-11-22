import { KeyRound } from 'lucide-react';
import { Link } from 'react-router';
import { usePasswordStatus } from '../api/staff';
import { buttonVariants } from '../ui/button';

/** Mot de passe provisoire (compte créé par l'établissement) : rappel visible jusqu'au premier changement. */
export function PasswordBanner() {
  const status = usePasswordStatus();
  if (!status.data?.mustChange) return null;
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] bg-[var(--st-pending-soft)] px-4 py-3 text-[14px] text-[var(--st-pending)]">
      <span className="flex items-center gap-2"><KeyRound aria-hidden className="size-4" />Vous utilisez un mot de passe provisoire. Remplacez-le par un mot de passe personnel.</span>
      <Link to="/settings/account" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>Changer mon mot de passe</Link>
    </div>
  );
}
