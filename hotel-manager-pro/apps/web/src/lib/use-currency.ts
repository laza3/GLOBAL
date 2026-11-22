import { useHotel } from '../api/hotel';

/** Devise de facturation de l'établissement (MGA tant que le profil n'est pas chargé). */
export function useCurrency(): string {
  return useHotel().data?.defaultCurrency ?? 'MGA';
}
