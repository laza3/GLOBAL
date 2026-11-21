import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

/** En-tête de page : un seul titre de niveau 1, une phrase qui dit à quoi sert l'écran, l'action principale à droite. */
export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.02em] text-ink">{title}</h1>
        {description && <p className="max-w-2xl text-[14px] leading-snug text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Bloc de contenu vitré avec titre. Ne jamais en imbriquer deux (règle du verre : pas de flou dans le flou). */
export function Panel({
  title,
  description,
  actions,
  children,
  className,
  id,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  const titleId = id ? `${id}-title` : undefined;
  return (
    <section id={id} aria-labelledby={title ? titleId : undefined} className={cn('surface glass-1 flex min-w-0 flex-col gap-5 p-6 [--surface-radius:var(--r-card)]', className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            {title && (
              <h2 id={titleId} className="text-[17px] font-semibold tracking-[-0.01em] text-ink">
                {title}
              </h2>
            )}
            {description && <p className="max-w-2xl text-[14px] leading-snug text-ink-2">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/** Ligne « libellé : valeur » (listes de définitions). */
export function DefinitionList({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 text-[14px] sm:grid-cols-2">
      {items.map((i) => (
        <div key={i.label} className="flex flex-col gap-0.5">
          <dt className="text-[13px] text-ink-2">{i.label}</dt>
          <dd className="font-medium text-ink">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Message d'information ou d'avertissement dans un écran (jamais la couleur seule : icône + texte). */
export function Callout({ tone = 'info', children }: { tone?: 'info' | 'warning' | 'danger'; children: ReactNode }) {
  const token = tone === 'danger' ? 'cancelled' : tone === 'warning' ? 'pending' : 'confirmed';
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'note'}
      className="rounded-[14px] px-4 py-3 text-[14px] leading-snug text-ink"
      style={{ background: `var(--st-${token}-soft)`, boxShadow: `inset 3px 0 0 var(--st-${token})` }}
    >
      {children}
    </div>
  );
}
