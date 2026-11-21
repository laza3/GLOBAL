-- 0007 — Réservations et disponibilité
--
-- Garantie centrale : IMPOSSIBLE de réserver deux fois la même chambre aux mêmes dates.
-- Elle est portée par une contrainte d'exclusion PostgreSQL sur room_allocations, alimentée automatiquement
-- (trigger) par reservation_rooms : l'API n'a qu'un seul chemin d'écriture et ne peut pas « oublier » l'allocation.
-- Séjours ET blocs de chambre (maintenance, hors service) partagent la même contrainte.

CREATE TABLE reservations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id             uuid NOT NULL REFERENCES hotels (id),
  reference            text NOT NULL,
  guest_id             uuid NOT NULL,
  status               text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('tentative', 'pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show')),
  source               text NOT NULL DEFAULT 'direct'
    CHECK (source IN ('direct', 'phone', 'walk_in', 'website', 'booking_com', 'airbnb', 'expedia', 'agency', 'other')),
  group_name           text,
  currency             char(3) NOT NULL REFERENCES currencies (code),
  -- Montants figés à la saisie (voir reservation_room_nights pour le détail par nuit)
  subtotal_amount      bigint NOT NULL DEFAULT 0 CHECK (subtotal_amount >= 0),
  discount_amount      bigint NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  tax_amount           bigint NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount         bigint NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  deposit_required_amount bigint NOT NULL DEFAULT 0 CHECK (deposit_required_amount >= 0),
  special_requests     text,
  internal_notes       text,
  tentative_expires_at timestamptz,
  cancelled_at         timestamptz,
  cancel_reason        text,
  created_by_membership_id uuid,
  version              integer NOT NULL DEFAULT 1,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, reference),
  UNIQUE (hotel_id, id),
  FOREIGN KEY (hotel_id, guest_id) REFERENCES guests (hotel_id, id),
  FOREIGN KEY (hotel_id, created_by_membership_id) REFERENCES memberships (hotel_id, id),
  CONSTRAINT reservation_discount_le_subtotal CHECK (discount_amount <= subtotal_amount),
  CONSTRAINT reservation_total_consistent CHECK (total_amount = subtotal_amount - discount_amount + tax_amount),
  CONSTRAINT reservation_cancelled_has_date CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL),
  CONSTRAINT reservation_tentative_has_expiry CHECK (status <> 'tentative' OR tentative_expires_at IS NOT NULL)
);
CREATE INDEX reservations_guest_idx ON reservations (hotel_id, guest_id);
CREATE INDEX reservations_status_idx ON reservations (hotel_id, status, created_at DESC);

-- Une ligne par chambre (réservation de groupe = plusieurs lignes). La chambre peut être non encore affectée.
CREATE TABLE reservation_rooms (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id         uuid NOT NULL REFERENCES hotels (id),
  reservation_id   uuid NOT NULL,
  category_id      uuid NOT NULL,
  room_id          uuid,
  status           text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('tentative', 'pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show')),
  check_in         date NOT NULL,
  -- Date de départ EXCLUE : départ le 21 + arrivée le 21 ne se chevauchent pas
  check_out        date NOT NULL,
  nights           integer GENERATED ALWAYS AS (check_out - check_in) STORED,
  adults           integer NOT NULL DEFAULT 1 CHECK (adults >= 1),
  children         integer NOT NULL DEFAULT 0 CHECK (children >= 0),
  actual_check_in  timestamptz,
  actual_check_out timestamptz,
  version          integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, id),
  FOREIGN KEY (hotel_id, reservation_id) REFERENCES reservations (hotel_id, id),
  FOREIGN KEY (hotel_id, category_id) REFERENCES room_categories (hotel_id, id),
  FOREIGN KEY (hotel_id, room_id) REFERENCES rooms (hotel_id, id),
  CONSTRAINT reservation_room_dates_valid CHECK (check_out > check_in),
  CONSTRAINT reservation_room_stay_needs_room CHECK (status NOT IN ('checked_in', 'checked_out') OR room_id IS NOT NULL),
  CONSTRAINT reservation_room_checkin_has_time CHECK (status NOT IN ('checked_in', 'checked_out') OR actual_check_in IS NOT NULL),
  CONSTRAINT reservation_room_checkout_has_time CHECK (status <> 'checked_out' OR actual_check_out IS NOT NULL)
);
CREATE INDEX reservation_rooms_reservation_idx ON reservation_rooms (hotel_id, reservation_id);
CREATE INDEX reservation_rooms_room_dates_idx ON reservation_rooms (hotel_id, room_id, check_in, check_out);
CREATE INDEX reservation_rooms_arrivals_idx ON reservation_rooms (hotel_id, check_in) WHERE status IN ('pending', 'confirmed');

