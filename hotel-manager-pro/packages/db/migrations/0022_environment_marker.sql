-- 0022 — Marqueur d'environnement de la base
--
-- Chaque base porte l'environnement auquel elle appartient (development / staging / production). Le marqueur est posé au premier
-- démarrage (ou à la première migration pilotée par la CI) puis COMPARÉ à chaque démarrage de l'API et à chaque migration.
-- Conséquences : une API « staging » branchée par erreur sur la base de production (ou l'inverse), ou une sauvegarde de production
-- restaurée dans la base de test, refuse de démarrer au lieu de mélanger en silence données fictives et données réelles.
-- Le marqueur n'est lisible/posable que par la fonction ci-dessous (aucun droit direct pour les rôles applicatifs) et ne peut pas être
-- changé par l'API : un changement volontaire se fait avec le compte d'administration (voir docs/environnements.md).
CREATE TABLE deployment_marker (
  singleton   boolean PRIMARY KEY DEFAULT true CHECK (singleton),  -- une seule ligne possible
  environment text NOT NULL CHECK (environment IN ('development', 'staging', 'production')),
  claimed_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE deployment_marker ENABLE ROW LEVEL SECURITY;  -- sans politique : invisible pour les rôles applicatifs

-- Pose le marqueur s'il n'existe pas encore, et renvoie celui de la base (celui qui était déjà là l'emporte).
CREATE FUNCTION environment_claim(p_environment text) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_environment text;
BEGIN
  IF p_environment IS NULL OR p_environment NOT IN ('development', 'staging', 'production') THEN
    RAISE EXCEPTION 'environnement invalide : %', p_environment USING ERRCODE = '22023';
  END IF;
  INSERT INTO deployment_marker (environment) VALUES (p_environment) ON CONFLICT (singleton) DO NOTHING;
  SELECT environment INTO v_environment FROM deployment_marker;
  RETURN v_environment;
END $$;

REVOKE ALL ON FUNCTION environment_claim(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION environment_claim(text) TO hmp_app, hmp_platform;
