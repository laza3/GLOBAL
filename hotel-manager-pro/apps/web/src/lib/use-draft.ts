import { useCallback, useEffect, useRef, useState } from 'react';

const TTL_MS = 24 * 3600_000;
interface Stored<T> { savedAt: number; value: T }

/**
 * Brouillon d'un formulaire long : conservé dans ce navigateur (jamais envoyé au serveur) pour survivre à un rechargement, une coupure de
 * connexion ou un onglet fermé par erreur. Expire après 24 h. Ce n'est PAS un mode hors ligne : rien n'est synchronisé en arrière-plan,
 * la saisie est simplement retrouvée.
 */
export function useDraft<T>(key: string, value: T, apply: (restored: T) => void, isEmpty: (v: T) => boolean) {
  const [restored, setRestored] = useState(false);
  const applied = useRef(false);

  // Restauration, une seule fois au montage
  useEffect(() => {
    if (applied.current) return;
    applied.current = true;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const draft = JSON.parse(raw) as Stored<T>;
      if (Date.now() - draft.savedAt > TTL_MS) { localStorage.removeItem(key); return; }
      apply(draft.value);
      setRestored(true);
    } catch { /* brouillon illisible ou stockage bloqué : on repart d'un formulaire vide */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Sauvegarde différée à chaque modification (pas avant la restauration)
  useEffect(() => {
    if (!applied.current) return;
    const id = setTimeout(() => {
      try {
        if (isEmpty(value)) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), value } satisfies Stored<T>));
      } catch { /* quota ou mode privé : le brouillon est un confort, pas une garantie */ }
    }, 400);
    return () => clearTimeout(id);
  }, [key, value, isEmpty]);

  const clear = useCallback(() => { try { localStorage.removeItem(key); } catch { /* sans effet */ } setRestored(false); }, [key]);
  return { restored, clear };
}
