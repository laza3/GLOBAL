import { LegalDocument, PublisherBlock, type Section } from './document';

const SECTIONS: Section[] = [
  {
    id: 'qui',
    title: 'Qui est responsable de quoi',
    body: [
      'Deux types de données sont concernés, avec deux responsables différents :',
      { list: [
        'les données de compte des utilisateurs (nom, e-mail, mot de passe, connexions) et de facturation de l\'abonnement : l\'éditeur du service en est le responsable de traitement ;',
        'les données que l\'établissement saisit pour gérer son activité (ses clients, leurs séjours, ses factures, son personnel) : l\'établissement en est le responsable de traitement ; l\'éditeur n\'agit que comme sous-traitant, sur ses instructions.',
      ] },
      'Contact de l\'éditeur pour toute question ou demande relative aux données : l\'assistance de l\'application, ou les coordonnées indiquées en tête des conditions d\'utilisation.',
    ],
  },
  {
    id: 'donnees',
    title: 'Les données traitées',
    body: [
      { list: [
        'Compte : nom, adresse e-mail, téléphone éventuel, langue, rôle et permissions, date d\'acceptation des conditions. Le mot de passe n\'est jamais conservé : seule une empreinte irréversible (Argon2id) l\'est.',
        'Connexions : adresse IP, type de navigateur, dates de connexion et d\'activité d\'une session, échecs de connexion (pour la protection contre l\'intrusion).',
        'Journal d\'audit : qui a fait quelle action sensible, et quand (modifications de tarifs, de droits, de paiements…).',
        'Abonnement : formule, factures, paiements déclarés (moyen, référence de transaction, nom du payeur).',
        'Activité de l\'établissement, saisie par lui : fiches clients (identité, coordonnées, pièce d\'identité si l\'établissement la saisit, préférences), réservations, séjours, notes, paiements, dépenses.',
        'Assistance : les messages échangés avec le support.',
      ] },
      'Le service ne collecte aucune donnée de géolocalisation, de contacts, ni de bancaire (numéro de carte).',
    ],
  },
  {
    id: 'finalites',
    title: 'Pourquoi, et sur quel fondement',
    body: [
      { list: [
        'Fournir le service et exécuter le contrat (compte, réservations, facturation, assistance) ;',
        'Sécuriser le service et prévenir la fraude (verrouillage après échecs, limitation de débit, journal d\'audit) : intérêt légitime ;',
        'Respecter les obligations légales (conservation des pièces comptables, réponse aux autorités) ;',
        'Améliorer le service à partir de statistiques agrégées sur l\'usage, sans consulter le contenu des données d\'un établissement.',
      ] },
      'Les données ne sont jamais vendues et ne servent à aucune publicité ni à aucun profilage commercial.',
    ],
  },
  {
    id: 'cookies',
    title: 'Cookies et stockage local',
    body: [
      'Le service n\'utilise que des cookies strictement nécessaires à son fonctionnement, qui ne demandent donc pas de consentement :',
      { list: [
        'un cookie de session (inaccessible au JavaScript) qui maintient la connexion ;',
        'un cookie de protection contre les requêtes frauduleuses (CSRF).',
      ] },
      'L\'application mémorise aussi sur l\'appareil, sans l\'envoyer au serveur, vos préférences d\'affichage (thème clair ou sombre, menu replié). Aucun cookie publicitaire, aucun outil de mesure d\'audience tiers et aucun traceur n\'est utilisé.',
    ],
  },
  {
    id: 'destinataires',
    title: 'Qui y a accès',
    body: [
      'Au sein de l\'établissement, chacun n\'accède qu\'à ce que son rôle permet. Côté éditeur, seules les personnes habilitées de l\'équipe de la plateforme accèdent aux données de compte et de facturation de l\'abonnement ; elles n\'ont pas accès aux clients, réservations ou factures hôtelières d\'un établissement dans le cadre de l\'administration commerciale, et chacune de leurs actions est journalisée.',
      'Les données sont hébergées chez un prestataire d\'hébergement et d\'infrastructure choisi par l\'éditeur, tenu à la confidentialité et à la sécurité. Elles ne sont transmises à aucun autre tiers, sauf obligation légale ou demande d\'une autorité compétente.',
    ],
  },
  {
    id: 'securite',
    title: 'Comment elles sont protégées',
    body: [
      { list: [
        'Isolation de chaque établissement dans la base de données elle-même (et non seulement dans l\'application) ;',
        'mots de passe conservés sous forme d\'empreinte irréversible, jetons de session conservés sous forme d\'empreinte ;',
        'communications chiffrées (HTTPS) en production, cookies sécurisés ;',
        'verrouillage après échecs de connexion, limitation de débit, journal d\'audit non modifiable ;',
        'sauvegardes régulières, restauration testée.',
      ] },
      'Aucun système n\'est infaillible : en cas d\'incident de sécurité touchant des données personnelles, l\'éditeur en informe sans délai les établissements concernés, et les autorités lorsque la loi l\'exige.',
    ],
  },
  {
    id: 'duree',
    title: 'Combien de temps',
    body: [
      { list: [
        'Compte et données de l\'établissement : tant que le contrat est en cours, puis 90 jours après sa fin (le temps de les exporter), puis suppression ;',
        'Pièces comptables : durée imposée par la loi ;',
        'Journaux de connexion et d\'audit : tant que le compte existe, puis au plus 12 mois ;',
        'Sauvegardes : elles expirent selon leur cycle de rotation.',
      ] },
      'Pour les fiches de ses clients, c\'est à l\'établissement de fixer la durée de conservation adaptée et d\'effacer ce qui n\'a plus lieu d\'être.',
    ],
  },
  {
    id: 'droits',
    title: 'Vos droits',
    body: [
      'Toute personne dont les données sont traitées peut demander l\'accès à ses données, leur rectification, leur effacement, la limitation du traitement, s\'opposer à un traitement pour un motif légitime, et obtenir ses données dans un format courant. Pour les données de compte, la demande se fait auprès de l\'éditeur via l\'assistance. Pour les données d\'un client d\'un hôtel, elle s\'adresse d\'abord à l\'hôtel, responsable du traitement, que l\'éditeur aide à y répondre.',
      'Ces droits s\'exercent dans le cadre de la loi malgache n° 2014-038 relative à la protection des données à caractère personnel. En cas de difficulté, il est possible de saisir l\'autorité de contrôle compétente, la Commission malagasy de l\'informatique et des libertés (CMIL).',
    ],
  },
  {
    id: 'modifs',
    title: 'Modifications de cette politique',
    body: [
      'Cette politique peut évoluer. La version en vigueur et sa date figurent en tête du document ; une modification importante est notifiée dans l\'application avant son entrée en vigueur.',
    ],
  },
];

export default function PrivacyPage() {
  return (
    <LegalDocument
      title="Politique de confidentialité"
      intro={<>Ce document explique quelles données le service Hotel Manager Pro traite, pourquoi, et comment les protéger. Éditeur : <PublisherBlock />.</>}
      sections={SECTIONS}
      other={{ to: '/conditions', label: "Conditions d'utilisation" }}
    />
  );
}
