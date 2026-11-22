-- 0014 — Trace de l'acceptation des conditions d'utilisation
--
-- À l'inscription, la version des conditions acceptée et l'horodatage sont conservés : en cas de litige ou de nouvelle version,
-- on sait ce que chaque utilisateur a accepté et quand. Les deux colonnes vont ensemble (jamais l'une sans l'autre).
-- Les comptes créés avant cette migration n'ont pas de trace (NULL) : ils ne sont pas réputés avoir accepté une version précise.

ALTER TABLE users
  ADD COLUMN terms_version     text,
  ADD COLUMN terms_accepted_at timestamptz,
  ADD CONSTRAINT users_terms_pair CHECK ((terms_version IS NULL) = (terms_accepted_at IS NULL));

GRANT SELECT (terms_version, terms_accepted_at) ON users TO hmp_app;
GRANT INSERT (terms_version, terms_accepted_at) ON users TO hmp_app;
