-- 0019 — Personnel : création de comptes par l'établissement, mot de passe provisoire à changer
--
-- Sans fournisseur d'e-mail, le propriétaire (ou un administrateur) crée le compte d'un employé et lui remet un mot de passe
-- PROVISOIRE, affiché une seule fois. Le compte est marqué « à changer » : l'application le signale jusqu'au premier changement.
--
-- Le rôle applicatif ne peut pas écrire dans `users` en dehors de l'inscription (politique RLS) : la création d'un employé et la
-- réinitialisation d'un mot de passe passent par deux fonctions étroites, limitées à l'établissement courant.

ALTER TABLE users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;
GRANT SELECT (must_change_password) ON users TO hmp_app;

-- Un changement de mot de passe par l'intéressé lève le marquage
CREATE OR REPLACE FUNCTION auth_set_password(p_user_id uuid, p_password_hash text) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE users SET password_hash = p_password_hash, failed_attempts = 0, locked_until = NULL, must_change_password = false WHERE id = p_user_id
$$;

CREATE FUNCTION staff_create_user(p_email citext, p_full_name text, p_password_hash text, p_role_id uuid, p_job_title text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_user uuid; v_hotel uuid := app_hotel_id();
BEGIN
  IF v_hotel IS NULL THEN PERFORM raise_business_error('tenant_context_missing'); END IF;
  IF NOT EXISTS (SELECT 1 FROM roles WHERE id = p_role_id AND hotel_id = v_hotel) THEN PERFORM raise_business_error('role_not_found'); END IF;
  -- Un e-mail déjà utilisé (ici ou dans un autre établissement) lève la violation d'unicité users_email_key, traduite par l'API
  INSERT INTO users (email, full_name, password_hash, must_change_password) VALUES (p_email, p_full_name, p_password_hash, true) RETURNING id INTO v_user;
  INSERT INTO memberships (hotel_id, user_id, role_id, status, job_title, joined_at) VALUES (v_hotel, v_user, p_role_id, 'active', p_job_title, now());
  RETURN v_user;
END $$;

-- Réinitialisation par l'établissement : seulement pour un compte qui n'appartient QU'À cet établissement (jamais un compte partagé
-- avec un autre hôtel), sessions révoquées, mot de passe provisoire à changer.
CREATE FUNCTION staff_set_temp_password(p_user_id uuid, p_password_hash text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_hotel uuid := app_hotel_id();
BEGIN
  IF v_hotel IS NULL THEN PERFORM raise_business_error('tenant_context_missing'); END IF;
  IF NOT EXISTS (SELECT 1 FROM memberships WHERE user_id = p_user_id AND hotel_id = v_hotel) THEN PERFORM raise_business_error('member_not_found'); END IF;
  IF EXISTS (SELECT 1 FROM memberships WHERE user_id = p_user_id AND hotel_id <> v_hotel) THEN PERFORM raise_business_error('forbidden'); END IF;
  UPDATE users SET password_hash = p_password_hash, must_change_password = true, failed_attempts = 0, locked_until = NULL WHERE id = p_user_id;
  UPDATE sessions SET revoked_at = now() WHERE user_id = p_user_id AND revoked_at IS NULL;
END $$;

REVOKE ALL ON FUNCTION staff_create_user(citext, text, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION staff_set_temp_password(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION staff_create_user(citext, text, text, uuid, text) TO hmp_app;
GRANT EXECUTE ON FUNCTION staff_set_temp_password(uuid, text) TO hmp_app;
