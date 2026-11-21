import { useEffect } from 'react';

/** Titre de l'onglet = page courante : utile pour s'y retrouver, et annoncé par les lecteurs d'écran à chaque navigation. */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = `${title} — Hotel Manager Pro`;
  }, [title]);
}
