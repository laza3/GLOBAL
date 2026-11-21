import { Link } from 'react-router';
import { PageBackdrop } from '../../auth/screens';
import { useDocumentTitle } from '../../lib/use-title';
import { buttonVariants } from '../../ui/button';

/**
 * Le texte juridique ne s'invente pas : cette page dit simplement qu'il n'est pas encore publié.
 * À REMPLACER par les conditions d'utilisation et la politique de confidentialité validées par un juriste avant toute ouverture commerciale.
 */
export default function TermsPage() {
  useDocumentTitle("Conditions d'utilisation");
  return (
    <PageBackdrop>
      <main id="main" className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-5 p-6">
        <div className="surface glass-1 flex flex-col gap-4 p-8 [--surface-radius:var(--r-card)]">
          <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-ink">Conditions d&apos;utilisation</h1>
          <p className="text-[14px] leading-relaxed text-ink-2">
            Les conditions d&apos;utilisation et la politique de confidentialité de Hotel Manager Pro seront publiées ici avant l&apos;ouverture commerciale du service.
          </p>
          <p className="text-[14px] leading-relaxed text-ink-2">
            En attendant, le service est proposé en version d&apos;évaluation : n&apos;y saisissez pas de données dont vous ne pourriez pas supporter la perte.
          </p>
          <Link to="/inscription" className={buttonVariants({ variant: 'secondary', className: 'self-start' })}>
            Retour à l&apos;inscription
          </Link>
        </div>
      </main>
    </PageBackdrop>
  );
}
