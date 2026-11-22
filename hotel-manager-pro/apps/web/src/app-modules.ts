/** Modules de l'application : lesquels existent, lesquels arrivent (affichés honnêtement, jamais simulés). */
export const AVAILABLE = new Set(['overview', 'settings', 'rooms', 'guests', 'reservations', 'calendar']);

export const SOON: ReadonlySet<string> = new Set([
  'reception', 'housekeeping', 'restaurant', 'billing', 'finances', 'staff', 'reports',
]);

export const MODULE_INFO: Record<string, { title: string; summary: string; scope: string[] }> = {
  reservations: {
    title: 'Réservations',
    summary: 'Créer et suivre les réservations, sans jamais vendre deux fois la même chambre.',
    scope: ['Recherche de disponibilité par type de chambre', 'Réservation, modification, annulation, no-show', 'Acompte et suivi du solde'],
  },
  calendar: {
    title: 'Calendrier',
    summary: "Voir l'occupation de toutes les chambres sur une grille jour par jour.",
    scope: ['Vue par chambre et par période', 'Déplacement d\'un séjour par glisser-déposer', 'Chambres bloquées et en maintenance'],
  },
  rooms: {
    title: 'Chambres',
    summary: 'Décrire votre parc : types de chambres, numéros, tarifs et équipements.',
    scope: ['Types de chambres et capacités', 'Tarifs par saison', 'Statuts : disponible, occupée, à nettoyer, hors service'],
  },
  guests: {
    title: 'Clients',
    summary: 'Un fichier client unique : coordonnées, historique de séjours, préférences.',
    scope: ['Fiches clients et historique', 'Clients VIP et notes', 'Recherche rapide à l\'arrivée'],
  },
  reception: {
    title: 'Réception',
    summary: 'Les arrivées, les départs et les clients en séjour du jour, au même endroit.',
    scope: ['Check-in et check-out', 'Attribution et changement de chambre', 'Encaissement au départ'],
  },
  housekeeping: {
    title: 'Housekeeping',
    summary: 'Organiser le nettoyage et la maintenance des chambres.',
    scope: ['Tâches par femme de chambre', 'Chambres à nettoyer en priorité', 'Signalement de pannes'],
  },
  restaurant: {
    title: 'Restaurant',
    summary: 'Prendre les commandes et les rattacher à la note de la chambre.',
    scope: ['Carte et tables', 'Commandes et notes', 'Report sur la facture du séjour'],
  },
  billing: {
    title: 'Facturation',
    summary: 'Les notes et factures de vos clients, avec encaissements en Ar, EUR ou USD.',
    scope: ['Factures numérotées sans trou', 'Paiements partiels, remboursements, avoirs', 'Export PDF'],
  },
  finances: {
    title: 'Finances',
    summary: 'Suivre vos recettes et vos dépenses.',
    scope: ['Encaissements par moyen de paiement', 'Dépenses par catégorie', 'Résultat par période'],
  },
  staff: {
    title: 'Personnel',
    summary: 'Inviter votre équipe et décider qui peut faire quoi.',
    scope: ['Invitations et rôles', 'Permissions par fonction', 'Journal des actions'],
  },
  reports: {
    title: 'Rapports',
    summary: "Mesurer l'activité : taux d'occupation, prix moyen, revenu par chambre disponible.",
    scope: ['Occupation, ADR et RevPAR', 'Exports CSV et PDF', 'Comparaison avec la période précédente'],
  },
};
