-- 0001 — Extensions et rôles PostgreSQL (exécuté avec le compte d'administration)
--
-- Modèle de rôles (principe du moindre privilège) :
--   hmp_owner    : propriétaire des objets, utilisé UNIQUEMENT par les migrations (NOLOGIN, non superuser)
--   hmp_app      : rôle des requêtes d'un établissement (soumis à la RLS, sans BYPASSRLS)
--   hmp_platform : rôle de la console super-administrateur (n'a AUCUN droit sur les données métier d'un hôtel)
-- Les rôles sont créés NOLOGIN ; le déploiement leur donne un mot de passe (voir docs/security-model.md).

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hmp_owner') THEN
    CREATE ROLE hmp_owner NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hmp_app') THEN
    CREATE ROLE hmp_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hmp_platform') THEN
    CREATE ROLE hmp_platform NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO hmp_owner;
GRANT USAGE ON SCHEMA public TO hmp_app, hmp_platform;

-- Schéma technique (fonctions d'aide aux migrations) : jamais accessible aux rôles applicatifs
CREATE SCHEMA IF NOT EXISTS meta AUTHORIZATION hmp_owner;
REVOKE ALL ON SCHEMA meta FROM PUBLIC;
