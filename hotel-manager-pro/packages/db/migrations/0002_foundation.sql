-- 0002 — Fonctions de contexte, aides aux migrations, compteurs de la plateforme

-- Contexte de requête : posé par l'API dans chaque transaction (SET LOCAL via set_config(..., true)).
-- Sans contexte -> NULL -> aucune ligne visible (échec fermé).
CREATE FUNCTION app_hotel_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.hotel_id', true), '')::uuid $$;

CREATE FUNCTION app_user_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

CREATE FUNCTION set_updated_at() RETURNS trigger
  LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- Verrou optimiste : l'API fait UPDATE ... WHERE id = $1 AND version = $2 et vérifie le nombre de lignes.
CREATE FUNCTION bump_version() RETURNS trigger
  LANGUAGE plpgsql AS $$ BEGIN NEW.version := OLD.version + 1; RETURN NEW; END $$;

-- Erreur métier typée : SQLSTATE 'HM001', le message est un code stable traduit par l'API.
CREATE FUNCTION raise_business_error(p_code text, p_detail text DEFAULT NULL) RETURNS void
  LANGUAGE plpgsql AS $$
BEGIN
  -- DETAIL = NULL est interdit par PostgreSQL (SQLSTATE 22004) : deux branches
  IF p_detail IS NULL THEN
    RAISE EXCEPTION '%', p_code USING ERRCODE = 'HM001';
  END IF;
  RAISE EXCEPTION '%', p_code USING ERRCODE = 'HM001', DETAIL = p_detail;
END $$;

-- ---------------------------------------------------------------------------
-- Aides de migration (schéma meta) : garantissent un traitement uniforme de la sécurité
-- ---------------------------------------------------------------------------

-- Attache updated_at / version à toutes les tables qui possèdent ces colonnes
CREATE FUNCTION meta.attach_housekeeping_triggers() RETURNS void
  LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname AS tbl, a.attname AS col
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
      AND a.attname IN ('updated_at', 'version')
  LOOP
    IF r.col = 'updated_at' THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_set_updated_at ON public.%I', r.tbl);
      EXECUTE format('CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', r.tbl);
    ELSE
      EXECUTE format('DROP TRIGGER IF EXISTS trg_bump_version ON public.%I', r.tbl);
      EXECUTE format('CREATE TRIGGER trg_bump_version BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.bump_version()', r.tbl);
    END IF;
  END LOOP;
END $$;

-- Table d'établissement : RLS stricte (hotel_id = contexte) + droits listés
CREATE FUNCTION meta.rls_tenant(p_table text, p_privileges text DEFAULT 'SELECT, INSERT, UPDATE, DELETE') RETURNS void
  LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', p_table);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', p_table);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON public.%I AS PERMISSIVE FOR ALL TO hmp_app '
    'USING (hotel_id = public.app_hotel_id()) WITH CHECK (hotel_id = public.app_hotel_id())', p_table);
  EXECUTE format('GRANT %s ON public.%I TO hmp_app', p_privileges, p_table);
END $$;

-- Table réservée à la plateforme : RLS activée, accès uniquement pour hmp_platform
CREATE FUNCTION meta.rls_platform(p_table text, p_privileges text DEFAULT 'SELECT, INSERT, UPDATE, DELETE') RETURNS void
  LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', p_table);
  EXECUTE format('DROP POLICY IF EXISTS platform_all ON public.%I', p_table);
  EXECUTE format('CREATE POLICY platform_all ON public.%I AS PERMISSIVE FOR ALL TO hmp_platform USING (true) WITH CHECK (true)', p_table);
  EXECUTE format('GRANT %s ON public.%I TO hmp_platform', p_privileges, p_table);
END $$;

-- Table de référence lisible par tous les rôles (catalogue)
CREATE FUNCTION meta.rls_catalog(p_table text) RETURNS void
  LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', p_table);
  EXECUTE format('DROP POLICY IF EXISTS catalog_read ON public.%I', p_table);
  EXECUTE format('CREATE POLICY catalog_read ON public.%I AS PERMISSIVE FOR SELECT TO hmp_app, hmp_platform USING (true)', p_table);
  EXECUTE format('GRANT SELECT ON public.%I TO hmp_app, hmp_platform', p_table);
END $$;

-- ---------------------------------------------------------------------------
-- Compteurs séquentiels sans trou de la plateforme (factures SaaS, tickets…)
-- L'incrément est dans la transaction de l'appelant : un ROLLBACK ne laisse aucun trou.
-- ---------------------------------------------------------------------------
CREATE TABLE platform_counters (
  key   text PRIMARY KEY,
  value bigint NOT NULL DEFAULT 0 CHECK (value >= 0)
);

CREATE FUNCTION next_platform_counter(p_key text) RETURNS bigint
  LANGUAGE sql AS $$
  INSERT INTO platform_counters (key, value) VALUES (p_key, 1)
  ON CONFLICT (key) DO UPDATE SET value = platform_counters.value + 1
  RETURNING value
$$;

SELECT meta.rls_platform('platform_counters', 'SELECT, INSERT, UPDATE');
GRANT EXECUTE ON FUNCTION next_platform_counter(text) TO hmp_platform;
