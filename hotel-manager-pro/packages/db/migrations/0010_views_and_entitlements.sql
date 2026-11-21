-- 0010 — Vues de calcul (statuts dérivés, soldes, droits d'usage, revenus récurrents) et application des limites
--
-- Les vues « security_invoker » s'exécutent avec les droits (et donc la RLS) de l'appelant : un hôtel ne voit
-- que ses lignes. Seule platform_hotel_directory est « définisseur » : elle expose à la plateforme un
-- annuaire agrégé SANS aucune donnée client (pas de clients, pas de réservations).

-- ---------------------------------------------------------------------------
-- Droits d'usage effectifs d'un établissement : licence définitive > abonnement > aucun
-- ---------------------------------------------------------------------------
-- NULL sur une limite = illimité. « none » = limites à 0 et aucune fonctionnalité.
-- is_current est calculé à partir des dates : une échéance dépassée n'ouvre plus de droits,
-- même si la tâche de bascule d'état n'a pas encore tourné.
CREATE VIEW hotel_entitlements WITH (security_invoker = true) AS
SELECT
  h.id AS hotel_id,
  CASE WHEN l.id IS NOT NULL THEN 'license' WHEN s.id IS NOT NULL THEN 'subscription' ELSE 'none' END AS source,
  CASE WHEN l.id IS NOT NULL THEN l.edition_code WHEN s.id IS NOT NULL THEN p.code END AS plan_code,
  CASE WHEN l.id IS NOT NULL THEN l.max_rooms WHEN s.id IS NOT NULL THEN p.max_rooms ELSE 0 END AS max_rooms,
  CASE WHEN l.id IS NOT NULL THEN l.max_users WHEN s.id IS NOT NULL THEN p.max_users ELSE 0 END AS max_users,
  CASE WHEN l.id IS NOT NULL THEN l.features WHEN s.id IS NOT NULL THEN p.features ELSE '{}'::jsonb END AS features,
  (l.id IS NOT NULL) AS is_perpetual,
  CASE WHEN l.id IS NOT NULL THEN NULL
       WHEN s.id IS NOT NULL THEN (CASE WHEN s.status = 'trialing' THEN s.trial_ends_at ELSE s.current_period_end END)
  END AS valid_until,
  CASE WHEN l.id IS NOT NULL THEN true
       WHEN s.id IS NOT NULL THEN (CASE WHEN s.status = 'trialing' THEN s.trial_ends_at ELSE s.current_period_end END) > now()
       ELSE false
  END AS is_current,
  s.status AS subscription_status,
  l.maintenance_until AS license_maintenance_until,
  CASE WHEN l.id IS NOT NULL THEN (l.maintenance_until IS NULL OR l.maintenance_until > now()) ELSE NULL END AS license_support_active
FROM hotels h
LEFT JOIN LATERAL (
  SELECT * FROM licenses lc WHERE lc.hotel_id = h.id AND lc.status = 'active' ORDER BY lc.issued_at DESC LIMIT 1
) l ON true
LEFT JOIN LATERAL (
  SELECT * FROM subscriptions sb WHERE sb.hotel_id = h.id AND sb.status IN ('trialing', 'active', 'past_due') LIMIT 1
) s ON true
LEFT JOIN plans p ON p.id = s.plan_id;

-- Application des limites au niveau base (un contournement de l'API ne suffit pas)
CREATE FUNCTION enforce_room_limit() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_max integer; v_count integer; v_found boolean;
BEGIN
  IF NEW.is_archived THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NOT OLD.is_archived THEN RETURN NEW; END IF;
  -- Sérialise les créations concurrentes pour un même hôtel (sinon deux insertions peuvent dépasser la limite)
  PERFORM pg_advisory_xact_lock(hashtextextended('room_limit:' || NEW.hotel_id::text, 0));
  SELECT true, e.max_rooms INTO v_found, v_max FROM hotel_entitlements e WHERE e.hotel_id = NEW.hotel_id;
  IF v_found IS NOT TRUE THEN PERFORM raise_business_error('hotel_not_found'); END IF;
  IF v_max IS NULL THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_count FROM rooms WHERE hotel_id = NEW.hotel_id AND NOT is_archived AND id <> NEW.id;
  IF v_count + 1 > v_max THEN PERFORM raise_business_error('room_limit_reached', 'limit=' || v_max); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_enforce_room_limit BEFORE INSERT OR UPDATE OF is_archived ON rooms
  FOR EACH ROW EXECUTE FUNCTION enforce_room_limit();

CREATE FUNCTION enforce_user_limit() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_max integer; v_count integer; v_found boolean;
BEGIN
  IF NEW.status = 'disabled' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status <> 'disabled' THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('user_limit:' || NEW.hotel_id::text, 0));
  SELECT count(*) INTO v_count FROM memberships WHERE hotel_id = NEW.hotel_id AND status IN ('invited', 'active') AND id <> NEW.id;
  -- Le premier compte d'un établissement (son propriétaire) est TOUJOURS autorisé : sans cela, désactiver l'essai
  -- gratuit rendrait toute inscription impossible (le propriétaire serait bloqué avant d'avoir pu payer un forfait).
  -- Les limites s'appliquent à partir du deuxième compte.
  IF v_count = 0 THEN RETURN NEW; END IF;
  SELECT true, e.max_users INTO v_found, v_max FROM hotel_entitlements e WHERE e.hotel_id = NEW.hotel_id;
  IF v_found IS NOT TRUE THEN PERFORM raise_business_error('hotel_not_found'); END IF;
  IF v_max IS NULL THEN RETURN NEW; END IF;
  IF v_count + 1 > v_max THEN PERFORM raise_business_error('user_limit_reached', 'limit=' || v_max); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_enforce_user_limit BEFORE INSERT OR UPDATE OF status ON memberships
  FOR EACH ROW EXECUTE FUNCTION enforce_user_limit();

-- ---------------------------------------------------------------------------
-- Factures SaaS : l'état de paiement est CALCULÉ, jamais stocké
-- ---------------------------------------------------------------------------
CREATE VIEW saas_invoice_balances WITH (security_invoker = true) AS
SELECT
  i.id AS invoice_id, i.hotel_id, i.number, i.status, i.currency, i.total_amount, i.due_at,
  COALESCE(p.paid, 0) AS amount_paid,
  GREATEST(i.total_amount - COALESCE(p.paid, 0), 0) AS balance_due,
  CASE
    WHEN i.status = 'draft' THEN 'draft'
    WHEN i.status = 'void' THEN 'void'
    WHEN i.total_amount = 0 THEN 'no_payment_due'
    WHEN COALESCE(p.paid, 0) >= i.total_amount THEN 'paid'
    WHEN COALESCE(p.paid, 0) > 0 THEN 'partially_paid'
    ELSE 'unpaid'
  END AS payment_status,
  (i.status = 'issued' AND i.due_at IS NOT NULL AND i.due_at < now()
   AND COALESCE(p.paid, 0) < i.total_amount) AS is_overdue
FROM saas_invoices i
LEFT JOIN (
  SELECT saas_invoice_id, sum(amount) AS paid
  FROM saas_payments WHERE status = 'confirmed' AND saas_invoice_id IS NOT NULL GROUP BY saas_invoice_id
) p ON p.saas_invoice_id = i.id;

-- Revenus récurrents (MRR/ARR) par devise — aucune conversion de devise n'est supposée.
-- Convention : abonnements « active » et « past_due » (impayé non encore résilié) ; les essais ne comptent pas.
CREATE VIEW platform_mrr WITH (security_invoker = true) AS
SELECT
  currency,
  count(*) AS subscriptions,
  round(sum(CASE billing_interval
              WHEN 'month' THEN (price_amount - discount_amount)::numeric
              ELSE (price_amount - discount_amount)::numeric / 12 END))::bigint AS mrr,
  round(sum(CASE billing_interval
              WHEN 'month' THEN (price_amount - discount_amount)::numeric * 12
              ELSE (price_amount - discount_amount)::numeric END))::bigint AS arr
FROM subscriptions
WHERE status IN ('active', 'past_due')
GROUP BY currency;

-- ---------------------------------------------------------------------------
-- Facturation de l'établissement : soldes calculés depuis les transactions
-- ---------------------------------------------------------------------------
CREATE VIEW folio_balances WITH (security_invoker = true) AS
SELECT
  f.hotel_id, f.id AS folio_id, f.reservation_id, f.currency,
  COALESCE(c.total, 0) AS charges_total,
  COALESCE(p.net_paid, 0) AS payments_total,
  COALESCE(c.total, 0) - COALESCE(p.net_paid, 0) AS balance_due,
  CASE
    WHEN COALESCE(c.total, 0) = 0 THEN 'no_charges'
    WHEN COALESCE(p.net_paid, 0) >= c.total THEN 'paid'
    WHEN COALESCE(p.net_paid, 0) > 0 THEN 'partially_paid'
    ELSE 'unpaid'
  END AS payment_status
FROM folios f
LEFT JOIN (
  SELECT hotel_id, folio_id, sum(amount + tax_amount) AS total
  FROM folio_charges WHERE voided_at IS NULL GROUP BY hotel_id, folio_id
) c ON c.hotel_id = f.hotel_id AND c.folio_id = f.id
LEFT JOIN (
  SELECT hotel_id, folio_id,
         sum(CASE WHEN kind = 'refund' THEN -base_amount ELSE base_amount END) AS net_paid
  FROM payments WHERE status = 'confirmed' AND folio_id IS NOT NULL GROUP BY hotel_id, folio_id
) p ON p.hotel_id = f.hotel_id AND p.folio_id = f.id;

-- Soldes de facture : les paiements du folio sont imputés dans l'ordre d'émission des factures (FIFO),
-- les avoirs émis réduisent le montant dû. « Payée » = couverte par des paiements CONFIRMÉS.
CREATE VIEW invoice_balances WITH (security_invoker = true) AS
WITH credited AS (
  SELECT hotel_id, credit_for_invoice_id AS invoice_id, sum(total_amount) AS credited
  FROM invoices WHERE kind = 'credit_note' AND status = 'issued' GROUP BY hotel_id, credit_for_invoice_id
), inv AS (
  SELECT i.hotel_id, i.id AS invoice_id, i.folio_id, i.number, i.currency, i.total_amount, i.issued_at, i.due_at,
         i.total_amount - COALESCE(c.credited, 0) AS effective_total
  FROM invoices i
  LEFT JOIN credited c ON c.hotel_id = i.hotel_id AND c.invoice_id = i.id
  WHERE i.kind = 'invoice' AND i.status = 'issued'
), alloc AS (
  SELECT inv.*,
         COALESCE(sum(inv.effective_total) OVER (
           PARTITION BY inv.hotel_id, inv.folio_id ORDER BY inv.issued_at, inv.invoice_id
           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS prior_total
  FROM inv
), paid AS (
  SELECT hotel_id, folio_id, sum(CASE WHEN kind = 'refund' THEN -base_amount ELSE base_amount END) AS net_paid
  FROM payments WHERE status = 'confirmed' AND folio_id IS NOT NULL GROUP BY hotel_id, folio_id
), calc AS (
  SELECT a.*, GREATEST(0, LEAST(a.effective_total, COALESCE(p.net_paid, 0) - a.prior_total)) AS amount_paid
  FROM alloc a
  LEFT JOIN paid p ON p.hotel_id = a.hotel_id AND p.folio_id = a.folio_id
)
SELECT
  hotel_id, invoice_id, folio_id, number, currency, total_amount, effective_total, amount_paid,
  effective_total - amount_paid AS balance_due,
  CASE
    WHEN effective_total = 0 THEN 'no_payment_due'
    WHEN amount_paid >= effective_total THEN 'paid'
    WHEN amount_paid > 0 THEN 'partially_paid'
    ELSE 'unpaid'
  END AS payment_status,
  (effective_total - amount_paid > 0 AND due_at IS NOT NULL AND due_at < now()) AS is_overdue
FROM calc;

CREATE VIEW reservation_balances WITH (security_invoker = true) AS
SELECT
  r.hotel_id, r.id AS reservation_id, r.reference, r.status, r.currency,
  r.total_amount, r.deposit_required_amount,
  COALESCE(fb.payments_total, 0) AS amount_paid,
  GREATEST(r.total_amount - COALESCE(fb.payments_total, 0), 0) AS balance_due,
  (COALESCE(fb.payments_total, 0) >= r.deposit_required_amount) AS deposit_satisfied
FROM reservations r
LEFT JOIN folio_balances fb ON fb.hotel_id = r.hotel_id AND fb.reservation_id = r.id;

-- ---------------------------------------------------------------------------
-- Statut d'affichage d'une chambre : DÉRIVÉ (jamais synchronisé à la main entre modules)
-- ---------------------------------------------------------------------------
-- Priorité : bloc du jour (maintenance / hors service) > occupée > ménage > réservée (arrivée du jour) > disponible
CREATE VIEW room_status_today WITH (security_invoker = true) AS
SELECT
  r.hotel_id, r.id AS room_id, r.number, r.name, r.category_id, r.floor, r.housekeeping_status,
  CASE
    WHEN blk.reason = 'maintenance' THEN 'maintenance'
    WHEN blk.reason IS NOT NULL THEN 'out_of_service'
    WHEN EXISTS (SELECT 1 FROM reservation_rooms rr
                 WHERE rr.hotel_id = r.hotel_id AND rr.room_id = r.id AND rr.status = 'checked_in') THEN 'occupied'
    WHEN r.housekeeping_status = 'cleaning' THEN 'cleaning'
    WHEN r.housekeeping_status = 'dirty' THEN 'to_clean'
    WHEN EXISTS (SELECT 1 FROM reservation_rooms rr
                 WHERE rr.hotel_id = r.hotel_id AND rr.room_id = r.id
                   AND rr.status IN ('pending', 'confirmed') AND rr.check_in = t.today) THEN 'reserved'
    ELSE 'available'
  END AS display_status
FROM rooms r
JOIN hotel_settings hs ON hs.hotel_id = r.hotel_id
CROSS JOIN LATERAL (SELECT (now() AT TIME ZONE hs.timezone)::date AS today) t
LEFT JOIN LATERAL (
  SELECT a.block_reason AS reason FROM room_allocations a
  WHERE a.room_id = r.id AND a.kind = 'block' AND daterange(a.starts_on, a.ends_on, '[)') @> t.today
  LIMIT 1
) blk ON true
WHERE NOT r.is_archived;

-- ---------------------------------------------------------------------------
-- Annuaire de la plateforme : agrégats uniquement, AUCUNE donnée client / réservation
-- ---------------------------------------------------------------------------
CREATE VIEW platform_hotel_directory AS
SELECT
  h.id AS hotel_id, h.slug, h.name, h.country, h.city, h.status, h.suspended_at, h.suspension_reason, h.created_at,
  o.email AS owner_email, o.full_name AS owner_name,
  (SELECT count(*) FROM rooms rm WHERE rm.hotel_id = h.id AND NOT rm.is_archived) AS rooms_count,
  (SELECT count(*) FROM memberships m WHERE m.hotel_id = h.id AND m.status = 'active') AS users_count,
  e.source AS entitlement_source, e.plan_code, e.valid_until, e.is_current, e.subscription_status
FROM hotels h
LEFT JOIN LATERAL (
  SELECT u.email, u.full_name
  FROM memberships m
  JOIN roles ro ON ro.hotel_id = m.hotel_id AND ro.id = m.role_id AND ro.key = 'owner'
  JOIN users u ON u.id = m.user_id
  WHERE m.hotel_id = h.id
  ORDER BY m.created_at LIMIT 1
) o ON true
LEFT JOIN hotel_entitlements e ON e.hotel_id = h.id;

-- ---------------------------------------------------------------------------
-- Droits
-- ---------------------------------------------------------------------------
GRANT SELECT ON hotel_entitlements, saas_invoice_balances,
                folio_balances, invoice_balances, reservation_balances, room_status_today TO hmp_app;
GRANT SELECT ON hotel_entitlements, saas_invoice_balances, platform_mrr, platform_hotel_directory TO hmp_platform;
