# AutoCare — identité visuelle et étiquettes

Shampooing carrosserie concentré, en flacon de 1 L et en bidons de 5 L et 10 L.

## Ce qu'il y a dans ce dossier

| Dossier | Contenu |
| --- | --- |
| `logo/` | Logo en SVG vectoriel : horizontal, vertical, symbole seul, logotype seul, icône. Trois couleurs : `encre`, `petrole`, `blanc`. |
| `logo/png/` | Les mêmes logos en PNG transparent (2000 px), pour le web et les réseaux sociaux. |
| `etiquettes/` | **Fichiers d'impression** : un PDF par format et par face (`AutoCare_1L_recto_impression.pdf`, etc.), avec fond perdu de 3 mm et traits de coupe. |
| `etiquettes/apercu/` | Aperçus PNG des étiquettes au format fini. |
| `presentation/` | Mise en situation de la gamme (flacon et bidons). |
| `brand/palette.json` | Couleurs (HEX et CMJN indicatifs). |
| `etiquette/contenu.json` | **Tous les textes de l'étiquette** : c'est le seul fichier à modifier pour changer un texte, un dosage ou un format. |
| `fonts/` | Archivo (licence libre SIL OFL, utilisable en commercial). |

## Le logo

Le symbole est une goutte pleine dont la contre-forme dessine un **A**. La ligne horizontale est une ligne de niveau : l'eau dans le seau, le produit dans le flacon. Le nom est composé en Archivo Expanded Bold puis vectorisé : les fichiers n'ont besoin d'aucune police.

- Fond clair : logo `encre` ou `petrole`.
- Fond pétrole ou photo sombre : logo `blanc`.
- Zone de protection : laisser autour du logo au moins la largeur du symbole.
- Ne pas déformer, ne pas ajouter d'ombre ni de dégradé, ne pas changer les couleurs.

## Couleurs

| Nom | HEX | CMJN indicatif | Usage |
| --- | --- | --- | --- |
| Pétrole | `#1E4B45` | C85 M45 Y62 K40 | Couleur de marque, bande de niveau |
| Encre | `#14201D` | C75 M55 Y65 K80 | Textes, logo |
| Écume | `#F2F1EC` | C3 M2 Y6 K0 | Fond des étiquettes |
| Brume | `#B7D3CB` | C30 M5 Y20 K0 | Texte secondaire sur pétrole |
| Lin | `#E3E1D8` | C10 M8 Y14 K0 | Filets, cadres |
| Gris route | `#5D6764` | C55 M40 Y45 K30 | Texte secondaire |

Les valeurs CMJN sont des points de départ : les faire valider sur épreuve par l'imprimeur.

## Formats d'étiquettes

| Contenant | Taille finie (L × H) |
| --- | --- |
| Flacon 1 L | 100 × 130 mm |
| Bidon 5 L | 140 × 182 mm |
| Bidon 10 L | 160 × 208 mm |

Une étiquette recto (nom, dosage, volume) et une étiquette verso (mode d'emploi, dosage, conseils, précautions, composition, fabricant, n° de lot, date). Si la zone d'étiquetage de tes contenants est différente, change `largeur_mm` / `hauteur_mm` dans `etiquette/contenu.json` et relance la génération (garder un rapport proche de 3:4).

## À faire avant d'imprimer

1. **Compléter les champs surlignés en jaune** au verso : composition, nom de l'entreprise, adresse et téléphone.
2. **Vérifier les dosages** (40 mL pour 10 L d'eau, 1:10 au canon à mousse) avec ta formule réelle.
3. **Vérifier les mentions** « pH neutre », « respecte cire et scellant », « sans traces » : n'imprimer que ce qui est vrai pour ton produit.
4. **Réglementation** : si la fiche de données de sécurité de ta formule classe le produit (par exemple irritation des yeux), il faut ajouter le pictogramme de danger, la mention d'avertissement, les phrases H/P et, dans l'Union européenne, le code UFI. Pour une vente en France, prévoir aussi le logo Triman et l'Info-tri. Pour la grande distribution, un code-barres EAN (GS1).
5. **Support** : imprimer sur vinyle ou polypropylène blanc, avec lamination ou vernis. Le papier ne tient pas à l'eau ni au produit.
6. Les PDF sont en RVB, avec polices incorporées : l'imprimeur les convertit en CMJN. Demander une épreuve couleur.

## Régénérer les fichiers

```bash
pip install fonttools uharfbuzz jinja2 pypdf
python3 autocare/tools/build_logo.py      # logos SVG
python3 autocare/tools/build_labels.py    # étiquettes PDF + aperçus
node autocare/tools/export_png.js autocare/logo/*.svg   # logos PNG (lancer depuis autocare/)
python3 autocare/tools/mockup.py          # mise en situation (build/mockup.svg)
```

Le rendu PDF utilise Chromium via Playwright.
