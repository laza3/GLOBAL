-- 0006 — Noyau hôtelier : catégories, chambres, tarifs, taxes, moyens de paiement, clients (CRM)
--
-- Convention : chaque table d'établissement porte hotel_id, un UNIQUE (hotel_id, id) et les clés étrangères vers
-- d'autres tables d'établissement sont COMPOSITES (hotel_id, x_id) : référencer une ligne d'un autre hôtel est
-- impossible au niveau de la base, indépendamment de la RLS.
-- Montants : entiers dans la plus petite unité de la devise (voir currencies.decimals), jamais de flottants.

CREATE TABLE room_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id    uuid NOT NULL REFERENCES hotels (id),
  code        text NOT NULL CHECK (code ~ '^[A-Za-z0-9_-]{1,20}$'),
  name        text NOT NULL,
  description text,
  base_rate   bigint NOT NULL DEFAULT 0 CHECK (base_rate >= 0),
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, code),
  UNIQUE (hotel_id, id)
);

CREATE TABLE rooms (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id            uuid NOT NULL REFERENCES hotels (id),
  category_id         uuid NOT NULL,
  number              text NOT NULL CHECK (length(btrim(number)) > 0),
  name                text,
  floor               integer,
  capacity            integer NOT NULL DEFAULT 2 CHECK (capacity > 0),
  beds                integer NOT NULL DEFAULT 1 CHECK (beds > 0),
  -- NULL = tarif de la catégorie
  nightly_rate        bigint CHECK (nightly_rate IS NULL OR nightly_rate >= 0),
  description         text,
  amenities           text[] NOT NULL DEFAULT '{}',
  -- État de ménage persistant. « Occupée / réservée / disponible / hors service / en maintenance » sont DÉRIVÉS
  -- (séjours en cours + blocs de chambre), voir la vue room_status_today : pas de statut dupliqué à synchroniser.
  housekeeping_status text NOT NULL DEFAULT 'clean' CHECK (housekeeping_status IN ('dirty', 'cleaning', 'clean', 'inspected')),
  is_archived         boolean NOT NULL DEFAULT false,
  version             integer NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, number),
  UNIQUE (hotel_id, id),
  FOREIGN KEY (hotel_id, category_id) REFERENCES room_categories (hotel_id, id)
);
CREATE INDEX rooms_category_idx ON rooms (hotel_id, category_id);

CREATE TABLE room_photos (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id   uuid NOT NULL REFERENCES hotels (id),
  room_id    uuid NOT NULL,
  file_id    uuid NOT NULL,
  position   integer NOT NULL DEFAULT 0,
  caption    text,
  UNIQUE (hotel_id, id),
  FOREIGN KEY (hotel_id, room_id) REFERENCES rooms (hotel_id, id) ON DELETE CASCADE,
  FOREIGN KEY (hotel_id, file_id) REFERENCES files (hotel_id, id)
);

-- Tarifs saisonniers par catégorie ; en cas de chevauchement la priorité la plus haute l'emporte.
-- Les réservations existantes ne sont jamais recalculées : leur prix est figé par nuit (reservation_room_nights).
CREATE TABLE rate_periods (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id     uuid NOT NULL REFERENCES hotels (id),
  category_id  uuid NOT NULL,
  name         text NOT NULL,
  starts_on    date NOT NULL,
  ends_on      date NOT NULL,
  nightly_rate bigint NOT NULL CHECK (nightly_rate >= 0),
  weekend_rate bigint CHECK (weekend_rate IS NULL OR weekend_rate >= 0),
  min_stay     integer NOT NULL DEFAULT 1 CHECK (min_stay >= 1),
  priority     integer NOT NULL DEFAULT 0,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on),
  UNIQUE (hotel_id, id),
  FOREIGN KEY (hotel_id, category_id) REFERENCES room_categories (hotel_id, id)
);
CREATE INDEX rate_periods_lookup_idx ON rate_periods (hotel_id, category_id, starts_on, ends_on);

-- Taxes configurables. rate_bps : points de base (2000 = 20,00 %). Historisées par valid_from / valid_to.
CREATE TABLE tax_rules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id     uuid NOT NULL REFERENCES hotels (id),
  name         text NOT NULL,
  kind         text NOT NULL DEFAULT 'percentage' CHECK (kind IN ('percentage', 'fixed_per_person_night')),
  rate_bps     integer CHECK (rate_bps IS NULL OR rate_bps BETWEEN 0 AND 100000),
  fixed_amount bigint CHECK (fixed_amount IS NULL OR fixed_amount >= 0),
  applies_to   text[] NOT NULL DEFAULT '{room}' CHECK (applies_to <@ ARRAY['room', 'restaurant', 'service', 'other']),
  is_inclusive boolean NOT NULL DEFAULT false,
  is_active    boolean NOT NULL DEFAULT true,
  valid_from   date,
  valid_to     date,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, id),
  CHECK ((kind = 'percentage' AND rate_bps IS NOT NULL) OR (kind = 'fixed_per_person_night' AND fixed_amount IS NOT NULL)),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);

