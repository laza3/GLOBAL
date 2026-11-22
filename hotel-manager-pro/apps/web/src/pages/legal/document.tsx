import { LEGAL_VERSION } from '@hmp/shared';
import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useLegal } from '../../api/hotel';
import { PageBackdrop } from '../../auth/screens';
import { formatDate } from '../../lib/format';
import { useDocumentTitle } from '../../lib/use-title';
import { buttonVariants } from '../../ui/button';
import { BrandMark } from '../../ui/shell';

export type Block = string | { list: string[] };
export interface Section { id: string; title: string; body: Block[] }

/** Coordonnées de l'éditeur : elles viennent du réglage « Société » de la console (jamais écrites en dur dans le texte). */
export function PublisherBlock() {
  const { data } = useLegal();
  const c = data?.company;
  if (!c) return <>l&apos;éditeur du service Hotel Manager Pro, dont les coordonnées figurent sur chaque facture émise à votre établissement</>;
  const lines = [c.name, c.legalForm, c.address, c.taxId && `NIF / STAT : ${c.taxId}`, c.email, c.phone].filter(Boolean);
  return <>{lines.join(' — ')}</>;
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) =>
        typeof b === 'string' ? (
          <p key={i} className="text-[15px] leading-relaxed text-ink-2">{b}</p>
        ) : (
          <ul key={i} className="flex flex-col gap-1.5 pl-5 text-[15px] leading-relaxed text-ink-2 [&>li]:list-disc [&>li]:marker:text-champagne">
            {b.list.map((item) => <li key={item}>{item}</li>)}
          </ul>
        ),
      )}
    </>
  );
}

/** Document juridique : sommaire, sections numérotées (c'est un texte de référence où l'on cite « l'article 4 »), date de version. */
export function LegalDocument({ title, intro, sections, other }: { title: string; intro: ReactNode; sections: Section[]; other: { to: string; label: string } }) {
  useDocumentTitle(title);
  return (
    <PageBackdrop>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 lg:grid lg:grid-cols-[15rem_1fr] lg:gap-12">
        <aside className="flex flex-col gap-6 lg:sticky lg:top-8 lg:self-start">
          <BrandMark />
          <nav aria-label="Sommaire" className="hidden flex-col gap-1 lg:flex">
            {sections.map((s, i) => (
              <a key={s.id} href={`#${s.id}`} className="rounded-[10px] px-3 py-1.5 text-[13.5px] leading-snug text-ink-2 hover:bg-glass-hover hover:text-ink">
                {i + 1}. {s.title}
              </a>
            ))}
          </nav>
        </aside>
        <main id="main" className="flex min-w-0 flex-col gap-8">
          <div className="surface glass-1 flex flex-col gap-3 p-8 [--surface-radius:var(--r-card)]">
            <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em] text-ink">{title}</h1>
            <p className="text-[13px] text-ink-3">Version du {formatDate(`${LEGAL_VERSION}T12:00:00Z`, { long: true })}</p>
            <p className="text-[15px] leading-relaxed text-ink-2">{intro}</p>
          </div>
          {sections.map((s, i) => (
            <Fragment key={s.id}>
              <section id={s.id} aria-labelledby={`${s.id}-h`} className="flex scroll-mt-8 flex-col gap-3 px-1">
                <h2 id={`${s.id}-h`} className="text-[19px] font-semibold tracking-[-0.01em] text-ink">
                  {i + 1}. {s.title}
                </h2>
                <Blocks blocks={s.body} />
              </section>
            </Fragment>
          ))}
          <div className="flex flex-wrap gap-3 border-t border-hairline pt-6">
            <Link to={other.to} className={buttonVariants({ variant: 'secondary' })}>{other.label}</Link>
            <Link to="/inscription" className={buttonVariants({ variant: 'ghost' })}>Retour à l&apos;inscription</Link>
          </div>
        </main>
      </div>
    </PageBackdrop>
  );
}
