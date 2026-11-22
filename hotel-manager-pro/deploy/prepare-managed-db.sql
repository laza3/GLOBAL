-- Préparation d'une base PostgreSQL HÉBERGÉE (Neon, Supabase, RDS…) — à exécuter UNE FOIS, avant la première migration.
--
-- Pourquoi : sur un hébergeur, le compte d'administration n'est pas « superuser ». Depuis PostgreSQL 16, créer un rôle ne permet
-- plus de « devenir » ce rôle ; or les migrations s'exécutent sous le rôle hmp_owner (jamais en superuser : les fonctions
-- SECURITY DEFINER n'ont donc aucun pouvoir excessif). Ce script crée les trois rôles et donne au compte d'administration le droit
-- de basculer vers hmp_owner. Il ne modifie aucune donnée et peut être relancé sans risque.
--
-- Comment : exécuter AVEC LE MÊME COMPTE que celui de DATABASE_ADMIN_URL (ex. éditeur SQL du fournisseur, ou
--   psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -f deploy/prepare-managed-db.sql ).
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

DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 160000 THEN
    EXECUTE format('GRANT hmp_owner TO %I WITH INHERIT TRUE, SET TRUE', current_user);
  ELSE
    EXECUTE format('GRANT hmp_owner TO %I', current_user);
  END IF;
END $$;
