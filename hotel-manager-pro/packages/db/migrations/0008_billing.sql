-- 0008 — Folio, charges, factures, paiements (facturation de l'établissement à ses clients)
--
-- Fil rouge : réservation -> folio (compte du client : charges + paiements) -> facture(s).
-- Règles portées par la base :
--  * Aucun champ « payé » stocké : le payé = somme des paiements CONFIRMÉS (vues en 0010).
--  * Les paiements forment un grand livre en ajout seul : pas de suppression, montants immuables ;
--    une erreur se corrige par un remboursement, jamais par une modification.
--  * Un remboursement ne peut dépasser le paiement d'origine (verrou + trigger).
--  * Une facture émise est immuable ; on la corrige par un avoir.

CREATE TABLE folios (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id       uuid NOT NULL REFERENCES hotels (id),
  reservation_id uuid,
  guest_id       uuid,
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  -- Facturation dans la devise de base de l'établissement ; paiements en autres devises convertis (base_amount)
  currency       char(3) NOT NULL REFERENCES currencies (code),
  closed_at      timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, id),
  FOREIGN KEY (hotel_id, reservation_id) REFERENCES reservations (hotel_id, id),
  FOREIGN KEY (hotel_id, guest_id) REFERENCES guests (hotel_id, id),
  CONSTRAINT folio_closed_has_date CHECK (status <> 'closed' OR closed_at IS NOT NULL)
);
CREATE UNIQUE INDEX folios_one_per_reservation ON folios (hotel_id, reservation_id) WHERE reservation_id IS NOT NULL;

CREATE TABLE folio_charges (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id            uuid NOT NULL REFERENCES hotels (id),
  folio_id            uuid NOT NULL,
  reservation_room_id uuid,
  kind                text NOT NULL CHECK (kind IN ('room', 'restaurant', 'service', 'fee', 'discount', 'adjustment')),
  description         text NOT NULL,
  quantity            numeric(12, 3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_amount         bigint NOT NULL,
  -- Montant net (HT) signé : négatif pour une remise ; la taxe est portée à part
  amount              bigint NOT NULL,
  tax_rule_id         uuid,
  tax_amount          bigint NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  service_date        date NOT NULL DEFAULT current_date,
  -- Origine : évite de poster deux fois la même commande restaurant sur un folio
  source              text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'reservation', 'restaurant_order')),
  source_ref          uuid,
  invoice_id          uuid,
  voided_at           timestamptz,
  void_reason         text,
  created_by_membership_id uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, id),
  FOREIGN KEY (hotel_id, folio_id) REFERENCES folios (hotel_id, id),
  FOREIGN KEY (hotel_id, reservation_room_id) REFERENCES reservation_rooms (hotel_id, id),
  FOREIGN KEY (hotel_id, tax_rule_id) REFERENCES tax_rules (hotel_id, id),
  FOREIGN KEY (hotel_id, created_by_membership_id) REFERENCES memberships (hotel_id, id),
  CONSTRAINT charge_void_has_reason CHECK (voided_at IS NULL OR void_reason IS NOT NULL),
  CONSTRAINT charge_discount_not_positive CHECK (kind <> 'discount' OR amount <= 0)
);
CREATE UNIQUE INDEX folio_charges_source_uq ON folio_charges (hotel_id, source, source_ref)
  WHERE source_ref IS NOT NULL AND voided_at IS NULL;
CREATE INDEX folio_charges_folio_idx ON folio_charges (hotel_id, folio_id);

CREATE TABLE invoices (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id             uuid NOT NULL REFERENCES hotels (id),
  folio_id             uuid,
  reservation_id       uuid,
  guest_id             uuid,
  kind                 text NOT NULL DEFAULT 'invoice' CHECK (kind IN ('invoice', 'credit_note')),
  credit_for_invoice_id uuid,
  -- Numéro séquentiel sans trou attribué à l'émission (next_hotel_counter)
  number               text,
  status               text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'void')),
  currency             char(3) NOT NULL REFERENCES currencies (code),
  subtotal_amount      bigint NOT NULL DEFAULT 0,
  tax_amount           bigint NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount         bigint NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  issued_at            timestamptz,
  due_at               timestamptz,
  voided_at            timestamptz,
  void_reason          text,
  -- Identité du client et de l'hôtel figée à l'émission
  billing_snapshot     jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes                text,
  created_by_membership_id uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, id),
  UNIQUE (hotel_id, number),
  FOREIGN KEY (hotel_id, folio_id) REFERENCES folios (hotel_id, id),
  FOREIGN KEY (hotel_id, reservation_id) REFERENCES reservations (hotel_id, id),
  FOREIGN KEY (hotel_id, guest_id) REFERENCES guests (hotel_id, id),
  FOREIGN KEY (hotel_id, credit_for_invoice_id) REFERENCES invoices (hotel_id, id),
  FOREIGN KEY (hotel_id, created_by_membership_id) REFERENCES memberships (hotel_id, id),
  CONSTRAINT invoice_total_consistent CHECK (total_amount = subtotal_amount + tax_amount),
  CONSTRAINT invoice_issued_has_number CHECK (status = 'draft' OR (number IS NOT NULL AND issued_at IS NOT NULL)),
  CONSTRAINT invoice_void_has_reason CHECK (status <> 'void' OR (voided_at IS NOT NULL AND void_reason IS NOT NULL)),
  CONSTRAINT credit_note_has_target CHECK ((kind = 'credit_note') = (credit_for_invoice_id IS NOT NULL))
);
CREATE INDEX invoices_folio_idx ON invoices (hotel_id, folio_id);

