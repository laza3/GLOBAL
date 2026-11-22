-- 0016 — Réservations : détail des taxes figé, expiration des options
--
-- 1. tax_breakdown : le détail des taxes (règle, montant, incluse ou non) calculé À LA RÉSERVATION et figé, comme les prix par nuit.
--    Une règle de taxe modifiée ensuite ne réécrit jamais une réservation ni une facture déjà établies.
-- 2. Une OPTION (statut « tentative ») bloque la chambre jusqu'à son échéance ; passé ce délai elle est annulée automatiquement,
--    la chambre redevient vendable. Deux fonctions étroites, sans paramètre libre :
--      expire_my_tentatives()   — appelée par l'API avant de chercher de la disponibilité, limitée à l'établissement courant ;
--      expire_all_tentatives()  — appelée par la tâche planifiée de la plateforme (la plateforme n'a toujours AUCUN droit sur les
--                                 tables métier : elle ne peut qu'exécuter cette fonction, qui ne fait que cette transition).

ALTER TABLE reservations ADD COLUMN tax_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb;
-- Remise saisie (sur la base du tarif) : discount_amount en est la part hors taxe ; on garde la saisie pour recalculer exactement
-- quand les chambres ou les dates d'une réservation changent.
ALTER TABLE reservations ADD COLUMN discount_requested bigint NOT NULL DEFAULT 0 CHECK (discount_requested >= 0);

CREATE FUNCTION expire_tentatives_internal(p_hotel uuid) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_count integer;
BEGIN
  WITH expired AS (
    UPDATE reservations
       SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'Option expirée'
     WHERE status = 'tentative' AND tentative_expires_at <= now() AND (p_hotel IS NULL OR hotel_id = p_hotel)
    RETURNING id, hotel_id, reference
  ), released AS (
    UPDATE reservation_rooms rr SET status = 'cancelled'
      FROM expired e WHERE rr.reservation_id = e.id AND rr.hotel_id = e.hotel_id AND rr.status = 'tentative'
    RETURNING 1
  ), logged AS (
    INSERT INTO audit_logs (hotel_id, action, entity_type, entity_id, summary)
    SELECT hotel_id, 'reservation.option_expired', 'reservation', id, 'Option expirée : ' || reference FROM expired
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_count FROM expired;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION expire_tentatives_internal(uuid) FROM PUBLIC;

CREATE FUNCTION expire_my_tentatives() RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF app_hotel_id() IS NULL THEN PERFORM raise_business_error('tenant_context_missing'); END IF;
  RETURN expire_tentatives_internal(app_hotel_id());
END $$;
REVOKE ALL ON FUNCTION expire_my_tentatives() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION expire_my_tentatives() TO hmp_app;

CREATE FUNCTION expire_all_tentatives() RETURNS integer
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT expire_tentatives_internal(NULL)
$$;
REVOKE ALL ON FUNCTION expire_all_tentatives() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION expire_all_tentatives() TO hmp_platform;
