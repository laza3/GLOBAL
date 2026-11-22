import { useEffect, useState } from 'react';

/** Valeur qui ne change qu'une fois la frappe terminée (recherche sans requête à chaque touche). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}
