-- 0021 — Réinitialisation du mot de passe par e-mail
--
-- Le jeton envoyé par e-mail n'est JAMAIS stocké (seule son empreinte SHA-256 l'est), expire vite et ne sert qu'une fois.
-- La table n'est accessible que par deux fonctions étroites : le rôle applicatif n'a aucun droit direct dessus.
CREATE TABLE password_resets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_resets_user_idx ON password_resets (user_id, created_at DESC);
ALTER TABLE password_resets ENABLE ROW LEVEL SECURITY;  -- sans politique : invisible pour les rôles applicatifs

-- Crée une demande pour un compte ACTIF et renvoie son identité (pour l'e-mail) ; aucune ligne si le compte n'existe pas.
-- Les demandes précédentes encore ouvertes sont invalidées : un seul lien valide à la fois. Limite : 5 demandes par heure et par compte.
CREATE FUNCTION auth_request_reset(p_email citext, p_token_hash text, p_ttl interval)
  RETURNS TABLE (user_id uuid, full_name text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_user uuid; v_name text;
BEGIN
  SELECT u.id, u.full_name INTO v_user, v_name FROM users u WHERE u.email = p_email AND u.status = 'active';
  IF v_user IS NULL THEN RETURN; END IF;
  IF (SELECT count(*) FROM password_resets WHERE password_resets.user_id = v_user AND created_at > now() - interval '1 hour') >= 5 THEN RETURN; END IF;
  UPDATE password_resets SET used_at = now() WHERE password_resets.user_id = v_user AND used_at IS NULL;
  INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (v_user, p_token_hash, now() + p_ttl);
  RETURN QUERY SELECT v_user, v_name;
END $$;

-- Consomme un jeton valide : nouveau mot de passe, toutes les sessions révoquées, verrouillage levé. NULL si le jeton est inconnu, expiré ou déjà utilisé.
CREATE FUNCTION auth_consume_reset(p_token_hash text, p_password_hash text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_user uuid;
BEGIN
  UPDATE password_resets SET used_at = now()
   WHERE token_hash = p_token_hash AND used_at IS NULL AND expires_at > now()
  RETURNING password_resets.user_id INTO v_user;
  IF v_user IS NULL THEN RETURN NULL; END IF;
  UPDATE users SET password_hash = p_password_hash, failed_attempts = 0, locked_until = NULL, must_change_password = false WHERE id = v_user;
  UPDATE sessions SET revoked_at = now() WHERE sessions.user_id = v_user AND revoked_at IS NULL;
  RETURN v_user;
END $$;

REVOKE ALL ON FUNCTION auth_request_reset(citext, text, interval) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_consume_reset(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_request_reset(citext, text, interval) TO hmp_app;
GRANT EXECUTE ON FUNCTION auth_consume_reset(text, text) TO hmp_app;
