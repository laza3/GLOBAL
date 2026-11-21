-- 0004 — Établissements (tenants), utilisateurs, rôles, sessions, audit, fichiers

CREATE TABLE hotels (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              citext NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$'),
  name              text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  legal_name        text,
  tax_id            text,
  country           char(2) CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
  city              text,
  address           text,
  phone             text,
  email             citext,
  website           text,
  logo_file_id      uuid,
  -- Cycle de vie du COMPTE (distinct de l'abonnement) : la suspension est décidée par la plateforme
  status            text NOT NULL DEFAULT 'onboarding' CHECK (status IN ('onboarding', 'active', 'suspended', 'closed')),
  suspended_at      timestamptz,
  suspension_reason text,
  closed_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hotel_suspended_has_date CHECK (status <> 'suspended' OR suspended_at IS NOT NULL),
  CONSTRAINT hotel_closed_has_date CHECK (status <> 'closed' OR closed_at IS NOT NULL)
);

CREATE TABLE hotel_settings (
  hotel_id         uuid PRIMARY KEY REFERENCES hotels (id),
  default_currency char(3) NOT NULL DEFAULT 'MGA' REFERENCES currencies (code),
  locale           text NOT NULL DEFAULT 'fr' CHECK (locale IN ('fr', 'en', 'mg')),
  -- Identifiant IANA de Madagascar : « Indian/Antananarivo » (UTC+3, sans heure d'été).
  -- « Africa/Antananarivo » n'existe PAS dans la base de fuseaux (PostgreSQL et les navigateurs le rejettent).
  timezone         text NOT NULL DEFAULT 'Indian/Antananarivo',
  check_in_time    time NOT NULL DEFAULT '14:00',
  check_out_time   time NOT NULL DEFAULT '12:00',
  invoice_prefix   text NOT NULL DEFAULT 'FAC' CHECK (invoice_prefix ~ '^[A-Z0-9-]{1,10}$'),
  reservation_prefix text NOT NULL DEFAULT 'RES' CHECK (reservation_prefix ~ '^[A-Z0-9-]{1,10}$'),
  invoice_header   text,
  invoice_footer   text,
  extra            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Un fuseau invalide casserait tous les calculs « aujourd'hui » (arrivées, départs, statut des chambres) :
-- on le refuse dès la saisie plutôt qu'à la première requête.
CREATE FUNCTION validate_hotel_timezone() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
    PERFORM raise_business_error('invalid_timezone', NEW.timezone);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_validate_hotel_timezone BEFORE INSERT OR UPDATE OF timezone ON hotel_settings
  FOR EACH ROW EXECUTE FUNCTION validate_hotel_timezone();

-- Compte utilisateur global (une personne peut travailler pour plusieurs établissements via memberships)
CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             citext NOT NULL UNIQUE,
  full_name         text NOT NULL,
  phone             text,
  password_hash     text NOT NULL,
  locale            text NOT NULL DEFAULT 'fr' CHECK (locale IN ('fr', 'en', 'mg')),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  email_verified_at timestamptz,
  failed_attempts   integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until      timestamptz,
  last_login_at     timestamptz,
  totp_secret_enc   bytea,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id),
  hotel_id    uuid REFERENCES hotels (id),
  token_hash  text NOT NULL UNIQUE,
  ip          inet,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id    uuid NOT NULL REFERENCES hotels (id),
  key         text NOT NULL CHECK (key ~ '^[a-z0-9_]{2,40}$'),
  name        text NOT NULL,
  description text,
  is_system   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, key),
  UNIQUE (hotel_id, id)
);

CREATE TABLE role_permissions (
  hotel_id   uuid NOT NULL,
  role_id    uuid NOT NULL,
  permission text NOT NULL CHECK (permission ~ '^[a-z_]+:[a-z_]+$'),
  PRIMARY KEY (role_id, permission),
  FOREIGN KEY (hotel_id, role_id) REFERENCES roles (hotel_id, id) ON DELETE CASCADE
);

CREATE TABLE departments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id   uuid NOT NULL REFERENCES hotels (id),
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, name),
  UNIQUE (hotel_id, id)
);

CREATE TABLE memberships (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id      uuid NOT NULL REFERENCES hotels (id),
  user_id       uuid NOT NULL REFERENCES users (id),
  role_id       uuid NOT NULL,
  department_id uuid,
  job_title     text,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'disabled')),
  joined_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, user_id),
  UNIQUE (hotel_id, id),
  -- Clés composites : un rôle ou un département d'un AUTRE hôtel est impossible à référencer
  FOREIGN KEY (hotel_id, role_id) REFERENCES roles (hotel_id, id),
  FOREIGN KEY (hotel_id, department_id) REFERENCES departments (hotel_id, id)
);
CREATE INDEX memberships_user_idx ON memberships (user_id);

CREATE TABLE files (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id     uuid NOT NULL REFERENCES hotels (id),
  storage_key  text NOT NULL UNIQUE,
  filename     text NOT NULL,
  mime_type    text NOT NULL,
  size_bytes   bigint NOT NULL CHECK (size_bytes >= 0),
  sha256       text,
  purpose      text NOT NULL DEFAULT 'attachment',
  uploaded_by_user_id uuid REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, id)
);

ALTER TABLE hotels
  ADD CONSTRAINT hotels_logo_fk FOREIGN KEY (id, logo_file_id) REFERENCES files (hotel_id, id);

