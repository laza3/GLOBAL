import { FlaskConical } from 'lucide-react';
import { useEnvironment } from '../api/meta';

/**
 * Bandeau permanent sur le serveur de TESTS (staging) : les données y sont fictives et ne doivent jamais se mélanger aux données réelles.
 * Rien n'est affiché en production ni en développement local.
 */
export function EnvironmentBanner() {
  const env = useEnvironment();
  if (env.data?.environment !== 'staging') return null;
  return (
    <div role="status" className="flex items-center gap-2 rounded-[14px] bg-[var(--st-pending-soft)] px-4 py-3 text-[14px] text-[var(--st-pending)]">
      <FlaskConical aria-hidden className="size-4 shrink-0" />
      <span><strong className="font-semibold">Environnement de test.</strong> Les données sont fictives : n&apos;y saisissez jamais de vrais clients ni de vraies réservations.</span>
    </div>
  );
}
