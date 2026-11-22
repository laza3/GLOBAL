/**
 * Codes d'erreur stables → statut HTTP + message en français, clair et orienté action.
 * Les erreurs ne s'excusent pas et ne restent jamais vagues : elles disent ce qui s'est passé et quoi faire.
 * Les codes `HM001` de la base (raise_business_error) sont traduits ici.
 */
export interface ErrorSpec {
  status: number;
  message: string;
}

export const ERRORS = {
  // Authentification et session
  unauthenticated: { status: 401, message: 'Votre session a expiré. Reconnectez-vous pour continuer.' },
  invalid_credentials: { status: 401, message: 'E-mail ou mot de passe incorrect.' },
  account_locked: { status: 423, message: 'Compte temporairement verrouillé après plusieurs échecs. Réessayez dans quelques minutes.' },
  account_disabled: { status: 403, message: 'Ce compte est désactivé. Contactez l\'administrateur de votre établissement.' },
  hotel_selection_required: { status: 409, message: 'Choisissez l\'établissement auquel vous souhaitez vous connecter.' },
  not_a_member: { status: 403, message: 'Vous ne faites pas partie de cet établissement.' },
  csrf_invalid: { status: 403, message: 'Requête refusée par mesure de sécurité. Rechargez la page et réessayez.' },
  origin_not_allowed: { status: 403, message: 'Requête refusée : origine non autorisée.' },
  forbidden: { status: 403, message: 'Vous n\'avez pas l\'autorisation d\'effectuer cette action.' },
  weak_password: { status: 422, message: 'Mot de passe trop faible : 10 caractères minimum, avec une lettre et un chiffre.' },
  wrong_current_password: { status: 422, message: 'Le mot de passe actuel est incorrect.' },
  email_already_registered: { status: 409, message: 'Cette adresse e-mail possède déjà un compte. Connectez-vous pour continuer.' },
  slug_taken: { status: 409, message: 'Ce nom d\'établissement est déjà utilisé. Précisez la ville ou un autre nom.' },
  rate_limited: { status: 429, message: 'Trop de tentatives. Patientez un instant avant de réessayer.' },

  // Accès et abonnement
  hotel_suspended: { status: 403, message: 'Ce compte est suspendu. Contactez le support de la plateforme.' },
  hotel_closed: { status: 403, message: 'Ce compte est fermé.' },
  subscription_required: { status: 402, message: 'Aucun abonnement actif. Choisissez une formule pour reprendre la saisie.' },
  trial_expired: { status: 402, message: 'Votre essai gratuit est terminé. Choisissez une formule pour reprendre la saisie ; vos données sont conservées.' },
  subscription_expired: { status: 402, message: 'Votre abonnement est arrivé à échéance. Réglez la facture de renouvellement pour reprendre la saisie.' },
  room_limit_reached: { status: 402, message: 'La limite de chambres de votre formule est atteinte. Passez à une formule supérieure pour en ajouter.' },
  user_limit_reached: { status: 402, message: 'La limite d\'utilisateurs de votre formule est atteinte. Passez à une formule supérieure pour en ajouter.' },
  trial_already_used: { status: 409, message: 'L\'essai gratuit a déjà été utilisé par cet établissement.' },
  trial_disabled: { status: 409, message: 'L\'essai gratuit n\'est pas proposé actuellement. Choisissez une formule.' },
  plan_not_available: { status: 422, message: 'Cette formule n\'est pas disponible.' },
  hotel_not_eligible: { status: 409, message: 'Cet établissement ne peut pas démarrer d\'essai.' },

  // Paiements et factures SaaS
  payment_method_unavailable: { status: 422, message: 'Ce moyen de paiement n\'est pas disponible. Choisissez-en un autre.' },
  provider_not_connected: { status: 501, message: 'Le paiement en ligne n\'est pas encore connecté. Utilisez un moyen manuel (virement, Mobile Money) et indiquez la référence.' },
  reference_required: { status: 422, message: 'Indiquez la référence de la transaction pour que nous puissions la vérifier.' },
  payment_exceeds_due: { status: 422, message: 'Le montant dépasse le solde restant à payer de cette facture.' },
  price_not_available: { status: 422, message: 'Aucun tarif n\'est défini pour cette formule, cette périodicité et cette devise.' },
  currency_locked: { status: 409, message: 'La devise ne peut plus être modifiée une fois la configuration initiale terminée.' },
  invalid_state: { status: 409, message: 'Cette opération n\'est pas possible dans l\'état actuel.' },
  setting_not_allowed: { status: 422, message: 'Ce réglage n\'est pas modifiable.' },
  connector_not_ready: { status: 422, message: 'Ce moyen de paiement doit d\'abord être configuré (consignes de paiement) avant d\'être activé.' },
  invoice_not_found: { status: 404, message: 'Facture introuvable.' },
  invoice_not_payable: { status: 409, message: 'Cette facture ne peut pas être réglée.' },
  invoice_already_paid: { status: 409, message: 'Cette facture est déjà réglée.' },
  payment_currency_mismatch: { status: 422, message: 'La devise du paiement doit être celle de la facture.' },
  payment_not_found: { status: 404, message: 'Paiement introuvable.' },
  payment_not_awaiting_validation: { status: 409, message: 'Ce paiement n\'est pas en attente de validation.' },
  invoice_immutable: { status: 409, message: 'Une facture émise ne peut plus être modifiée.' },
  invoice_without_lines: { status: 422, message: 'La facture ne contient aucune ligne.' },
  invoice_totals_mismatch: { status: 422, message: 'Les totaux ne correspondent pas aux lignes de la facture.' },
  invoice_status_transition_invalid: { status: 409, message: 'Cette opération n\'est pas possible pour l\'état actuel de la facture.' },
  invoice_not_deletable: { status: 409, message: 'Une facture émise ne peut pas être supprimée.' },
  payment_immutable: { status: 409, message: 'Un paiement enregistré ne peut pas être modifié.' },
  payment_status_transition_invalid: { status: 409, message: 'Ce changement d\'état du paiement n\'est pas possible.' },
  payment_not_deletable: { status: 409, message: 'Un paiement ne peut pas être supprimé.' },

  // Données et ressources
  not_found: { status: 404, message: 'Ressource introuvable.' },
  validation_error: { status: 422, message: 'Certaines informations sont invalides. Corrigez les champs indiqués.' },
  unique_violation: { status: 409, message: 'Cet élément existe déjà.' },
  foreign_key_violation: { status: 422, message: 'Un élément référencé n\'existe pas.' },
  check_violation: { status: 422, message: 'Les données ne respectent pas les règles attendues.' },
  room_not_available: { status: 409, message: 'Cette chambre n\'est pas disponible sur ces dates.' },
  invalid_timezone: { status: 422, message: 'Fuseau horaire inconnu. Exemple pour Madagascar : Indian/Antananarivo.' },
  version_conflict: { status: 409, message: 'Cet élément a été modifié par quelqu\'un d\'autre. Rechargez-le avant de réessayer.' },
  plan_change_pending: { status: 409, message: 'Une demande de changement de formule est déjà en cours.' },
  room_number_taken: { status: 409, message: 'Ce numéro de chambre existe déjà dans votre établissement.' },
  category_code_taken: { status: 409, message: 'Ce code de catégorie existe déjà. Choisissez-en un autre.' },
  category_inactive: { status: 422, message: 'Cette catégorie est désactivée : activez-la ou choisissez-en une autre.' },
  room_has_future_stays: { status: 409, message: "Cette chambre a des séjours ou des blocages à venir. Déplacez-les ou annulez-les avant de l'archiver." },
  license_not_found: { status: 404, message: 'Licence introuvable.' },

  // Générique
  internal_error: { status: 500, message: 'Une erreur est survenue de notre côté. Réessayez dans un instant ; si elle persiste, contactez le support.' },
  tenant_context_missing: { status: 500, message: 'Une erreur est survenue de notre côté. Réessayez dans un instant ; si elle persiste, contactez le support.' },
} as const satisfies Record<string, ErrorSpec>;

export type ErrorCode = keyof typeof ERRORS;

export const isErrorCode = (code: string): code is ErrorCode => Object.prototype.hasOwnProperty.call(ERRORS, code);