-- Prix par nuit figé à la réservation : base exacte du RevPAR / ADR, insensible aux changements de tarifs ultérieurs
CREATE TABLE reservation_room_nights (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id            uuid NOT NULL REFERENCES hotels (id),
  reservation_room_id uuid NOT NULL,
  night               date NOT NULL,
  rate                bigint NOT NULL CHECK (rate >= 0),
  discount            bigint NOT NULL DEFAULT 0 CHECK (discount >= 0),
  UNIQUE (reservation_room_id, night),
  FOREIGN KEY (hotel_id, reservation_room_id) REFERENCES reservation_rooms (hotel_id, id) ON DELETE CASCADE,
  CHECK (discount <= rate)
);
CREATE INDEX reservation_room_nights_night_idx ON reservation_room_nights (hotel_id, night);

-- Occupation d'une chambre sur une période : séjour OU bloc (maintenance / hors service)
CREATE TABLE room_allocations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id            uuid NOT NULL REFERENCES hotels (id),
  room_id             uuid NOT NULL,
  kind                text NOT NULL CHECK (kind IN ('stay', 'block')),
  starts_on           date NOT NULL,
  -- NULL = bloc sans date de fin (chambre hors service jusqu'à nouvel ordre) ; interdit pour un séjour
  ends_on             date,
  reservation_room_id uuid UNIQUE,
  block_reason        text CHECK (block_reason IN ('maintenance', 'out_of_service', 'owner_use', 'other')),
  notes               text,
  created_by_membership_id uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, id),
  FOREIGN KEY (hotel_id, room_id) REFERENCES rooms (hotel_id, id),
  FOREIGN KEY (hotel_id, reservation_room_id) REFERENCES reservation_rooms (hotel_id, id) ON DELETE CASCADE,
  FOREIGN KEY (hotel_id, created_by_membership_id) REFERENCES memberships (hotel_id, id),
  CONSTRAINT allocation_kind_consistent CHECK (
    (kind = 'stay'  AND reservation_room_id IS NOT NULL AND block_reason IS NULL AND ends_on IS NOT NULL)
    OR (kind = 'block' AND reservation_room_id IS NULL AND block_reason IS NOT NULL)),
  CONSTRAINT allocation_dates_valid CHECK (ends_on IS NULL OR ends_on > starts_on),
  CONSTRAINT room_allocations_no_overlap
    EXCLUDE USING gist (room_id WITH =, daterange(starts_on, ends_on, '[)') WITH &&)
);

-- Seul chemin d'écriture des allocations de séjour : reservation_rooms
CREATE FUNCTION sync_room_allocation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.room_id IS NOT NULL AND NEW.status IN ('tentative', 'pending', 'confirmed', 'checked_in') THEN
    INSERT INTO room_allocations (hotel_id, room_id, kind, starts_on, ends_on, reservation_room_id)
    VALUES (NEW.hotel_id, NEW.room_id, 'stay', NEW.check_in, NEW.check_out, NEW.id)
    ON CONFLICT (reservation_room_id) DO UPDATE
      SET room_id = EXCLUDED.room_id, starts_on = EXCLUDED.starts_on, ends_on = EXCLUDED.ends_on;
  ELSE
    -- annulée, no-show, départ effectué, ou chambre retirée : la chambre est libérée
    DELETE FROM room_allocations WHERE reservation_room_id = NEW.id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_sync_room_allocation AFTER INSERT OR UPDATE ON reservation_rooms
  FOR EACH ROW EXECUTE FUNCTION sync_room_allocation();

-- Une allocation de séjour ne doit jamais être écrite directement (sinon elle divergerait de reservation_rooms)
CREATE FUNCTION room_allocations_stay_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'stay' AND pg_trigger_depth() < 2 THEN
    PERFORM raise_business_error('stay_allocation_is_derived');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_room_allocations_stay_guard BEFORE INSERT OR UPDATE ON room_allocations
  FOR EACH ROW EXECUTE FUNCTION room_allocations_stay_guard();

-- Sécurité. Pas de suppression de réservation : on annule (traçabilité, comptabilité).
SELECT meta.rls_tenant('reservations', 'SELECT, INSERT, UPDATE');
SELECT meta.rls_tenant('reservation_rooms', 'SELECT, INSERT, UPDATE');
SELECT meta.rls_tenant('reservation_room_nights', 'SELECT, INSERT, UPDATE, DELETE');
-- room_allocations : l'API n'écrit que les BLOCS ; les séjours sont dérivés par trigger
SELECT meta.rls_tenant('room_allocations', 'SELECT, INSERT, UPDATE, DELETE');

SELECT meta.attach_housekeeping_triggers();
