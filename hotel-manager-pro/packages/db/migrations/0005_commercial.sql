-- 0005 — Couche commerciale SaaS : abonnements, factures SaaS, paiements, licences, support
--
-- Principes :
--  * Les hôtels LISENT leur abonnement/factures/licence ; seule la plateforme les écrit.
--    Exceptions étroites : déclarer un paiement, demander un changement de forfait, ouvrir un ticket.
--  * Aucun statut « payé » stocké : le payé est CALCULÉ depuis les transactions confirmées (vue en 0010).
--  * Une transaction « confirmed » exige une validation humaine (administrateur) OU un événement réel
--    d'un prestataire connecté (provider_event_id). Aucun paiement ne peut être « simulé ».

-- ---------------------------------------------------------------------------
-- Abonnements
-- ---------------------------------------------------------------------------
CREATE TABLE subscriptions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id             uuid NOT NULL REFERENCES hotels (id),
  plan_id              uuid NOT NULL REFERENCES plans (id),
  plan_price_id        uuid REFERENCES plan_prices (id),
  status               text NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'cancelled', 'expired')),
  billing_interval     text NOT NULL CHECK (billing_interval IN ('month', 'year')),
  currency             char(3) NOT NULL REFERENCES currencies (code),
  -- Prix copié à la souscription (par période de facturation) : un changement de tarif catalogue ne le modifie pas
  price_amount         bigint NOT NULL CHECK (price_amount >= 0),
  discount_amount      bigint NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  started_at           timestamptz NOT NULL DEFAULT now(),
  trial_ends_at        timestamptz,
  current_period_start timestamptz NOT NULL,
  current_period_end   timestamptz NOT NULL,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  cancelled_at         timestamptz,
  cancel_reason        text,
  ended_at             timestamptz,
  -- Génère automatiquement la facture de renouvellement avant l'échéance (le paiement reste à valider)
  auto_invoice         boolean NOT NULL DEFAULT true,
  notes                text,
  version              integer NOT NULL DEFAULT 1,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, id),
  CONSTRAINT subscription_period_valid CHECK (current_period_end > current_period_start),
  CONSTRAINT subscription_discount_valid CHECK (discount_amount <= price_amount),
  CONSTRAINT subscription_trial_has_end CHECK (status <> 'trialing' OR trial_ends_at IS NOT NULL),
  CONSTRAINT subscription_ended_has_date CHECK (status NOT IN ('cancelled', 'expired') OR ended_at IS NOT NULL)
);
-- Un seul abonnement « vivant » par établissement ; les autres lignes forment l'historique
CREATE UNIQUE INDEX subscriptions_one_live_per_hotel
  ON subscriptions (hotel_id) WHERE status IN ('trialing', 'active', 'past_due');
CREATE INDEX subscriptions_status_end_idx ON subscriptions (status, current_period_end);

-- Historique append-only des abonnements
CREATE TABLE subscription_events (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  hotel_id        uuid NOT NULL REFERENCES hotels (id),
  subscription_id uuid NOT NULL,
  event_type      text NOT NULL CHECK (event_type IN (
    'trial_started', 'trial_extended', 'activated', 'renewed', 'plan_changed', 'price_changed',
    'cancel_requested', 'cancelled', 'expired', 'past_due', 'reactivated', 'suspended', 'resumed')),
  from_plan_id    uuid REFERENCES plans (id),
  to_plan_id      uuid REFERENCES plans (id),
  from_status     text,
  to_status       text,
  actor_type      text NOT NULL CHECK (actor_type IN ('system', 'platform_admin', 'hotel_user')),
  actor_id        uuid,
  details         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (hotel_id, subscription_id) REFERENCES subscriptions (hotel_id, id)
);
CREATE INDEX subscription_events_sub_idx ON subscription_events (subscription_id, created_at DESC);
CREATE INDEX subscription_events_hotel_idx ON subscription_events (hotel_id, created_at DESC);