CREATE TABLE payment_methods (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id   uuid NOT NULL REFERENCES hotels (id),
  code       text NOT NULL CHECK (code ~ '^[a-z0-9_]{2,30}$'),
  label      text NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('cash', 'mobile_money', 'card', 'bank_transfer', 'other')),
  is_active  boolean NOT NULL DEFAULT true,
  details    jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  UNIQUE (hotel_id, code),
  UNIQUE (hotel_id, id)
);

-- Taux de change saisis par l'établissement (aucun service externe n'est supposé)
CREATE TABLE exchange_rates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id       uuid NOT NULL REFERENCES hotels (id),
  base_currency  char(3) NOT NULL REFERENCES currencies (code),
  quote_currency char(3) NOT NULL REFERENCES currencies (code),
  rate           numeric(18, 8) NOT NULL CHECK (rate > 0),
  effective_at   timestamptz NOT NULL DEFAULT now(),
  created_by_membership_id uuid,
  CHECK (base_currency <> quote_currency)
);
CREATE INDEX exchange_rates_lookup_idx ON exchange_rates (hotel_id, base_currency, quote_currency, effective_at DESC);

-- ---------------------------------------------------------------------------
-- CRM
-- ---------------------------------------------------------------------------
CREATE TABLE guests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id         uuid NOT NULL REFERENCES hotels (id),
  first_name       text NOT NULL,
  last_name        text NOT NULL,
  email            citext,
  phone            text,
  -- Version normalisée (chiffres, indicatif) pour la détection de doublons
  phone_normalized text,
  birth_date       date,
  address          text,
  city             text,
  country          char(2) CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
  nationality      char(2) CHECK (nationality IS NULL OR nationality ~ '^[A-Z]{2}$'),
  is_vip           boolean NOT NULL DEFAULT false,
  tags             text[] NOT NULL DEFAULT '{}',
  preferences      jsonb NOT NULL DEFAULT '{}'::jsonb,
  marketing_consent boolean NOT NULL DEFAULT false,
  merged_into_id   uuid,
  anonymized_at    timestamptz,
  version          integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, id),
  FOREIGN KEY (hotel_id, merged_into_id) REFERENCES guests (hotel_id, id)
);
-- Un même e-mail = un seul client actif par hôtel (anti-doublons) ; le téléphone reste un contrôle « souple » côté API
CREATE UNIQUE INDEX guests_email_uq ON guests (hotel_id, email)
  WHERE email IS NOT NULL AND merged_into_id IS NULL AND anonymized_at IS NULL;
CREATE INDEX guests_phone_idx ON guests (hotel_id, phone_normalized) WHERE phone_normalized IS NOT NULL;
CREATE INDEX guests_name_idx ON guests (hotel_id, lower(last_name), lower(first_name));

-- Pièces d'identité : numéro chiffré côté application (AES-256-GCM), jamais en clair en base.
-- La lecture exige une permission dédiée et est journalisée (audit_logs).
CREATE TABLE guest_documents (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id           uuid NOT NULL REFERENCES hotels (id),
  guest_id           uuid NOT NULL,
  doc_type           text NOT NULL CHECK (doc_type IN ('national_id', 'passport', 'driver_license', 'residence_permit', 'other')),
  number_enc         bytea NOT NULL,
  key_version        integer NOT NULL DEFAULT 1,
  number_last4       text CHECK (number_last4 IS NULL OR length(number_last4) <= 4),
  issuing_country    char(2),
  expires_on         date,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, id),
  FOREIGN KEY (hotel_id, guest_id) REFERENCES guests (hotel_id, id)
);

CREATE TABLE guest_notes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id              uuid NOT NULL REFERENCES hotels (id),
  guest_id              uuid NOT NULL,
  author_membership_id  uuid,
  body                  text NOT NULL CHECK (length(btrim(body)) > 0),
  created_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (hotel_id, guest_id) REFERENCES guests (hotel_id, id),
  FOREIGN KEY (hotel_id, author_membership_id) REFERENCES memberships (hotel_id, id)
);
CREATE INDEX guest_notes_guest_idx ON guest_notes (hotel_id, guest_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Sécurité
-- ---------------------------------------------------------------------------
SELECT meta.rls_tenant('room_categories');
SELECT meta.rls_tenant('rooms');
SELECT meta.rls_tenant('room_photos');
SELECT meta.rls_tenant('rate_periods');
SELECT meta.rls_tenant('tax_rules');
SELECT meta.rls_tenant('payment_methods');
SELECT meta.rls_tenant('exchange_rates', 'SELECT, INSERT');
-- Pas de suppression physique d'un client (historique, comptabilité) : archivage / anonymisation
SELECT meta.rls_tenant('guests', 'SELECT, INSERT, UPDATE');
SELECT meta.rls_tenant('guest_documents', 'SELECT, INSERT, DELETE');
SELECT meta.rls_tenant('guest_notes', 'SELECT, INSERT');

SELECT meta.attach_housekeeping_triggers();
