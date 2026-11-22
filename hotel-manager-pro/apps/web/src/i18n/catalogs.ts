/**
 * Catalogues de messages. Le français est la langue de référence et le repli : une clé absente d'un catalogue s'affiche en français,
 * jamais sous forme de clé brute. Le malgache est à FAIRE RELIRE par un locuteur natif avant mise en production.
 */
export type Locale = 'fr' | 'en' | 'mg';
export const LOCALES: Array<{ value: Locale; label: string }> = [
  { value: 'fr', label: 'Français' },
  { value: 'en', label: 'English' },
  { value: 'mg', label: 'Malagasy' },
];

type Catalog = Record<string, string>;

export const fr: Catalog = {
  'nav.main': 'Navigation principale',
  'nav.group.operations': 'Exploitation', 'nav.group.management': 'Gestion', 'nav.group.admin': 'Administration',
  'nav.overview': "Vue d'ensemble", 'nav.reservations': 'Réservations', 'nav.calendar': 'Calendrier', 'nav.rooms': 'Chambres', 'nav.guests': 'Clients',
  'nav.reception': 'Réception', 'nav.housekeeping': 'Housekeeping', 'nav.restaurant': 'Restaurant', 'nav.billing': 'Facturation', 'nav.finances': 'Finances',
  'nav.staff': 'Personnel', 'nav.reports': 'Rapports', 'nav.settings': 'Paramètres',
  'nav.collapse': 'Replier le menu', 'nav.expand': 'Déplier le menu', 'nav.soon': 'Bientôt', 'nav.more': 'Plus',
  'auth.login.title': 'Connexion', 'auth.email': 'Adresse e-mail', 'auth.password': 'Mot de passe', 'auth.login.submit': 'Se connecter',
  'auth.forgot': 'Mot de passe oublié ?', 'auth.register': 'Créer un compte', 'auth.logout': 'Se déconnecter',
  'dash.today': "Aujourd'hui à l'hôtel", 'dash.occupancy': 'Occupation', 'dash.arrivals': 'Arrivées', 'dash.departures': 'Départs', 'dash.inhouse': 'En séjour',
  'dash.collected': "Encaissé aujourd'hui", 'dash.receivables': 'Reste à encaisser', 'dash.dirty': 'Chambres à nettoyer', 'dash.restaurant': 'Restaurant',
  'dash.hello': 'Bonjour {name}',
  'common.save': 'Enregistrer', 'common.cancel': 'Annuler', 'common.close': 'Fermer', 'common.search': 'Rechercher', 'common.loading': 'Chargement…',
  'settings.language': 'Langue', 'settings.language.hint': "La langue de l'interface. Les écrans non encore traduits restent en français.",
};

export const en: Catalog = {
  'nav.main': 'Main navigation',
  'nav.group.operations': 'Operations', 'nav.group.management': 'Management', 'nav.group.admin': 'Administration',
  'nav.overview': 'Overview', 'nav.reservations': 'Reservations', 'nav.calendar': 'Calendar', 'nav.rooms': 'Rooms', 'nav.guests': 'Guests',
  'nav.reception': 'Front desk', 'nav.housekeeping': 'Housekeeping', 'nav.restaurant': 'Restaurant', 'nav.billing': 'Billing', 'nav.finances': 'Finances',
  'nav.staff': 'Staff', 'nav.reports': 'Reports', 'nav.settings': 'Settings',
  'nav.collapse': 'Collapse menu', 'nav.expand': 'Expand menu', 'nav.soon': 'Soon', 'nav.more': 'More',
  'auth.login.title': 'Sign in', 'auth.email': 'Email address', 'auth.password': 'Password', 'auth.login.submit': 'Sign in',
  'auth.forgot': 'Forgot your password?', 'auth.register': 'Create an account', 'auth.logout': 'Sign out',
  'dash.today': 'Today at the hotel', 'dash.occupancy': 'Occupancy', 'dash.arrivals': 'Arrivals', 'dash.departures': 'Departures', 'dash.inhouse': 'In house',
  'dash.collected': 'Collected today', 'dash.receivables': 'Still to collect', 'dash.dirty': 'Rooms to clean', 'dash.restaurant': 'Restaurant',
  'dash.hello': 'Hello {name}',
  'common.save': 'Save', 'common.cancel': 'Cancel', 'common.close': 'Close', 'common.search': 'Search', 'common.loading': 'Loading…',
  'settings.language': 'Language', 'settings.language.hint': 'The interface language. Screens not yet translated stay in French.',
};

export const mg: Catalog = {
  'nav.main': 'Fitetezana lehibe',
  'nav.group.operations': "Fitantanana isan'andro", 'nav.group.management': 'Fitantanana', 'nav.group.admin': 'Fandrindrana',
  'nav.overview': 'Topimaso', 'nav.reservations': 'Famandrihana', 'nav.calendar': 'Kalandrie', 'nav.rooms': 'Efitra', 'nav.guests': 'Mpanjifa',
  'nav.reception': 'Fandraisana', 'nav.housekeeping': 'Fanadiovana', 'nav.restaurant': 'Trano fisakafoanana', 'nav.billing': 'Faktiora', 'nav.finances': 'Vola',
  'nav.staff': 'Mpiasa', 'nav.reports': 'Tatitra', 'nav.settings': 'Fandrindrana',
  'nav.collapse': 'Atsoriky ny menio', 'nav.expand': 'Alehibe ny menio', 'nav.soon': 'Tsy ho ela', 'nav.more': 'Hafa',
  'auth.login.title': 'Hiditra', 'auth.email': 'Adiresy mailaka', 'auth.password': 'Teny miafina', 'auth.login.submit': 'Hiditra',
  'auth.forgot': 'Hadino ny teny miafina?', 'auth.register': 'Hamorona kaonty', 'auth.logout': 'Hivoaka',
  'dash.today': "Anio ao amin'ny hotely", 'dash.occupancy': 'Taham-pitoerana', 'dash.arrivals': 'Fahatongavana', 'dash.departures': 'Fialana', 'dash.inhouse': 'Mipetraka',
  'dash.collected': 'Vola voaray androany', 'dash.receivables': 'Vola mbola horaisina', 'dash.dirty': 'Efitra hodiovina', 'dash.restaurant': 'Trano fisakafoanana',
  'dash.hello': 'Salama {name}',
  'common.save': 'Tehirizina', 'common.cancel': 'Foana', 'common.close': 'Hidio', 'common.search': 'Hikaroka', 'common.loading': 'Eo am-pakàna…',
  'settings.language': 'Fiteny', 'settings.language.hint': "Ny fiteny ampiasaina. Ny pejy mbola tsy nadika dia mijanona amin'ny teny frantsay.",
};

export const CATALOGS: Record<Locale, Catalog> = { fr, en, mg };