-- Demande de changement de formule émise par l'hôtel, traitée par la plateforme
CREATE TABLE plan_change_requests (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id             uuid NOT NULL REFERENCES hotels (id),
  subscription_id      uuid,
  from_plan_id         uuid REFERENCES plans (id),
  to_plan_id           uuid NOT NULL REFERENCES plans (id),
  to_interval          text NOT NULL CHECK (to_interval IN ('month', 'year')),
  status               text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'applied', 'cancelled')),
  requested_by_user_id uuid REFERENCES users (id),
  requested_at         timestamptz NOT NULL DEFAULT now(),
  decided_by_admin_id  uuid REFERENCES platform_admins (id),
  decided_at           timestamptz,
  effective_at         timestamptz,
  decision_notes       text,
  message              text,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (hotel_id, subscription_id) REFERENCES subscriptions (hotel_id, id)
);
CREATE INDEX plan_change_requests_hotel_idx ON plan_change_requests (hotel_id, requested_at DESC);

-- ---------------------------------------------------------------------------
-- Factures SaaS (plateforme -> établissement)
-- ---------------------------------------------------------------------------
CREATE TABLE saas_invoices (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id            uuid NOT NULL REFERENCES hotels (id),
  subscription_id     uuid,
  -- Numérotation séquentielle sans trou attribuée à l'émission (next_platform_counter)
  number              text UNIQUE,
  kind                text NOT NULL DEFAULT 'subscription' CHECK (kind IN ('subscription', 'plan_change', 'license', 'other')),
  -- Statut du DOCUMENT ; l'état de paiement est calculé (vue saas_invoice_balances)
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'void')),
  currency            char(3) NOT NULL REFERENCES currencies (code),
  subtotal_amount     bigint NOT NULL DEFAULT 0,
  tax_amount          bigint NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount        bigint NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  period_start        timestamptz,
  period_end          timestamptz,
  issued_at           timestamptz,
  due_at              timestamptz,
  voided_at           timestamptz,
  void_reason         text,
  billing_snapshot    jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes               text,
  created_by_admin_id uuid REFERENCES platform_admins (id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, id),
  FOREIGN KEY (hotel_id, subscription_id) REFERENCES subscriptions (hotel_id, id),
  CONSTRAINT saas_invoice_total_consistent CHECK (total_amount = subtotal_amount + tax_amount),
  CONSTRAINT saas_invoice_issued_has_number CHECK (status = 'draft' OR (number IS NOT NULL AND issued_at IS NOT NULL)),
  CONSTRAINT saas_invoice_void_has_reason CHECK (status <> 'void' OR (voided_at IS NOT NULL AND void_reason IS NOT NULL))
);
CREATE INDEX saas_invoices_hotel_idx ON saas_invoices (hotel_id, created_at DESC);

CREATE TABLE saas_invoice_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  saas_invoice_id uuid NOT NULL,
  hotel_id        uuid NOT NULL REFERENCES hotels (id),
  position        integer NOT NULL DEFAULT 0,
  description     text NOT NULL,
  quantity        numeric(12, 3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_amount     bigint NOT NULL,
  -- Montant net de la ligne (négatif pour une remise), taxe de la ligne
  amount          bigint NOT NULL,
  tax_amount      bigint NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  FOREIGN KEY (hotel_id, saas_invoice_id) REFERENCES saas_invoices (hotel_id, id) ON DELETE CASCADE
);
CREATE INDEX saas_invoice_lines_invoice_idx ON saas_invoice_lines (saas_invoice_id);

