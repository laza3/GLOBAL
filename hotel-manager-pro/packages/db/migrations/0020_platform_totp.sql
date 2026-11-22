-- 0020 — Double authentification (TOTP) des super-administrateurs
--   totp_secret_enc        : secret chiffré (AES-256-GCM, clé ENCRYPTION_KEY) — existait déjà
--   totp_enabled_at        : NULL tant que l'administrateur n'a pas prouvé qu'il possède l'application d'authentification
--   totp_last_step         : dernier pas de 30 s accepté : un même code ne sert jamais deux fois (rejeu)
--   totp_recovery_hashes   : codes de secours à usage unique, stockés hachés (SHA-256)
ALTER TABLE platform_admins
  ADD COLUMN totp_enabled_at timestamptz,
  ADD COLUMN totp_last_step bigint,
  ADD COLUMN totp_recovery_hashes text[] NOT NULL DEFAULT '{}';
