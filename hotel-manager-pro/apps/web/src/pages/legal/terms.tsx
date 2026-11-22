import { LegalDocument, PublisherBlock, type Section } from './document';

const SECTIONS: Section[] = [
  {
    id: 'objet',
    title: 'Objet du service',
    body: [
      'Hotel Manager Pro est un service en ligne de gestion hôtelière : chambres, réservations, clients, réception, entretien, restauration, facturation, finances et suivi de l\'activité. Il est proposé à des établissements d\'hébergement (hôtels, maisons d\'hôtes, lodges) sous forme d\'abonnement ou de licence définitive.',
      'Les présentes conditions régissent l\'accès au service et son utilisation. En créant un compte et en cochant la case d\'acceptation, le propriétaire accepte ces conditions au nom de l\'établissement.',
    ],
  },
  {
    id: 'compte',
    title: 'Compte et accès',
    body: [
      'Un établissement correspond à un espace de travail isolé. Le propriétaire qui l\'ouvre déclare avoir le pouvoir d\'engager l\'établissement, et fournit des informations exactes (nom, coordonnées, e-mail valide) qu\'il s\'engage à tenir à jour.',
      'Chaque utilisateur dispose d\'identifiants personnels, qui ne doivent pas être partagés. Le propriétaire reste responsable des personnes qu\'il invite et des droits qu\'il leur donne. Toute action réalisée avec un compte est réputée faite par son titulaire ; en cas de perte ou de suspicion de compromission, le mot de passe doit être changé sans délai et l\'assistance prévenue.',
      'Après plusieurs échecs de connexion successifs, le compte est verrouillé quelques minutes pour le protéger.',
    ],
  },
  {
    id: 'tarifs',
    title: 'Essai gratuit, abonnement et licence',
    body: [
      'À l\'inscription, un essai gratuit peut être offert, sans demande de carte bancaire ni d\'information de paiement. Sa durée et la formule essayée sont indiquées dans l\'application. À la fin de l\'essai, l\'accès passe en lecture seule tant qu\'une formule n\'est pas souscrite : les données sont conservées et restent consultables.',
      'Les formules, leurs limites (nombre de chambres, d\'utilisateurs, fonctions) et leurs prix sont affichés dans l\'application, par période (mensuelle ou annuelle) et par devise. Les prix peuvent évoluer : un changement s\'applique aux nouvelles souscriptions et aux renouvellements suivants ; la période en cours reste facturée au prix convenu.',
      'Une formule sur devis est convenue au cas par cas. Une licence définitive donne un droit d\'usage sans date de fin pour un établissement ; la maintenance (mises à jour, support) est une prestation distincte, couverte jusqu\'à la date indiquée sur la licence.',
      'Les montants sont exprimés dans la devise de la facture. Les taxes éventuelles sont celles applicables au jour de l\'émission et figurent sur la facture.',
    ],
  },
  {
    id: 'paiement',
    title: 'Facturation et paiement',
    body: [
      'Les factures sont émises dans l\'application, numérotées sans interruption, et payables dans le délai qu\'elles indiquent. Une facture de renouvellement est émise quelques jours avant l\'échéance.',
      'Le paiement est effectué par virement bancaire ou Mobile Money (MVola, Orange Money, Airtel Money) selon les moyens ouverts. Aucun prélèvement automatique n\'est effectué. Le client déclare son paiement dans l\'application en indiquant la référence de la transaction ; l\'éditeur le vérifie (relevé bancaire, message de l\'opérateur) puis le valide. La facture n\'est considérée comme réglée, et la formule n\'est activée ou renouvelée, qu\'à cette validation.',
      'Un paiement dont la référence est introuvable ou dont le montant est incorrect est rejeté avec son motif ; le client peut en déclarer un nouveau. Les paiements partiels sont possibles ; le solde reste dû.',
      'À défaut de règlement à l\'échéance, l\'accès reste complet pendant un délai de tolérance indiqué dans l\'application, puis passe en lecture seule. L\'accès complet est rétabli dès validation du paiement.',
    ],
  },
  {
    id: 'donnees',
    title: 'Données de l\'établissement',
    body: [
      'Les données saisies par l\'établissement (clients, réservations, factures, personnel, etc.) lui appartiennent. L\'éditeur ne les utilise que pour fournir le service, les sécuriser et assister l\'établissement ; il ne les vend pas et ne les utilise pas à des fins publicitaires.',
      'Pour les données personnelles de ses clients et de son personnel, l\'établissement est responsable du traitement ; l\'éditeur agit pour son compte. Ces traitements sont décrits dans la politique de confidentialité.',
      'Chaque établissement est isolé des autres au niveau de la base de données : un établissement ne peut ni lire ni modifier les données d\'un autre, et l\'équipe de la plateforme n\'a pas accès aux clients, réservations ou factures hôtelières d\'un établissement dans le cadre de son administration commerciale.',
      'L\'établissement peut exporter ses données avec les exports disponibles dans le service, ou en faire la demande à l\'assistance. Les sauvegardes sont réalisées par l\'éditeur pour la continuité du service ; elles ne constituent pas une archive à la disposition du client.',
    ],
  },
  {
    id: 'usage',
    title: 'Règles d\'usage',
    body: [
      'L\'utilisateur s\'engage à utiliser le service conformément à la loi et aux présentes conditions. Il est notamment interdit de :',
      { list: [
        'tenter d\'accéder aux données d\'un autre établissement, à la console de la plateforme ou à des comptes qui ne sont pas les siens ;',
        'perturber le fonctionnement du service (attaques, charge anormale, contournement des limites de la formule) ;',
        'saisir des contenus illicites ou porter atteinte aux droits de tiers ;',
        'revendre, sous-licencier ou mettre à disposition le service à des tiers sans accord écrit de l\'éditeur.',
      ] },
      'Un établissement qui dépasse les limites de sa formule (chambres, utilisateurs) est invité à passer à une formule supérieure ; le service refuse les ajouts au-delà de la limite.',
    ],
  },
  {
    id: 'disponibilite',
    title: 'Disponibilité et responsabilité',
    body: [
      'L\'éditeur met en œuvre des moyens raisonnables pour assurer la disponibilité et la sécurité du service, et peut l\'interrompre brièvement pour sa maintenance. Il n\'est pas tenu à une disponibilité continue ni à un résultat, notamment en cas de coupure d\'électricité ou d\'internet, ou de panne de l\'hébergeur, indépendantes de sa volonté.',
      'Le service est un outil de gestion : l\'établissement reste responsable de ses décisions, de l\'exactitude des données qu\'il saisit, du respect de ses obligations légales (comptables, fiscales, déclaration des séjours) et de la vérification de ses encaissements.',
      'Dans la limite permise par la loi, la responsabilité de l\'éditeur est limitée aux dommages directs et plafonnée au montant payé par l\'établissement au titre du service sur les douze derniers mois ; elle n\'est pas limitée en cas de faute lourde ou de dol. L\'éditeur ne répond pas des dommages indirects (perte d\'exploitation, de clientèle, de profit).',
    ],
  },
  {
    id: 'fin',
    title: 'Suspension et résiliation',
    body: [
      'L\'établissement peut cesser d\'utiliser le service et demander la résiliation de son abonnement à tout moment ; la résiliation peut prendre effet à l\'échéance de la période payée, qui n\'est pas remboursée au prorata.',
      'L\'éditeur peut suspendre l\'accès, avec un motif communiqué à l\'établissement, en cas de manquement grave aux présentes conditions, d\'usage frauduleux ou de risque pour la sécurité du service. L\'établissement suspendu peut toujours contacter l\'assistance. Le défaut de paiement entraîne la lecture seule décrite à l\'article 4, non une suppression.',
      'À la fin du contrat, les données de l\'établissement sont conservées 90 jours et restent exportables sur demande, puis sont supprimées, sous réserve des conservations imposées par la loi (pièces comptables) et des sauvegardes qui expirent selon leur cycle.',
    ],
  },
  {
    id: 'pi',
    title: 'Propriété intellectuelle',
    body: [
      'Le service, son code, sa conception graphique et sa documentation restent la propriété de l\'éditeur. L\'établissement reçoit un droit d\'usage personnel, non exclusif et non transférable, pour la durée de son abonnement ou, pour une licence définitive, sans limite de durée dans les termes de la licence. Aucun droit de propriété sur le service n\'est cédé.',
    ],
  },
  {
    id: 'evolution',
    title: 'Évolution des conditions',
    body: [
      'Les conditions peuvent évoluer, notamment pour suivre la loi ou le service. La version en vigueur et sa date figurent en tête de ce document. Une modification importante est notifiée dans l\'application au moins 30 jours avant son entrée en vigueur ; la poursuite de l\'usage après ce délai vaut acceptation, et l\'établissement peut résilier s\'il la refuse.',
    ],
  },
  {
    id: 'droit',
    title: 'Droit applicable et litiges',
    body: [
      'Les présentes conditions sont régies par le droit malgache. En cas de difficulté, les parties recherchent d\'abord une solution amiable en contactant l\'assistance de l\'application. À défaut d\'accord, les tribunaux compétents d\'Antananarivo sont seuls compétents, sous réserve des règles impératives applicables.',
    ],
  },
];

export default function TermsPage() {
  return (
    <LegalDocument
      title="Conditions d'utilisation"
      intro={<>Ces conditions lient l&apos;établissement qui ouvre un compte et <PublisherBlock />. Elles sont à lire avec la politique de confidentialité.</>}
      sections={SECTIONS}
      other={{ to: '/confidentialite', label: 'Politique de confidentialité' }}
    />
  );
}