-- Immutabilité d'une facture émise : jamais modifiée, jamais supprimée ; seule l'annulation (issued -> void) est possible
CREATE FUNCTION saas_invoices_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE v_sub bigint; v_tax bigint; v_lines integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN PERFORM raise_business_error('invoice_not_deletable'); END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'draft' AND NEW.status = 'issued' THEN
    SELECT count(*), COALESCE(sum(amount), 0), COALESCE(sum(tax_amount), 0)
      INTO v_lines, v_sub, v_tax FROM saas_invoice_lines WHERE saas_invoice_id = NEW.id;
    IF v_lines = 0 THEN PERFORM raise_business_error('invoice_without_lines'); END IF;
    IF v_sub <> NEW.subtotal_amount OR v_tax <> NEW.tax_amount THEN
      PERFORM raise_business_error('invoice_totals_mismatch');
    END IF;
  ELSIF OLD.status IN ('issued', 'void') THEN
    IF NOT (NEW.status = OLD.status OR (OLD.status = 'issued' AND NEW.status = 'void')) THEN
      PERFORM raise_business_error('invoice_status_transition_invalid');
    END IF;
    IF ROW(NEW.number, NEW.hotel_id, NEW.kind, NEW.currency, NEW.subtotal_amount, NEW.tax_amount, NEW.total_amount, NEW.issued_at, NEW.due_at)
       IS DISTINCT FROM
       ROW(OLD.number, OLD.hotel_id, OLD.kind, OLD.currency, OLD.subtotal_amount, OLD.tax_amount, OLD.total_amount, OLD.issued_at, OLD.due_at) THEN
      PERFORM raise_business_error('invoice_immutable');
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_saas_invoices_guard BEFORE UPDATE OR DELETE ON saas_invoices
  FOR EACH ROW EXECUTE FUNCTION saas_invoices_guard();

CREATE FUNCTION saas_invoice_lines_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM saas_invoices WHERE id = COALESCE(NEW.saas_invoice_id, OLD.saas_invoice_id);
  IF v_status IS NOT NULL AND v_status <> 'draft' THEN PERFORM raise_business_error('invoice_immutable'); END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER trg_saas_invoice_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON saas_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION saas_invoice_lines_guard();

-- ---------------------------------------------------------------------------
-- Paiements SaaS
-- ---------------------------------------------------------------------------
CREATE TABLE saas_payments (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id               uuid NOT NULL REFERENCES hotels (id),
  saas_invoice_id        uuid,
  method                 text NOT NULL REFERENCES payment_connectors (code),
  amount                 bigint NOT NULL CHECK (amount > 0),
  currency               char(3) NOT NULL REFERENCES currencies (code),
  status                 text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'awaiting_validation', 'confirmed', 'rejected', 'failed', 'refunded')),
  -- Référence de la transaction fournie par le payeur (n° de transfert, id MVola…) ; vérifiée par l'administrateur
  external_reference     text,
  payer_name             text,
  payer_phone            text,
  proof_file_id          uuid,
  submitted_by_user_id   uuid REFERENCES users (id),
  submitted_at           timestamptz,
  -- Validation manuelle (tant qu'aucun prestataire n'est réellement connecté)
  validated_by_admin_id  uuid REFERENCES platform_admins (id),
  validated_at           timestamptz,
  rejection_reason       text,
  -- Confirmation automatique : uniquement par un événement signé d'un prestataire connecté
  provider_code          text,
  provider_event_id      text,
  provider_payload       jsonb,
  idempotency_key        text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (hotel_id, proof_file_id) REFERENCES files (hotel_id, id),
  FOREIGN KEY (hotel_id, saas_invoice_id) REFERENCES saas_invoices (hotel_id, id),
  CONSTRAINT saas_payment_confirmation_is_real CHECK (
    status <> 'confirmed'
    OR (validated_by_admin_id IS NOT NULL AND validated_at IS NOT NULL)
    OR (provider_code IS NOT NULL AND provider_event_id IS NOT NULL)),
  CONSTRAINT saas_payment_needs_reference CHECK (
    method IN ('cash', 'other') OR status IN ('pending', 'rejected', 'failed') OR external_reference IS NOT NULL),
  CONSTRAINT saas_payment_rejected_has_reason CHECK (status <> 'rejected' OR rejection_reason IS NOT NULL)
);
CREATE UNIQUE INDEX saas_payments_provider_event_uq
  ON saas_payments (provider_code, provider_event_id) WHERE provider_event_id IS NOT NULL;
