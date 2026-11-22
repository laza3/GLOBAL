export const PAYMENT_STATUS_LABEL = { no_charges: 'Aucune charge', unpaid: 'Impayée', partially_paid: 'Partiellement payée', paid: 'Soldée' } as const;
export const PAYMENT_STATUS_TONE = { no_charges: 'neutral', unpaid: 'danger', partially_paid: 'warning', paid: 'success' } as const;
export const CHARGE_KIND: Record<string, string> = { room: 'Hébergement', restaurant: 'Restaurant', service: 'Service', fee: 'Frais', discount: 'Remise', adjustment: 'Ajustement' };
export const PAYMENT_KIND: Record<string, string> = { deposit: 'Acompte', payment: 'Paiement', refund: 'Remboursement' };
export const CURRENCY_OPTIONS = [{ value: 'MGA', label: 'Ariary (MGA)' }, { value: 'EUR', label: 'Euro (EUR)' }, { value: 'USD', label: 'Dollar (USD)' }];
