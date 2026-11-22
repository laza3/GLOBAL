/** États d'une réservation (et de chacune de ses lignes de chambre) et transitions autorisées. */
export const RESERVATION_STATUSES = ['tentative', 'pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show'] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

/** Une chambre n'est occupée (donc non vendable ailleurs) que dans ces états. */
export const ACTIVE_STATUSES: readonly ReservationStatus[] = ['tentative', 'pending', 'confirmed', 'checked_in'];

const TRANSITIONS: Record<ReservationStatus, readonly ReservationStatus[]> = {
  tentative: ['pending', 'confirmed', 'cancelled'],
  pending: ['confirmed', 'cancelled', 'no_show'],
  confirmed: ['checked_in', 'cancelled', 'no_show'],
  checked_in: ['checked_out'],
  checked_out: [],
  cancelled: [],
  no_show: [],
};

export const canTransition = (from: ReservationStatus, to: ReservationStatus): boolean => TRANSITIONS[from].includes(to);
export const isActiveStatus = (s: string): boolean => (ACTIVE_STATUSES as readonly string[]).includes(s);