CREATE UNIQUE INDEX saas_payments_idempotency_uq
  ON saas_payments (hotel_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX saas_payments_invoice_idx ON saas_payments (saas_invoice_id);
CREATE INDEX saas_payments_status_idx ON saas_payments (status, created_at DESC);

CREATE FUNCTION saas_payments_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE v_inv record;
BEGIN
  IF TG_OP = 'DELETE' THEN PERFORM raise_business_error('payment_not_deletable'); END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.saas_invoice_id IS NOT NULL THEN
      SELECT status, currency, hotel_id INTO v_inv FROM saas_invoices WHERE id = NEW.saas_invoice_id;
      IF NOT FOUND THEN PERFORM raise_business_error('invoice_not_found'); END IF;
      IF v_inv.hotel_id <> NEW.hotel_id THEN PERFORM raise_business_error('invoice_not_found'); END IF;
      IF v_inv.status <> 'issued' THEN PERFORM raise_business_error('invoice_not_payable'); END IF;
      IF v_inv.currency <> NEW.currency THEN PERFORM raise_business_error('payment_currency_mismatch'); END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.hotel_id, NEW.saas_invoice_id, NEW.method, NEW.amount, NEW.currency)
     IS DISTINCT FROM ROW(OLD.hotel_id, OLD.saas_invoice_id, OLD.method, OLD.amount, OLD.currency) THEN
    PERFORM raise_business_error('payment_immutable');
  END IF;
  IF OLD.status = 'confirmed' AND NEW.status NOT IN ('confirmed', 'refunded') THEN
    PERFORM raise_business_error('payment_status_transition_invalid');
  END IF;
  IF OLD.status IN ('rejected', 'failed', 'refunded') AND NEW.status <> OLD.status THEN
    PERFORM raise_business_error('payment_status_transition_invalid');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_saas_payments_guard BEFORE INSERT OR UPDATE OR DELETE ON saas_payments
  FOR EACH ROW EXECUTE FUNCTION saas_payments_guard();

-- ---------------------------------------------------------------------------
-- Licences définitives (conditions distinctes de l'abonnement)
-- ---------------------------------------------------------------------------
-- Une licence est rattachée à UN établissement : droit d'usage perpétuel d'une édition, avec limites et
-- fonctionnalités figées. Les mises à jour et le support sont couverts jusqu'à maintenance_until.
CREATE TABLE licenses (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id           uuid NOT NULL REFERENCES hotels (id),
  -- La clé n'est montrée qu'une fois à l'émission ; seul son empreinte est conservée
  key_hash           text NOT NULL UNIQUE,
  key_prefix         text NOT NULL,
  edition_code       text NOT NULL,
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended', 'revoked')),
  issued_at          timestamptz NOT NULL DEFAULT now(),
  activated_at       timestamptz,
  max_rooms          integer CHECK (max_rooms IS NULL OR max_rooms > 0),
  max_users          integer CHECK (max_users IS NULL OR max_users > 0),
  max_properties     integer NOT NULL DEFAULT 1 CHECK (max_properties > 0),
  features           jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(features) = 'object'),
  maintenance_until  timestamptz,
  hosting_included   boolean NOT NULL DEFAULT true,
  terms              text,
  price_amount       bigint CHECK (price_amount IS NULL OR price_amount >= 0),
  currency           char(3) REFERENCES currencies (code),
  saas_invoice_id    uuid,
  revoked_at         timestamptz,
  revoked_reason     text,
  notes              text,
  created_by_admin_id uuid REFERENCES platform_admins (id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, id),
  FOREIGN KEY (hotel_id, saas_invoice_id) REFERENCES saas_invoices (hotel_id, id),
  CONSTRAINT license_active_has_date CHECK (status <> 'active' OR activated_at IS NOT NULL),
  CONSTRAINT license_revoked_has_reason CHECK (status <> 'revoked' OR (revoked_at IS NOT NULL AND revoked_reason IS NOT NULL))
);
CREATE UNIQUE INDEX licenses_one_active_per_hotel ON licenses (hotel_id) WHERE status = 'active';

