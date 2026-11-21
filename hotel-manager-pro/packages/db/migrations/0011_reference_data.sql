-- 0011 — Données de référence (modifiables ensuite depuis la console plateforme)
--
-- ATTENTION : les prix ci-dessous sont des VALEURS D'EXEMPLE pour démarrer. Le propriétaire de la plateforme
-- fixe les vrais tarifs depuis la console (modifier un tarif = nouvelle ligne plan_prices, l'ancienne est désactivée).
-- Aucun moyen de paiement n'est actif tant que le propriétaire ne l'a pas configuré.

INSERT INTO currencies (code, name, symbol, decimals) VALUES
  ('MGA', 'Ariary malgache', 'Ar', 0),
  ('EUR', 'Euro', '€', 2),
  ('USD', 'Dollar américain', '$', 2);

INSERT INTO platform_settings (key, value, description) VALUES
  ('trial.enabled',            'true'::jsonb,        'Active l''essai gratuit à l''inscription'),
  ('trial.default_days',       '14'::jsonb,          'Durée de l''essai gratuit (jours), si le forfait n''en définit pas'),
  ('trial.default_plan_code',  '"business"'::jsonb,  'Forfait offert pendant l''essai'),
  ('billing.grace_days',       '7'::jsonb,           'Jours de tolérance après une échéance impayée avant passage en lecture seule'),
  ('billing.invoice_due_days', '7'::jsonb,           'Délai de règlement des factures SaaS (jours)'),
  ('billing.tax_rate_bps',     '0'::jsonb,           'Taux de taxe des factures SaaS en points de base (2000 = 20 %) — à valider avec votre comptable'),
  ('billing.default_currency', '"MGA"'::jsonb,       'Devise par défaut de la facturation SaaS'),
  ('company.profile',          '{}'::jsonb,          'Identité légale de la plateforme (raison sociale, adresse, NIF/STAT) pour les factures SaaS');

-- Aucun connecteur n'est actif au départ. Les moyens « manual » se valident à la main ;
-- « card » est un connecteur automatisé : il ne pourra être activé qu'une fois réellement connecté à un prestataire.
INSERT INTO payment_connectors (code, name, mode, status, is_enabled, provider) VALUES
  ('bank_transfer', 'Virement bancaire', 'manual',    'not_configured', false, NULL),
  ('mvola',         'MVola',             'manual',    'not_configured', false, 'MVola'),
  ('orange_money',  'Orange Money',      'manual',    'not_configured', false, 'Orange Money'),
  ('airtel_money',  'Airtel Money',      'manual',    'not_configured', false, 'Airtel Money'),
  ('card',          'Carte bancaire',    'automated', 'not_configured', false, NULL),
  ('cash',          'Espèces',           'manual',    'not_configured', false, NULL),
  ('other',         'Autre',             'manual',    'not_configured', false, NULL);

INSERT INTO plans (code, name, description, tier, is_custom_priced, max_rooms, max_users, max_properties, features, sort_order) VALUES
  ('starter',    'Starter',    'Petits établissements : réservations, chambres, clients, réception et facturation.', 1, false, 10, 3, 1,
   '{"reservations":true,"calendar":true,"rooms":true,"guests":true,"reception":true,"billing":true,"payments":true,"reports_basic":true}'::jsonb, 10),
  ('business',   'Business',   'Ajoute housekeeping, restaurant, finances, permissions du personnel et exports.', 2, false, 30, 10, 1,
   '{"reservations":true,"calendar":true,"rooms":true,"guests":true,"reception":true,"billing":true,"payments":true,"reports_basic":true,"housekeeping":true,"restaurant":true,"finances":true,"staff_permissions":true,"exports":true}'::jsonb, 20),
  ('premium',    'Premium',    'Analytique avancée, multidevise, API et support prioritaire.', 3, false, 100, 30, 1,
   '{"reservations":true,"calendar":true,"rooms":true,"guests":true,"reception":true,"billing":true,"payments":true,"reports_basic":true,"housekeeping":true,"restaurant":true,"finances":true,"staff_permissions":true,"exports":true,"reports_advanced":true,"multi_currency":true,"api_access":true,"priority_support":true,"custom_branding":true}'::jsonb, 30),
  ('enterprise', 'Enterprise', 'Sur devis : chambres et utilisateurs illimités, multi-établissements, accompagnement dédié.', 4, true, NULL, NULL, NULL,
   '{"reservations":true,"calendar":true,"rooms":true,"guests":true,"reception":true,"billing":true,"payments":true,"reports_basic":true,"housekeeping":true,"restaurant":true,"finances":true,"staff_permissions":true,"exports":true,"reports_advanced":true,"multi_currency":true,"api_access":true,"priority_support":true,"custom_branding":true,"multi_property":true,"dedicated_support":true}'::jsonb, 40);

-- Tarifs d'exemple en MGA (annuel = 10 mois). Enterprise : sur devis, pas de tarif catalogue.
INSERT INTO plan_prices (plan_id, billing_interval, currency, amount)
SELECT p.id, v.interval, 'MGA', v.amount
FROM plans p
JOIN (VALUES
  ('starter',  'month',   80000), ('starter',  'year',   800000),
  ('business', 'month',  180000), ('business', 'year',  1800000),
  ('premium',  'month',  350000), ('premium',  'year',  3500000)
) AS v(code, interval, amount) ON v.code = p.code;