-- Journal d'audit de l'établissement (append-only : ni UPDATE ni DELETE)
CREATE TABLE audit_logs (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  hotel_id           uuid NOT NULL REFERENCES hotels (id),
  actor_user_id      uuid,
  actor_membership_id uuid,
  action             text NOT NULL,
  entity_type        text,
  entity_id          uuid,
  summary            text,
  before_data        jsonb,
  after_data         jsonb,
  ip                 inet,
  user_agent         text,
  request_id         text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_hotel_created_idx ON audit_logs (hotel_id, created_at DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs (hotel_id, entity_type, entity_id);

CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id   uuid NOT NULL REFERENCES hotels (id),
  user_id    uuid NOT NULL REFERENCES users (id),
  kind       text NOT NULL,
  title      text NOT NULL,
  body       text,
  link       text,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (hotel_id, user_id, created_at DESC);

-- Clés d'idempotence : un même POST rejoué ne crée pas deux paiements/réservations
CREATE TABLE idempotency_keys (
  hotel_id        uuid NOT NULL REFERENCES hotels (id),
  key             text NOT NULL,
  request_hash    text NOT NULL,
  response_status integer,
  response_body   jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hotel_id, key)
);

-- Compteurs séquentiels par établissement (références de réservation, numéros de facture)
CREATE TABLE hotel_counters (
  hotel_id uuid NOT NULL REFERENCES hotels (id),
  key      text NOT NULL,
  value    bigint NOT NULL DEFAULT 0 CHECK (value >= 0),
  PRIMARY KEY (hotel_id, key)
);

CREATE FUNCTION next_hotel_counter(p_key text) RETURNS bigint
  LANGUAGE sql AS $$
  INSERT INTO hotel_counters (hotel_id, key, value) VALUES (app_hotel_id(), p_key, 1)
  ON CONFLICT (hotel_id, key) DO UPDATE SET value = hotel_counters.value + 1
  RETURNING value
$$;
GRANT EXECUTE ON FUNCTION next_hotel_counter(text) TO hmp_app;

-- ---------------------------------------------------------------------------
-- Sécurité multi-tenant
-- ---------------------------------------------------------------------------
SELECT meta.rls_tenant('hotel_settings', 'SELECT, INSERT, UPDATE');
SELECT meta.rls_tenant('roles');
SELECT meta.rls_tenant('role_permissions');
SELECT meta.rls_tenant('departments');
SELECT meta.rls_tenant('memberships');
SELECT meta.rls_tenant('files', 'SELECT, INSERT, DELETE');
SELECT meta.rls_tenant('audit_logs', 'SELECT, INSERT');
SELECT meta.rls_tenant('notifications');
SELECT meta.rls_tenant('idempotency_keys', 'SELECT, INSERT, DELETE');
SELECT meta.rls_tenant('hotel_counters', 'SELECT, INSERT, UPDATE');

-- hotels : un établissement ne voit/modifie que sa propre ligne. Il ne peut jamais toucher à son statut
-- (suspension = plateforme) : droits par colonnes.
ALTER TABLE hotels ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_self ON hotels AS PERMISSIVE FOR ALL TO hmp_app
  USING (id = app_hotel_id()) WITH CHECK (id = app_hotel_id());
CREATE POLICY platform_all ON hotels AS PERMISSIVE FOR ALL TO hmp_platform USING (true) WITH CHECK (true);
GRANT SELECT ON hotels TO hmp_app, hmp_platform;
GRANT INSERT (id, slug, name, legal_name, tax_id, country, city, address, phone, email, website) ON hotels TO hmp_app;
GRANT UPDATE (name, legal_name, tax_id, country, city, address, phone, email, website, logo_file_id, updated_at) ON hotels TO hmp_app;
GRANT UPDATE (status, suspended_at, suspension_reason, closed_at, updated_at) ON hotels TO hmp_platform;

-- Fin du parcours de configuration : seul passage « onboarding -> active » autorisé à l'établissement
CREATE FUNCTION complete_onboarding() RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF app_hotel_id() IS NULL THEN PERFORM raise_business_error('tenant_context_missing'); END IF;
  UPDATE hotels SET status = 'active' WHERE id = app_hotel_id() AND status = 'onboarding';
END $$;
REVOKE ALL ON FUNCTION complete_onboarding() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION complete_onboarding() TO hmp_app;

-- users : visibles uniquement si membres de l'établissement courant (ou soi-même).
-- Le hash du mot de passe n'est JAMAIS lisible par le rôle applicatif (droits par colonnes) ;
-- la connexion passe par auth_find_user(), fonction étroite et auditée.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_select ON users AS PERMISSIVE FOR SELECT TO hmp_app
  USING (id = app_user_id()
         OR EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = users.id AND m.hotel_id = app_hotel_id()));
-- À l'inscription, l'API pose app.user_id sur l'identifiant qu'elle s'apprête à créer
CREATE POLICY users_insert ON users AS PERMISSIVE FOR INSERT TO hmp_app
  WITH CHECK (id = app_user_id());
CREATE POLICY users_update ON users AS PERMISSIVE FOR UPDATE TO hmp_app
  USING (id = app_user_id()
         OR EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = users.id AND m.hotel_id = app_hotel_id()))
  WITH CHECK (true);
GRANT SELECT (id, email, full_name, phone, locale, status, email_verified_at, last_login_at, created_at, updated_at) ON users TO hmp_app;
GRANT INSERT (id, email, full_name, phone, locale, password_hash) ON users TO hmp_app;
GRANT UPDATE (full_name, phone, locale, updated_at) ON users TO hmp_app;

CREATE FUNCTION auth_find_user(p_email citext)
  RETURNS TABLE (id uuid, full_name text, password_hash text, status text, failed_attempts integer, locked_until timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.full_name, u.password_hash, u.status, u.failed_attempts, u.locked_until
  FROM users u WHERE u.email = p_email
$$;
REVOKE ALL ON FUNCTION auth_find_user(citext) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_find_user(citext) TO hmp_app;

-- sessions : aucun accès direct (résolution par fonctions dédiées en Phase 4)
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

SELECT meta.attach_housekeeping_triggers();