CREATE TABLE license_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  hotel_id    uuid NOT NULL REFERENCES hotels (id),
  license_id  uuid NOT NULL,
  event_type  text NOT NULL CHECK (event_type IN ('issued', 'activated', 'suspended', 'reinstated', 'revoked', 'maintenance_extended', 'limits_changed')),
  admin_id    uuid REFERENCES platform_admins (id),
  details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (hotel_id, license_id) REFERENCES licenses (hotel_id, id)
);

-- ---------------------------------------------------------------------------
-- Support
-- ---------------------------------------------------------------------------
CREATE SEQUENCE support_ticket_seq;
GRANT USAGE ON SEQUENCE support_ticket_seq TO hmp_app, hmp_platform;

CREATE TABLE support_tickets (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id             uuid NOT NULL REFERENCES hotels (id),
  number               text NOT NULL UNIQUE DEFAULT ('SUP-' || lpad(nextval('support_ticket_seq')::text, 6, '0')),
  subject              text NOT NULL CHECK (length(btrim(subject)) BETWEEN 3 AND 200),
  category             text NOT NULL DEFAULT 'other' CHECK (category IN ('billing', 'technical', 'account', 'feature_request', 'other')),
  priority             text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status               text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'waiting_customer', 'resolved', 'closed')),
  created_by_user_id   uuid REFERENCES users (id),
  assigned_admin_id    uuid REFERENCES platform_admins (id),
  first_response_at    timestamptz,
  resolved_at          timestamptz,
  closed_at            timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, id)
);
CREATE INDEX support_tickets_hotel_idx ON support_tickets (hotel_id, created_at DESC);
CREATE INDEX support_tickets_status_idx ON support_tickets (status, priority, created_at DESC);

CREATE TABLE support_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id        uuid NOT NULL,
  hotel_id         uuid NOT NULL REFERENCES hotels (id),
  author_kind      text NOT NULL CHECK (author_kind IN ('hotel_user', 'platform_admin', 'system')),
  author_user_id   uuid REFERENCES users (id),
  author_admin_id  uuid REFERENCES platform_admins (id),
  body             text NOT NULL CHECK (length(btrim(body)) > 0),
  -- Note interne : visible de la plateforme uniquement, jamais de l'hôtel
  is_internal      boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (hotel_id, ticket_id) REFERENCES support_tickets (hotel_id, id),
  CONSTRAINT support_message_hotel_not_internal CHECK (author_kind <> 'hotel_user' OR NOT is_internal),
  CONSTRAINT support_message_author_matches CHECK (
    (author_kind = 'hotel_user' AND author_user_id IS NOT NULL)
    OR (author_kind = 'platform_admin' AND author_admin_id IS NOT NULL)
    OR author_kind = 'system')
);
CREATE INDEX support_messages_ticket_idx ON support_messages (ticket_id, created_at);

-- ---------------------------------------------------------------------------
-- Essai gratuit : seule façon pour un établissement de créer SON abonnement (plateforme = seule autre voie)
-- ---------------------------------------------------------------------------
CREATE FUNCTION start_trial(p_plan_code text DEFAULT NULL) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_hotel   uuid := app_hotel_id();
  v_code    text;
  v_plan    plans%ROWTYPE;
  v_days    integer;
  v_cur     char(3);
  v_price   plan_prices%ROWTYPE;
  v_sub     uuid;
  v_now     timestamptz := now();