ALTER TABLE folio_charges
  ADD CONSTRAINT folio_charges_invoice_fk FOREIGN KEY (hotel_id, invoice_id) REFERENCES invoices (hotel_id, id);

CREATE TABLE invoice_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id        uuid NOT NULL REFERENCES hotels (id),
  invoice_id      uuid NOT NULL,
  folio_charge_id uuid,
  position        integer NOT NULL DEFAULT 0,
  description     text NOT NULL,
  quantity        numeric(12, 3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_amount     bigint NOT NULL,
  amount          bigint NOT NULL,
  tax_amount      bigint NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  tax_label       text,
  tax_rate_bps    integer,
  FOREIGN KEY (hotel_id, invoice_id) REFERENCES invoices (hotel_id, id) ON DELETE CASCADE,
  FOREIGN KEY (hotel_id, folio_charge_id) REFERENCES folio_charges (hotel_id, id)
);
CREATE INDEX invoice_lines_invoice_idx ON invoice_lines (hotel_id, invoice_id);

CREATE FUNCTION invoices_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE v_lines integer; v_sub bigint; v_tax bigint; v_orig bigint; v_credited bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN PERFORM raise_business_error('invoice_not_deletable'); END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'draft' AND NEW.status = 'issued' THEN
    SELECT count(*), COALESCE(sum(amount), 0), COALESCE(sum(tax_amount), 0)
      INTO v_lines, v_sub, v_tax FROM invoice_lines WHERE hotel_id = NEW.hotel_id AND invoice_id = NEW.id;
    IF v_lines = 0 THEN PERFORM raise_business_error('invoice_without_lines'); END IF;
    IF v_sub <> NEW.subtotal_amount OR v_tax <> NEW.tax_amount THEN
      PERFORM raise_business_error('invoice_totals_mismatch');
    END IF;
    IF NEW.kind = 'credit_note' THEN
      SELECT total_amount INTO v_orig FROM invoices
        WHERE hotel_id = NEW.hotel_id AND id = NEW.credit_for_invoice_id AND kind = 'invoice' AND status = 'issued';
      IF NOT FOUND THEN PERFORM raise_business_error('credit_note_invalid_target'); END IF;
      SELECT COALESCE(sum(total_amount), 0) INTO v_credited FROM invoices
        WHERE hotel_id = NEW.hotel_id AND credit_for_invoice_id = NEW.credit_for_invoice_id
          AND kind = 'credit_note' AND status = 'issued' AND id <> NEW.id;
      IF v_credited + NEW.total_amount > v_orig THEN PERFORM raise_business_error('credit_exceeds_invoice'); END IF;
    END IF;
  ELSIF OLD.status IN ('issued', 'void') THEN
    IF NOT (NEW.status = OLD.status OR (OLD.status = 'issued' AND NEW.status = 'void')) THEN
      PERFORM raise_business_error('invoice_status_transition_invalid');
    END IF;
    IF ROW(NEW.number, NEW.hotel_id, NEW.kind, NEW.currency, NEW.subtotal_amount, NEW.tax_amount, NEW.total_amount,
           NEW.issued_at, NEW.folio_id, NEW.credit_for_invoice_id)
       IS DISTINCT FROM
       ROW(OLD.number, OLD.hotel_id, OLD.kind, OLD.currency, OLD.subtotal_amount, OLD.tax_amount, OLD.total_amount,
           OLD.issued_at, OLD.folio_id, OLD.credit_for_invoice_id) THEN
      PERFORM raise_business_error('invoice_immutable');
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_invoices_guard BEFORE UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION invoices_guard();

CREATE FUNCTION invoice_lines_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM invoices
    WHERE hotel_id = COALESCE(NEW.hotel_id, OLD.hotel_id) AND id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF v_status IS NOT NULL AND v_status <> 'draft' THEN PERFORM raise_business_error('invoice_immutable'); END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER trg_invoice_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON invoice_lines
  FOR EACH ROW EXECUTE FUNCTION invoice_lines_guard();

-- Une charge déjà facturée (facture émise) ne peut plus changer de montant
CREATE FUNCTION folio_charges_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.invoice_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM invoices WHERE hotel_id = OLD.hotel_id AND id = OLD.invoice_id AND status = 'issued')
     AND ROW(NEW.amount, NEW.tax_amount, NEW.quantity, NEW.unit_amount, NEW.folio_id)
         IS DISTINCT FROM ROW(OLD.amount, OLD.tax_amount, OLD.quantity, OLD.unit_amount, OLD.folio_id) THEN
    PERFORM raise_business_error('charge_already_invoiced');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_folio_charges_guard BEFORE UPDATE ON folio_charges
  FOR EACH ROW EXECUTE FUNCTION folio_charges_guard();

