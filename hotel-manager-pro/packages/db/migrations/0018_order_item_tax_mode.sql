-- 0018 — Restaurant : le mode de la taxe (incluse dans le prix, ou ajoutée) est figé sur chaque ligne de commande.
-- Une taxe modifiée ensuite ne doit pas changer l'interprétation des additions déjà saisies.
ALTER TABLE order_items ADD COLUMN tax_inclusive boolean NOT NULL DEFAULT false;
