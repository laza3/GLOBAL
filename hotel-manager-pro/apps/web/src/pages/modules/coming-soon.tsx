import { Hourglass } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { MODULE_INFO } from '../../app-modules';
import { buttonVariants } from '../../ui/button';

/**
 * Module pas encore développé : on le dit, on explique ce qu'il fera, et on ne montre AUCUNE fausse donnée.
 * Une seule page pour tous les modules à venir ; chaque module la remplace en arrivant.
 */
export default function ComingSoonPage({ moduleId }: { moduleId?: string }) {
  const params = useParams();
  const id = moduleId ?? params.module ?? '';
  const info = MODULE_INFO[id];
  if (!info) return <NotFoundInline />;
  return (
    <section aria-labelledby="soon-h" className="surface glass-1 flex flex-col items-start gap-6 p-8 [--surface-radius:var(--r-card)]">
      <span aria-hidden className="grid size-12 place-items-center rounded-[14px] bg-champagne-soft text-champagne-ink">
        <Hourglass className="size-6" />
      </span>
      <div className="flex max-w-2xl flex-col gap-2">
        <h1 id="soon-h" className="text-[26px] leading-tight font-semibold tracking-[-0.02em] text-ink">
          {info.title} : bientôt disponible
        </h1>
        <p className="text-[15px] leading-relaxed text-ink-2">{info.summary}</p>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-[14px] font-medium text-ink">Ce que ce module permettra</p>
        <ul className="flex flex-col gap-1.5 text-[14px] text-ink-2">
          {info.scope.map((s) => (
            <li key={s} className="flex gap-2.5">
              <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-champagne" />
              {s}
            </li>
          ))}
        </ul>
      </div>
      <Link to="/overview" className={buttonVariants({ variant: 'secondary' })}>
        Retour à la vue d&apos;ensemble
      </Link>
    </section>
  );
}

function NotFoundInline() {
  return (
    <section className="surface glass-1 p-8 [--surface-radius:var(--r-card)]">
      <h1 className="text-[22px] font-semibold text-ink">Page introuvable</h1>
      <p className="mt-2 text-[14px] text-ink-2">Cette page n&apos;existe pas.</p>
    </section>
  );
}
