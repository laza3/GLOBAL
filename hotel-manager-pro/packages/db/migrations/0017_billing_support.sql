-- 0017 — Facturation client : la charge d'hébergement d'une option expirée est annulée avec elle
--
-- La note (folio) d'une réservation porte une charge « hébergement » qui suit le total de la réservation. Quand une option expire
-- (annulation automatique), cette charge est annulée aussi, sinon la note afficherait un montant dû pour un séjour qui n'existe plus.

CREATE OR REPLACE FUNCTION expire_tentatives_internal(p_hotel uuid) RETURNS integer
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
  ), voided AS (
    UPDATE folio_charges c SET voided_at = now(), void_reason = 'Option expirée'
      FROM expired e WHERE c.hotel_id = e.hotel_id AND c.source = 'reservation' AND c.source_ref = e.id
       AND c.voided_at IS NULL AND c.invoice_id IS NULL
    RETURNING 1
  ), logged AS (
    INSERT INTO audit_logs (hotel_id, action, entity_type, entity_id, summary)
    SELECT hotel_id, 'reservation.option_expired', 'reservation', id, 'Option expirée : ' || reference FROM expired
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_count FROM expired;
  RETURN v_count;
END $$;