BEGIN
  IF v_hotel IS NULL THEN PERFORM raise_business_error('tenant_context_missing'); END IF;
  IF NOT EXISTS (SELECT 1 FROM hotels WHERE id = v_hotel AND status IN ('onboarding', 'active')) THEN
    PERFORM raise_business_error('hotel_not_eligible');
  END IF;
  IF EXISTS (SELECT 1 FROM subscriptions WHERE hotel_id = v_hotel) THEN
    PERFORM raise_business_error('trial_already_used');
  END IF;
  IF COALESCE((SELECT (value #>> '{}')::boolean FROM platform_settings WHERE key = 'trial.enabled'), true) IS NOT TRUE THEN
    PERFORM raise_business_error('trial_disabled');
  END IF;

  v_code := COALESCE(p_plan_code, (SELECT value #>> '{}' FROM platform_settings WHERE key = 'trial.default_plan_code'), 'starter');
  SELECT * INTO v_plan FROM plans WHERE code = v_code AND is_active AND is_public AND NOT is_custom_priced;
  IF NOT FOUND THEN PERFORM raise_business_error('plan_not_available'); END IF;

  v_days := COALESCE(v_plan.trial_days, (SELECT (value #>> '{}')::integer FROM platform_settings WHERE key = 'trial.default_days'), 14);
  SELECT COALESCE((SELECT default_currency FROM hotel_settings WHERE hotel_id = v_hotel), 'MGA') INTO v_cur;
  SELECT * INTO v_price FROM plan_prices
    WHERE plan_id = v_plan.id AND billing_interval = 'month' AND currency = v_cur AND is_active;

  INSERT INTO subscriptions (hotel_id, plan_id, plan_price_id, status, billing_interval, currency, price_amount,
                             started_at, trial_ends_at, current_period_start, current_period_end)
  VALUES (v_hotel, v_plan.id, v_price.id, 'trialing', 'month', v_cur, COALESCE(v_price.amount, 0),
          v_now, v_now + make_interval(days => v_days), v_now, v_now + make_interval(days => GREATEST(v_days, 1)))
  RETURNING id INTO v_sub;

  INSERT INTO subscription_events (hotel_id, subscription_id, event_type, to_plan_id, to_status, actor_type, actor_id, details)
  VALUES (v_hotel, v_sub, 'trial_started', v_plan.id, 'trialing', 'hotel_user', app_user_id(),
          jsonb_build_object('trial_days', v_days));
  RETURN v_sub;
END $$;
REVOKE ALL ON FUNCTION start_trial(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION start_trial(text) TO hmp_app;

-- ---------------------------------------------------------------------------
-- Sécurité
-- ---------------------------------------------------------------------------
-- Plateforme : accès complet
SELECT meta.rls_platform('subscriptions');
SELECT meta.rls_platform('subscription_events', 'SELECT, INSERT');
SELECT meta.rls_platform('plan_change_requests');
SELECT meta.rls_platform('saas_invoices');
SELECT meta.rls_platform('saas_invoice_lines');
SELECT meta.rls_platform('saas_payments', 'SELECT, INSERT, UPDATE');
SELECT meta.rls_platform('licenses');
SELECT meta.rls_platform('license_events', 'SELECT, INSERT');
SELECT meta.rls_platform('support_tickets');
SELECT meta.rls_platform('support_messages', 'SELECT, INSERT');

-- Établissement : lecture seule de ses propres données commerciales
SELECT meta.rls_tenant('subscriptions', 'SELECT');
SELECT meta.rls_tenant('subscription_events', 'SELECT');
SELECT meta.rls_tenant('licenses', 'SELECT');
SELECT meta.rls_tenant('license_events', 'SELECT');

-- Factures SaaS : l'hôtel ne voit jamais les brouillons
ALTER TABLE saas_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY hotel_read_issued ON saas_invoices AS PERMISSIVE FOR SELECT TO hmp_app
  USING (hotel_id = app_hotel_id() AND status <> 'draft');
GRANT SELECT ON saas_invoices TO hmp_app;

CREATE POLICY hotel_read_issued ON saas_invoice_lines AS PERMISSIVE FOR SELECT TO hmp_app
  USING (hotel_id = app_hotel_id()
         AND EXISTS (SELECT 1 FROM saas_invoices i WHERE i.id = saas_invoice_id AND i.status <> 'draft'));
GRANT SELECT ON saas_invoice_lines TO hmp_app;

-- Paiements SaaS : l'hôtel peut DÉCLARER un paiement (jamais le confirmer)
CREATE POLICY hotel_read ON saas_payments AS PERMISSIVE FOR SELECT TO hmp_app
  USING (hotel_id = app_hotel_id());
CREATE POLICY hotel_declare ON saas_payments AS PERMISSIVE FOR INSERT TO hmp_app
  WITH CHECK (hotel_id = app_hotel_id()
              AND status IN ('pending', 'awaiting_validation')
              AND validated_by_admin_id IS NULL AND validated_at IS NULL
              AND provider_code IS NULL AND provider_event_id IS NULL);
CREATE POLICY hotel_complete_declaration ON saas_payments AS PERMISSIVE FOR UPDATE TO hmp_app
  USING (hotel_id = app_hotel_id() AND status IN ('pending', 'awaiting_validation'))
  WITH CHECK (hotel_id = app_hotel_id() AND status IN ('pending', 'awaiting_validation'));
GRANT SELECT ON saas_payments TO hmp_app;
GRANT INSERT (hotel_id, saas_invoice_id, method, amount, currency, status, external_reference, payer_name,
              payer_phone, proof_file_id, submitted_by_user_id, submitted_at, idempotency_key) ON saas_payments TO hmp_app;
GRANT UPDATE (status, external_reference, payer_name, payer_phone, proof_file_id, submitted_at, updated_at) ON saas_payments TO hmp_app;

-- Demandes de changement de formule : l'hôtel crée et peut annuler une demande en attente
ALTER TABLE plan_change_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY hotel_read ON plan_change_requests AS PERMISSIVE FOR SELECT TO hmp_app USING (hotel_id = app_hotel_id());
CREATE POLICY hotel_create ON plan_change_requests AS PERMISSIVE FOR INSERT TO hmp_app
  WITH CHECK (hotel_id = app_hotel_id() AND status = 'pending' AND decided_by_admin_id IS NULL);
CREATE POLICY hotel_cancel ON plan_change_requests AS PERMISSIVE FOR UPDATE TO hmp_app
  USING (hotel_id = app_hotel_id() AND status = 'pending')
  WITH CHECK (hotel_id = app_hotel_id() AND status IN ('pending', 'cancelled'));
GRANT SELECT ON plan_change_requests TO hmp_app;
GRANT INSERT (hotel_id, subscription_id, from_plan_id, to_plan_id, to_interval, requested_by_user_id, message) ON plan_change_requests TO hmp_app;
GRANT UPDATE (status, updated_at) ON plan_change_requests TO hmp_app;

-- Support : l'hôtel ouvre des tickets et répond ; il ne voit jamais les notes internes
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY hotel_read ON support_tickets AS PERMISSIVE FOR SELECT TO hmp_app USING (hotel_id = app_hotel_id());
CREATE POLICY hotel_open ON support_tickets AS PERMISSIVE FOR INSERT TO hmp_app
  WITH CHECK (hotel_id = app_hotel_id() AND status = 'open' AND assigned_admin_id IS NULL);
GRANT SELECT ON support_tickets TO hmp_app;
GRANT INSERT (hotel_id, subject, category, priority, created_by_user_id) ON support_tickets TO hmp_app;

CREATE POLICY hotel_read_public ON support_messages AS PERMISSIVE FOR SELECT TO hmp_app
  USING (hotel_id = app_hotel_id() AND NOT is_internal);
CREATE POLICY hotel_reply ON support_messages AS PERMISSIVE FOR INSERT TO hmp_app
  WITH CHECK (hotel_id = app_hotel_id() AND author_kind = 'hotel_user' AND NOT is_internal
              AND author_user_id = app_user_id());
GRANT SELECT ON support_messages TO hmp_app;
GRANT INSERT (ticket_id, hotel_id, author_kind, author_user_id, body) ON support_messages TO hmp_app;

-- Catalogue : forfaits publics actifs + son propre forfait (même s'il est privé ou retiré)
CREATE POLICY hotel_catalog ON plans AS PERMISSIVE FOR SELECT TO hmp_app
  USING ((is_public AND is_active)
         OR id IN (SELECT plan_id FROM subscriptions WHERE hotel_id = app_hotel_id()));
GRANT SELECT ON plans TO hmp_app;
CREATE POLICY hotel_catalog ON plan_prices AS PERMISSIVE FOR SELECT TO hmp_app
  USING (plan_id IN (SELECT id FROM plans));
GRANT SELECT ON plan_prices TO hmp_app;

SELECT meta.attach_housekeeping_triggers();
