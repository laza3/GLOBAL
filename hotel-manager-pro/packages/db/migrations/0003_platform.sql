-- 0003 — Plateforme SaaS : administrateurs, paramètres, devises, forfaits, tarifs, connecteurs de paiement
-- Ces tables appartiennent au propriétaire de la plateforme. Les hôtels n'y accèdent qu'en lecture
-- (catalogue des forfaits) et jamais aux secrets.

CREATE TABLE currencies (
  code      char(3) PRIMARY KEY CHECK (code ~ '^[A-Z]{3}$'),
  name      text NOT NULL,
  symbol    text NOT NULL,
  -- Nombre de décimales d'usage : les montants sont stockés en entiers de cette plus petite unité (jamais de flottants)
  decimals  smallint NOT NULL CHECK (decimals BETWEEN 0 AND 4),
  is_active boolean NOT NULL DEFAULT true
);

-- Super-administrateurs : domaine d'identité séparé des utilisateurs d'hôtel
CREATE TABLE platform_admins (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           citext NOT NULL UNIQUE,
  full_name       text NOT NULL,
  password_hash   text NOT NULL,
  totp_secret_enc bytea,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until    timestamptz,
  last_login_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform_admin_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    uuid NOT NULL REFERENCES platform_admins (id),
  token_hash  text NOT NULL UNIQUE,
  ip          inet,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz
);

-- Paramètres globaux modifiables (durée d'essai par défaut, TVA des factures SaaS, coordonnées de la société…)
CREATE TABLE platform_settings (
  key         text PRIMARY KEY CHECK (key ~ '^[a-z0-9_.]+$'),
  value       jsonb NOT NULL,
  description text,
  updated_by  uuid REFERENCES platform_admins (id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Forfaits. NULL sur une limite = illimité. Les droits fonctionnels sont des drapeaux (features).
CREATE TABLE plans (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9_-]{2,40}$'),
  name             text NOT NULL,
  description      text,
  tier             integer NOT NULL DEFAULT 0,
  is_public        boolean NOT NULL DEFAULT true,
  is_active        boolean NOT NULL DEFAULT true,
  -- Prix sur devis (Enterprise) : pas de tarif catalogue, prix fixé par abonnement
  is_custom_priced boolean NOT NULL DEFAULT false,
  trial_days       integer CHECK (trial_days IS NULL OR trial_days >= 0),
  max_rooms        integer CHECK (max_rooms IS NULL OR max_rooms > 0),
  max_users        integer CHECK (max_users IS NULL OR max_users > 0),
  max_properties   integer CHECK (max_properties IS NULL OR max_properties > 0),
  features         jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(features) = 'object'),
  sort_order       integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Tarification configurable et historisée : un seul prix actif par (forfait, périodicité, devise).
-- Modifier un tarif = désactiver l'ancienne ligne et en créer une nouvelle ; les abonnements existants
-- conservent le prix copié à la souscription.
CREATE TABLE plan_prices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id          uuid NOT NULL REFERENCES plans (id),
  billing_interval text NOT NULL CHECK (billing_interval IN ('month', 'year')),
  currency         char(3) NOT NULL REFERENCES currencies (code),
  amount           bigint NOT NULL CHECK (amount >= 0),
  is_active        boolean NOT NULL DEFAULT true,
  valid_from       timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX plan_prices_one_active
  ON plan_prices (plan_id, billing_interval, currency) WHERE is_active;

-- Moyens de paiement SaaS. Règle d'honnêteté imposée par le schéma :
--   * un connecteur « automated » n'est activable que s'il est réellement « connected » (clés vérifiées) ;
--   * « manual » = le client paie hors plateforme et la plateforme valide à la main.
CREATE TABLE payment_connectors (
  code         text PRIMARY KEY CHECK (code IN ('bank_transfer', 'mvola', 'orange_money', 'airtel_money', 'card', 'cash', 'other')),
  name         text NOT NULL,
  mode         text NOT NULL DEFAULT 'manual' CHECK (mode IN ('manual', 'automated')),
  status       text NOT NULL DEFAULT 'not_configured' CHECK (status IN ('not_configured', 'configured', 'connected', 'disabled')),
  is_enabled   boolean NOT NULL DEFAULT false,
  -- Consignes affichées au client (numéro, RIB, libellé à indiquer…) — non secret
  instructions text,
  provider     text,
  config       jsonb NOT NULL DEFAULT '{}'::jsonb,
  connected_at timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT connector_automated_never_merely_configured
    CHECK (mode <> 'automated' OR status IN ('not_configured', 'connected', 'disabled')),
  CONSTRAINT connector_connected_requires_real_connection
    CHECK (status <> 'connected' OR (mode = 'automated' AND connected_at IS NOT NULL AND provider IS NOT NULL)),
  CONSTRAINT connector_enabled_requires_ready
    CHECK (NOT is_enabled OR (mode = 'manual' AND status = 'configured') OR (mode = 'automated' AND status = 'connected'))
);

-- Secrets des prestataires (chiffrés côté application) : lisibles uniquement par la plateforme
CREATE TABLE payment_connector_credentials (
  connector_code text PRIMARY KEY REFERENCES payment_connectors (code),
  credentials_enc bytea NOT NULL,
  key_version    integer NOT NULL DEFAULT 1,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform_audit_logs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_id    uuid REFERENCES platform_admins (id),
  action      text NOT NULL,
  target_type text,
  target_id   uuid,
  hotel_id    uuid,
  details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip          inet,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_audit_logs_created_idx ON platform_audit_logs (created_at DESC);
CREATE INDEX platform_audit_logs_hotel_idx ON platform_audit_logs (hotel_id, created_at DESC);

-- Sécurité : tout est réservé à la plateforme, sauf le catalogue
SELECT meta.rls_platform('platform_admins');
SELECT meta.rls_platform('platform_admin_sessions');
SELECT meta.rls_platform('platform_settings');
SELECT meta.rls_platform('currencies');
SELECT meta.rls_platform('plans');
SELECT meta.rls_platform('plan_prices');
SELECT meta.rls_platform('payment_connectors');
SELECT meta.rls_platform('payment_connector_credentials');
-- Journal append-only : ni UPDATE ni DELETE, même pour la plateforme
SELECT meta.rls_platform('platform_audit_logs', 'SELECT, INSERT');

SELECT meta.rls_catalog('currencies');
SELECT meta.rls_catalog('payment_connectors');
-- plans / plan_prices : les hôtels voient le catalogue public et leur propre forfait (policies posées en 0005)

SELECT meta.attach_housekeeping_triggers();
