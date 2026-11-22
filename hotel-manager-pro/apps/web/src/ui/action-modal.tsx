import { useState, type ReactNode } from 'react';
import { isApiError } from '../api/client';
import { Button } from './button';
import { Modal } from './overlay';
import { Callout } from './page';

/** Renvoyé par `onSubmit` pour que la fenêtre RESTE ouverte après un succès (ex. afficher une clé montrée une seule fois). */
export const KEEP_OPEN = Symbol('keep-open');

/** Fenêtre d'action : valide, appelle, affiche l'erreur du serveur DANS la fenêtre (qui reste ouverte), ferme au succès. */
export function ActionModal({
  title, description, confirmLabel, children, onSubmit, onClose, width = '34rem',
}: {
  title: string; description?: string; confirmLabel: string; children: ReactNode; width?: string;
  /** Renvoie un message d'erreur de saisie (la fenêtre reste ouverte) ou exécute l'action. */
  onSubmit: () => string | null | Promise<unknown>;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setError(null);
    try {
      const r = onSubmit();
      if (typeof r === 'string') return setError(r);
      if (r === null) return setError('Vérifiez les champs.');
      setBusy(true);
      const result = await r;
      if (result !== KEEP_OPEN) onClose();
    } catch (e) {
      setError(isApiError(e) ? e.message : "L'action a échoué. Réessayez.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description={description}
      width={width}
      footer={<><Button variant="secondary" onClick={onClose}>Annuler</Button><Button variant="primary" loading={busy} onClick={() => void submit()}>{confirmLabel}</Button></>}
    >
      <div className="flex flex-col gap-5">
        {children}
        {error && <Callout tone="danger">{error}</Callout>}
      </div>
    </Modal>
  );
}

