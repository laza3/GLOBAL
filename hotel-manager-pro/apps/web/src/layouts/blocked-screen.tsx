import { LifeBuoy, LogOut, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useLogout } from '../api/hotel';
import { useMe } from '../auth/session';
import { PageBackdrop } from '../auth/screens';
import { SupportPanel } from '../pages/settings/support-panel';
import { Button } from '../ui/button';
import { BrandMark } from '../ui/shell';

const TEXT: Record<string, { title: string; body: string }> = {
  hotel_suspended: {
    title: 'Compte suspendu',
    body: "L'accès à votre établissement a été suspendu par la plateforme. Vos données sont conservées. Contactez l'assistance pour en connaître la raison et rétablir l'accès.",
  },
  hotel_closed: {
    title: 'Compte fermé',
    body: "Cet établissement a été fermé. Vos données sont conservées. Contactez l'assistance si vous pensez qu'il s'agit d'une erreur.",
  },
};

/** Compte suspendu ou fermé : plus d'accès aux données, mais un chemin clair vers l'assistance (qui reste joignable). */
export function BlockedScreen() {
  const me = useMe();
  const navigate = useNavigate();
  const logout = useLogout();
  const [support, setSupport] = useState(false);
  const text = TEXT[me.access.reason ?? 'hotel_suspended'] ?? TEXT.hotel_suspended!;
  return (
    <PageBackdrop>
      <main id="main" className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col justify-center gap-4 p-6">
        <div className="surface glass-3 flex w-full flex-col items-center gap-6 self-center p-8 text-center [--surface-radius:var(--r-hero)] sm:max-w-lg">
          <BrandMark />
          <span aria-hidden className="grid size-14 place-items-center rounded-full bg-[var(--st-cancelled-soft)] text-[var(--st-cancelled)]">
            <ShieldAlert className="size-7" />
          </span>
          <div className="flex flex-col gap-2">
            <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-ink">{text.title}</h1>
            <p className="text-[14px] leading-relaxed text-ink-2">
              {me.hotel.name} — {text.body}
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            <Button variant="primary" onClick={() => setSupport(true)} aria-expanded={support}>
              <LifeBuoy aria-hidden className="size-4" />
              Contacter l&apos;assistance
            </Button>
            <Button
              variant="secondary"
              loading={logout.isPending}
              onClick={() => logout.mutate(undefined, { onSettled: () => navigate('/connexion', { replace: true }) })}
            >
              <LogOut aria-hidden className="size-4" />
              Se déconnecter
            </Button>
          </div>
        </div>
        {support && <SupportPanel />}
      </main>
    </PageBackdrop>
  );
}