-- ---------------------------------------------------------------------------
-- Paiements (grand livre en ajout seul)
-- ---------------------------------------------------------------------------
CREATE TABLE payments (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id                 uuid NOT NULL REFERENCES hotels (id),
  folio_id                 uuid,
  invoice_id               uuid,
  -- Paiement direct d'une commande restaurant (hors folio) ; la clé étrangère est posée en 0009
  order_id                 uuid,
  kind                     text NOT NULL CHECK (kind IN ('deposit', 'payment', 'refund')),
  method_code              text NOT NULL,
  -- Montant encaissé dans sa devise, taux appliqué et contre-valeur dans la devise de base (utilisée par les soldes)
  amount                   bigint NOT NULL CHECK (amount > 0),
  currency                 char(3) NOT NULL REFERENCES currencies (code),
  exchange_rate            numeric(18, 8) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),
  base_amount              bigint NOT NULL CHECK (base_amount > 0),
  -- Saisie manuelle par la réception (n° de transaction Mobile Money, de reçu CB…) : aucune connexion automatique n'est supposée
  reference                text,
  status                   text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending', 'confirmed', 'failed')),
  refund_of_payment_id     uuid,
  reason                   text,
  received_at              timestamptz NOT NULL DEFAULT now(),
  received_by_membership_id uuid,
  idempotency_key          text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, id),
  FOREIGN KEY (hotel_id, folio_id) REFERENCES folios (hotel_id, id),
  FOREIGN KEY (hotel_id, invoice_id) REFERENCES invoices (hotel_id, id),
  FOREIGN KEY (hotel_id, method_code) REFERENCES payment_methods (hotel_id, code),
  FOREIGN KEY (hotel_id, refund_of_payment_id) REFERENCES payments (hotel_id, id),
  FOREIGN KEY (hotel_id, received_by_membership_id) REFERENCES memberships (hotel_id, id),
  CONSTRAINT payment_has_target CHECK (folio_id IS NOT NULL OR order_id IS NOT NULL),
  CONSTRAINT payment_refund_links_original CHECK ((kind = 'refund') = (refund_of_payment_id IS NOT NULL)),
  CONSTRAINT payment_refund_has_reason CHECK (kind <> 'refund' OR reason IS NOT NULL)
);
CREATE UNIQUE INDEX payments_idempotency_uq ON payments (hotel_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX payments_folio_idx ON payments (hotel_id, folio_id);
CREATE INDEX payments_received_idx ON payments (hotel_id, received_at DESC);

CREATE FUNCTION payments_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE v_parent payments%ROWTYPE; v_refunded bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN PERFORM raise_business_error('payment_not_deletable'); END IF;
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.hotel_id, NEW.folio_id, NEW.invoice_id, NEW.order_id, NEW.kind, NEW.method_code, NEW.amount, NEW.currency,
           NEW.exchange_rate, NEW.base_amount, NEW.refund_of_payment_id, NEW.received_at)
       IS DISTINCT FROM
       ROW(OLD.hotel_id, OLD.folio_id, OLD.invoice_id, OLD.order_id, OLD.kind, OLD.method_code, OLD.amount, OLD.currency,
           OLD.exchange_rate, OLD.base_amount, OLD.refund_of_payment_id, OLD.received_at) THEN
      PERFORM raise_business_error('payment_immutable');
    END IF;
    IF OLD.status <> 'pending' AND NEW.status <> OLD.status THEN
      PERFORM raise_business_error('payment_status_transition_invalid');
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.kind = 'refund' THEN
    -- Verrou du paiement d'origine : deux remboursements simultanés ne peuvent pas le dépasser ensemble
    SELECT * INTO v_parent FROM payments WHERE hotel_id = NEW.hotel_id AND id = NEW.refund_of_payment_id FOR UPDATE;
    IF NOT FOUND OR v_parent.kind = 'refund' OR v_parent.status <> 'confirmed' THEN
      PERFORM raise_business_error('refund_invalid_target');
    END IF;
    IF v_parent.currency <> NEW.currency THEN PERFORM raise_business_error('refund_currency_mismatch'); END IF;
    SELECT COALESCE(sum(amount), 0) INTO v_refunded FROM payments
      WHERE hotel_id = NEW.hotel_id AND refund_of_payment_id = v_parent.id AND status IN ('pending', 'confirmed');
    IF v_refunded + NEW.amount > v_parent.amount THEN PERFORM raise_business_error('refund_exceeds_payment'); END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_payments_guard BEFORE INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_guard();

-- Sécurité
SELECT meta.rls_tenant('folios', 'SELECT, INSERT, UPDATE');
SELECT meta.rls_tenant('folio_charges', 'SELECT, INSERT, UPDATE');
SELECT meta.rls_tenant('invoices', 'SELECT, INSERT, UPDATE, DELETE');
SELECT meta.rls_tenant('invoice_lines', 'SELECT, INSERT, UPDATE, DELETE');
SELECT meta.rls_tenant('payments', 'SELECT, INSERT, UPDATE');

SELECT meta.attach_housekeeping_triggers();
