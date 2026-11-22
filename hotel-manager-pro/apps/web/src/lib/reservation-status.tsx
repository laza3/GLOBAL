import { Hourglass } from 'lucide-react';
import type { ReservationStatus } from '../api/reservations';
import { Badge, StatusBadge, type ReservationStatus as UiStatus } from '../ui/data';

/** Le serveur dit « checked_in », l'interface « en séjour » : une seule table de correspondance pour toute l'application. */
const UI: Record<Exclude<ReservationStatus, 'tentative'>, UiStatus> = {
  pending: 'pending', confirmed: 'confirmed', checked_in: 'inhouse', checked_out: 'departed', cancelled: 'cancelled', no_show: 'noshow',
};

export const RESERVATION_STATUS_LABEL: Record<ReservationStatus, string> = {
  tentative: 'Option', pending: 'En attente', confirmed: 'Confirmée', checked_in: 'En séjour', checked_out: 'Parti', cancelled: 'Annulée', no_show: 'Non présenté',
};

export function ReservationBadge({ status }: { status: ReservationStatus }) {
  if (status === 'tentative') return <Badge tone="accent" icon={<Hourglass aria-hidden className="size-3.5" />}>Option</Badge>;
  return <StatusBadge status={UI[status]} />;
}

export const SOURCE_LABEL: Record<string, string> = {
  direct: 'Direct', phone: 'Téléphone', walk_in: 'Sans réservation', website: 'Site web', booking_com: 'Booking.com', airbnb: 'Airbnb', expedia: 'Expedia', agency: 'Agence', other: 'Autre',
};
export const SOURCE_OPTIONS = Object.entries(SOURCE_LABEL).map(([value, label]) => ({ value, label }));
