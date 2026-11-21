-- 0012 — Sessions et authentification : fonctions étroites (SECURITY DEFINER) pour le rôle applicatif
--
-- Le rôle hmp_app n'a AUCUN accès direct à sessions ni aux colonnes sensibles de users (mot de passe, verrouillage).
-- Tout passe par ces fonctions : ce qu'elles renvoient ou modifient est la seule surface d'attaque.
-- Le jeton de session n'est jamais stocké : seule son empreinte SHA-256 (calculée par l'API) l'est.

-- Crée une session pour un utilisateur ACTIF membre ACTIF d'un établissement non fermé
CREATE FUNCTION auth_create_session(
  p_user_id uuid, p_hotel_id uuid, p_token_hash text, p_ip inet, p_user_agent text, p_ttl interval
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF p_ttl <= interval '0' OR p_ttl > interval '90 days' THEN PERFORM raise_business_error('invalid_session_ttl'); END IF;
  IF NOT EXISTS (
    SELECT 1 FROM memberships m
    JOIN hotels h ON h.id = m.hotel_id
    JOIN users u ON u.id = m.user_id
    WHERE m.user_id = p_user_id AND m.hotel_id = p_hotel_id AND m.status = 'active'
      AND u.status = 'active' AND h.status <> 'closed'
  ) THEN
    PERFORM raise_business_error('not_a_member');
  END IF;
  INSERT INTO sessions (user_id, hotel_id, token_hash, ip, user_agent, expires_at)
  VALUES (p_user_id, p_hotel_id, p_token_hash, p_ip, left(p_user_agent, 300), now() + p_ttl)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Résout un jeton en identité + permissions. Rien si la session est expirée, révoquée, ou si l'utilisateur,
-- l'adhésion ou l'établissement ne sont plus valides (une suspension de compte coupe les sessions immédiatement).
CREATE FUNCTION auth_resolve_session(p_token_hash text)
  RETURNS TABLE (
    session_id uuid, user_id uuid, user_email citext, full_name text, locale text,
    hotel_id uuid, hotel_name text, hotel_status text,
    membership_id uuid, role_key text, role_name text, permissions text[], expires_at timestamptz
  )
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- Activité : mise à jour au plus toutes les 5 minutes (évite une écriture à chaque requête)
  UPDATE sessions s SET last_seen_at = now()
  WHERE s.token_hash = p_token_hash AND s.revoked_at IS NULL AND s.last_seen_at < now() - interval '5 minutes';

  RETURN QUERY
  SELECT s.id, u.id, u.email, u.full_name, u.locale,
         h.id, h.name, h.status,
         m.id, r.key, r.name,
         COALESCE(array_agg(rp.permission ORDER BY rp.permission) FILTER (WHERE rp.permission IS NOT NULL), '{}'::text[]),
         s.expires_at
  FROM sessions s
  JOIN users u ON u.id = s.user_id AND u.status = 'active'
  JOIN hotels h ON h.id = s.hotel_id AND h.status <> 'closed'
  JOIN memberships m ON m.hotel_id = s.hotel_id AND m.user_id = s.user_id AND m.status = 'active'
  JOIN roles r ON r.hotel_id = m.hotel_id AND r.id = m.role_id
  LEFT JOIN role_permissions rp ON rp.hotel_id = r.hotel_id AND rp.role_id = r.id
  WHERE s.token_hash = p_token_hash AND s.revoked_at IS NULL AND s.expires_at > now()
  GROUP BY s.id, u.id, h.id, m.id, r.id;
END $$;

CREATE FUNCTION auth_revoke_session(p_token_hash text) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE sessions SET revoked_at = now() WHERE token_hash = p_token_hash AND revoked_at IS NULL
$$;

-- Révoque toutes les sessions d'un utilisateur (changement de mot de passe), sauf éventuellement la courante
CREATE FUNCTION auth_revoke_user_sessions(p_user_id uuid, p_except_token_hash text DEFAULT NULL) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  UPDATE sessions SET revoked_at = now()
  WHERE user_id = p_user_id AND revoked_at IS NULL AND (p_except_token_hash IS NULL OR token_hash <> p_except_token_hash);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Établissements où l'utilisateur est membre actif (sélection après connexion)
CREATE FUNCTION auth_user_hotels(p_user_id uuid)
  RETURNS TABLE (hotel_id uuid, hotel_name text, slug citext, hotel_status text, role_key text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT h.id, h.name, h.slug, h.status, r.key
  FROM memberships m
  JOIN hotels h ON h.id = m.hotel_id AND h.status <> 'closed'
  JOIN roles r ON r.hotel_id = m.hotel_id AND r.id = m.role_id
  WHERE m.user_id = p_user_id AND m.status = 'active'
  ORDER BY h.name
$$;

-- Compteur d'échecs : verrouille le compte après p_max échecs consécutifs
CREATE FUNCTION auth_login_failed(p_user_id uuid, p_max integer, p_lock_minutes integer)
  RETURNS timestamptz
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_locked timestamptz;
BEGIN
  UPDATE users SET
    failed_attempts = failed_attempts + 1,
    locked_until = CASE WHEN failed_attempts + 1 >= p_max THEN now() + make_interval(mins => p_lock_minutes) ELSE locked_until END
  WHERE id = p_user_id
  RETURNING locked_until INTO v_locked;
  RETURN v_locked;
END $$;

CREATE FUNCTION auth_login_succeeded(p_user_id uuid) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = p_user_id
$$;

-- Le hash est calculé par l'API après vérification de l'ancien mot de passe
CREATE FUNCTION auth_set_password(p_user_id uuid, p_password_hash text) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE users SET password_hash = p_password_hash, failed_attempts = 0, locked_until = NULL WHERE id = p_user_id
$$;

REVOKE ALL ON FUNCTION auth_create_session(uuid, uuid, text, inet, text, interval) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_resolve_session(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_revoke_session(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_revoke_user_sessions(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_user_hotels(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_login_failed(uuid, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_login_succeeded(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_set_password(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_create_session(uuid, uuid, text, inet, text, interval) TO hmp_app;
GRANT EXECUTE ON FUNCTION auth_resolve_session(text) TO hmp_app;
GRANT EXECUTE ON FUNCTION auth_revoke_session(text) TO hmp_app;
GRANT EXECUTE ON FUNCTION auth_revoke_user_sessions(uuid, text) TO hmp_app;
GRANT EXECUTE ON FUNCTION auth_user_hotels(uuid) TO hmp_app;
GRANT EXECUTE ON FUNCTION auth_login_failed(uuid, integer, integer) TO hmp_app;
GRANT EXECUTE ON FUNCTION auth_login_succeeded(uuid) TO hmp_app;
GRANT EXECUTE ON FUNCTION auth_set_password(uuid, text) TO hmp_app;

-- Réglages commerciaux utilisés par la tâche de cycle de vie
INSERT INTO platform_settings (key, value, description) VALUES
  ('billing.renewal_invoice_days', '7'::jsonb, 'Jours avant l''échéance où la facture de renouvellement est émise'),
  ('auth.max_failed_attempts',     '5'::jsonb, 'Échecs de connexion avant verrouillage du compte'),
  ('auth.lock_minutes',            '15'::jsonb, 'Durée du verrouillage (minutes)')
ON CONFLICT (key) DO NOTHING;
