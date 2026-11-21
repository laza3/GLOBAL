-- 0013 — Flux de support : l'état du ticket suit la conversation, sans que l'hôtel puisse le modifier lui-même
--
-- Les hôtels n'ont aucun droit d'UPDATE sur support_tickets (ils ne choisissent pas leur propre statut). Ce déclencheur,
-- propriétaire hmp_owner, applique les seules transitions « naturelles » :
--   * réponse de l'hôtel sur un ticket « en attente du client » ou « résolu » -> il est rouvert
--   * première réponse publique de la plateforme -> first_response_at ; ticket « ouvert » -> « en cours »
-- Les notes internes ne changent jamais l'état visible par l'hôtel.

CREATE FUNCTION support_message_flow() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.author_kind = 'hotel_user' THEN
    UPDATE support_tickets SET status = 'open', resolved_at = NULL, updated_at = now()
    WHERE id = NEW.ticket_id AND hotel_id = NEW.hotel_id AND status IN ('waiting_customer', 'resolved');
    UPDATE support_tickets SET updated_at = now() WHERE id = NEW.ticket_id AND hotel_id = NEW.hotel_id;
  ELSIF NEW.author_kind = 'platform_admin' AND NOT NEW.is_internal THEN
    UPDATE support_tickets
    SET first_response_at = COALESCE(first_response_at, now()),
        status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END,
        updated_at = now()
    WHERE id = NEW.ticket_id AND hotel_id = NEW.hotel_id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_support_message_flow AFTER INSERT ON support_messages
  FOR EACH ROW EXECUTE FUNCTION support_message_flow();
