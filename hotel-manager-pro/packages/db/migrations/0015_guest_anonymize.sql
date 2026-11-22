-- 0015 — Anonymisation d'un client (droit à l'effacement)
--
-- Un client n'est JAMAIS supprimé (l'historique des séjours et la comptabilité s'y rattachent) ; on l'anonymise : les données
-- personnelles disparaissent, la ligne et ses références restent. Les notes (en ajout seul : aucun UPDATE accordé à l'API) sont
-- neutralisées ICI, par une fonction étroite — c'est la seule voie, et elle refuse tant qu'un séjour est en cours ou à venir.
-- L'anonymisation s'étend aux fiches fusionnées dans celle-ci (doublons rattachés).

CREATE FUNCTION anonymize_guest(p_guest uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_hotel uuid := app_hotel_id();
  v_ids   uuid[];
BEGIN
  IF v_hotel IS NULL THEN PERFORM raise_business_error('tenant_context_missing'); END IF;

  WITH RECURSIVE family(id) AS (
    SELECT id FROM guests WHERE id = p_guest AND hotel_id = v_hotel
    UNION
    SELECT g.id FROM guests g JOIN family f ON g.merged_into_id = f.id WHERE g.hotel_id = v_hotel
  )
  SELECT array_agg(id) INTO v_ids FROM family;
  IF v_ids IS NULL THEN PERFORM raise_business_error('guest_not_found'); END IF;

  IF EXISTS (
    SELECT 1 FROM reservations r
    WHERE r.hotel_id = v_hotel AND r.guest_id = ANY (v_ids) AND r.status IN ('tentative', 'pending', 'confirmed', 'checked_in')
  ) THEN
    PERFORM raise_business_error('guest_has_active_stays');
  END IF;

  DELETE FROM guest_documents WHERE hotel_id = v_hotel AND guest_id = ANY (v_ids);
  UPDATE guest_notes SET body = '[supprimé]' WHERE hotel_id = v_hotel AND guest_id = ANY (v_ids);
  UPDATE guests
     SET first_name = 'Client', last_name = 'anonymisé', email = NULL, phone = NULL, phone_normalized = NULL, birth_date = NULL,
         address = NULL, city = NULL, country = NULL, nationality = NULL, is_vip = false, tags = '{}', preferences = '{}'::jsonb,
         marketing_consent = false, anonymized_at = now()
   WHERE hotel_id = v_hotel AND id = ANY (v_ids);
END $$;

REVOKE ALL ON FUNCTION anonymize_guest(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION anonymize_guest(uuid) TO hmp_app;
