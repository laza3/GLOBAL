import { Link, isRouteErrorResponse, useRouteError } from 'react-router';
import { PageBackdrop } from '../auth/screens';
import { useDocumentTitle } from '../lib/use-title';
import { buttonVariants } from '../ui/button';
import { BrandMark } from '../ui/shell';

function Frame({ title, text }: { title: string; text: string }) {
  return (
    <PageBackdrop>
      <main id="main" className="grid min-h-dvh place-items-center p-6">
        <div className="surface glass-1 flex w-full max-w-md flex-col items-center gap-5 p-8 text-center [--surface-radius:var(--r-card)]">
          <BrandMark />
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[22px] font-semibold text-ink">{title}</h1>
            <p className="text-[14px] leading-snug text-ink-2">{text}</p>
          </div>
          <Link to="/" className={buttonVariants({ variant: 'primary' })}>
            Retour à l&apos;accueil
          </Link>
        </div>
      </main>
    </PageBackdrop>
  );
}

export function NotFoundPage() {
  useDocumentTitle('Page introuvable');
  return <Frame title="Page introuvable" text="Cette adresse n'existe pas ou a changé." />;
}

/** Erreur imprévue d'un écran : message sobre, jamais de pile d'appels. */
export function RouteErrorPage() {
  const error = useRouteError();
  useDocumentTitle('Erreur');
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;
  return <Frame title="Un problème est survenu" text="Cet écran n'a pas pu s'afficher. Rechargez la page ; si le problème continue, contactez l'assistance." />;
}
