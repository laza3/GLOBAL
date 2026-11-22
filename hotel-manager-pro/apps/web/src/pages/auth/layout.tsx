import { ShieldCheck, WalletCards, Globe2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { PageBackdrop } from '../../auth/screens';
import { ThemeToggle } from '../../ui/theme';
import { BrandMark } from '../../ui/shell';

const POINTS = [
  { icon: WalletCards, title: 'Essai gratuit, sans carte bancaire', text: 'Aucune information de paiement n\'est demandée pour commencer.' },
  { icon: ShieldCheck, title: 'Vos données vous appartiennent', text: 'Chaque établissement est isolé des autres, au niveau de la base de données.' },
  { icon: Globe2, title: 'Pensé pour Madagascar', text: 'Ariary, euro et dollar ; fuseau horaire d\'Antananarivo ; Mobile Money.' },
];

/** Cadre commun des pages d'accès : le formulaire d'abord (mobile), un court rappel de ce qu'on obtient à côté (bureau). */
export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer: ReactNode }) {
  return (
    <PageBackdrop>
      <div className="mx-auto grid min-h-dvh w-full max-w-6xl items-center gap-10 px-4 py-8 lg:grid-cols-[1fr_30rem] lg:px-8">
        <aside className="order-2 hidden flex-col gap-10 lg:order-1 lg:flex">
          <BrandMark />
          <div className="flex max-w-md flex-col gap-3">
            <p className="text-balance text-[34px] leading-[1.1] font-semibold tracking-[-0.03em] text-ink">
              Gérez votre hôtel, de l&apos;arrivée du client à la facture.
            </p>
            <p className="text-[15px] leading-relaxed text-ink-2">Un seul outil pour votre équipe, sur ordinateur comme sur téléphone.</p>
          </div>
          <ul className="flex max-w-md flex-col gap-5">
            {POINTS.map((p) => {
              const Icon = p.icon;
              return (
                <li key={p.title} className="flex gap-4">
                  <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-champagne-soft text-champagne-ink">
                    <Icon className="size-5" />
                  </span>
                  <div className="flex flex-col gap-0.5">
                    <p className="text-[15px] font-medium text-ink">{p.title}</p>
                    <p className="text-[14px] leading-snug text-ink-2">{p.text}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </aside>

        <main id="main" className="order-1 flex flex-col gap-6 lg:order-2">
          <div className="flex items-center justify-between lg:hidden">
            <BrandMark />
          </div>
          <div className="surface glass-3 flex flex-col gap-6 p-6 sm:p-8 [--surface-radius:var(--r-hero)]">
            <header className="flex flex-col gap-1.5">
              <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.02em] text-ink">{title}</h1>
              <p className="text-[14px] leading-snug text-ink-2">{subtitle}</p>
            </header>
            {children}
          </div>
          <div className="flex flex-col items-center gap-4 text-center text-[14px] text-ink-2">
            {footer}
            <p className="flex gap-4 text-[13px]">
              <Link to="/conditions" className="underline underline-offset-4 hover:text-ink">Conditions d&apos;utilisation</Link>
              <Link to="/confidentialite" className="underline underline-offset-4 hover:text-ink">Confidentialité</Link>
            </p>
            <ThemeToggle />
          </div>
        </main>
      </div>
    </PageBackdrop>
  );
}

export function FormAlert({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded-control border border-[color-mix(in_srgb,var(--danger)_40%,transparent)] bg-[var(--st-cancelled-soft)] px-3.5 py-3 text-[14px] leading-snug text-danger-ink">
      {children}
    </div>
  );
}
