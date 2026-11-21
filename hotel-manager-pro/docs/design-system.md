# Hotel Manager Pro — Design system

> État : **Phase 3 terminée**. La page de démonstration (`apps/web`) sert de banc d'essai : chaque composant y
> fonctionne réellement (formulaire validé, tableau triable, fenêtres, palette de commandes, thème).
> Lancement : `pnpm web:dev` · vérification complète : `pnpm check:ui`.

## 1. Direction artistique

Inspiration Apple (verre dépoli, profondeur, sobriété), avec une signature propre à l'hôtellerie :

* **Une seule source de lumière** : lueur champagne en haut à gauche, jour bleuté en bas à droite. Chaque surface
  vitrée reçoit un **liseré lumineux** orienté vers cette source, et un léger reflet.
* **Le verre structure, les données restent nettes** : cadre, cartes et menus en verre ; tableaux et graphiques sur
  une surface quasi opaque. Jamais deux surfaces floutées imbriquées.
* **Hiérarchie réelle** plutôt qu'une grille de cartes identiques : 4 niveaux de surface, rayons proportionnels
  (10 / 16 / 22 / 30 px), une ombre par niveau d'élévation.
* Pas de MAJUSCULES décoratives, pas de flèches « → » ajoutées, grands chiffres en graisse légère.

## 2. Jetons (`src/styles/tokens.css`)

Aucune couleur brute dans les composants, uniquement des jetons sémantiques, définis en clair et en sombre.

| Famille | Jetons |
|---|---|
| Plan et encre | `canvas`, `ink`, `ink-2` (secondaire), `ink-3` (discret, sur verre uniquement) |
| Accent | `accent` (bleu électrique), `accent-hover`, `accent-ink` (texte), `accent-soft` |
| Prestige | `champagne`, `champagne-ink`, `champagne-soft`, `silver`, `silver-soft` |
| Statuts | `st-confirmed`, `st-pending`, `st-inhouse`, `st-departed`, `st-cancelled`, `st-noshow` (+ `-soft`), `danger` |
| Verre | `glass-1` (cartes), `glass-2` (menus), `glass-3` (modales), `glass-data` (données), liseré `edge-*`, reflet `sheen-*` |
| Graphiques | `series-1…4`, `chart-grid`, `chart-axis`, `chart-track` |
| Mouvement | 140 / 220 / 340 ms, courbes `ease-out` (ressort doux) et `ease-in` |

**Typographie** : Inter variable auto-hébergée (aucun CDN), SF Pro automatiquement sur Apple via la pile système
(non redistribuée : sa licence l'interdit). Texte courant 15 px ; champs à 16 px sur mobile (évite le zoom d'iOS).
Chiffres **proportionnels** pour les grands nombres, **tabulaires** uniquement dans les colonnes.

## 3. Composants (`src/ui`)

`Button` (primaire / secondaire / discret / destructif, chargement, icône) · `Field`, `Input`, `Textarea`, `Select`,
`Switch`, `Checkbox`, `SegmentedControl` · `StatusBadge` (toujours icône + libellé), `Badge`, `VipBadge` ·
`DataTable` (tri `aria-sort`, squelette, état vide, cartes sur mobile) · `EmptyState` (3 illustrations),
`Skeleton` · `Modal`, `ConfirmDialog`, `Drawer` (feuille basculante sur mobile) · `Menu`, `Tip`, `Toaster` ·
`CommandPalette` (⌘K / Ctrl+K / « / ») · `Sidebar` repliable, `TabBar` mobile, `Topbar`, `ConnectionIndicator` ·
`Tabs` · graphiques : `TrendChart`, `BarList`, `Ring`, `Sparkline`, `StatTile`, `SegmentedBar`, `ChartFigure`.

## 4. Règles d'accessibilité appliquées (et vérifiées)

* **Contrastes mesurés** (`pnpm check:contrast`) : chaque paire texte/fond, **dans le pire cas sous chaque halo**, avec
  et sans reflet, en clair et en sombre (≥ 4,5:1 ; texte principal ≥ 7:1 ; bordures de champs et anneau de focus ≥ 3:1).
  Règle de pose : les teintes discrètes (`ink-3`, accent, champagne, erreur) ne se posent jamais directement sur le
  plan, toujours sur une surface vitrée.
* **Clavier** : focus toujours visible, lien « Aller au contenu », fenêtres à focus piégé **puis restitué à l'élément
  d'origine**, confirmation destructive focalisée sur le choix sûr (« Garder »), tri de tableau et onglets au clavier.
* **Sens jamais porté par la couleur seule** : statuts = icône + libellé ; variation = flèche + signe + texte.
* **Graphiques** : couleurs de séries validées pour le daltonisme (script du skill dataviz), légende + libellés directs,
  vue tableau pour chaque graphique, résumé en texte pour les lecteurs d'écran.
* **Mouvement réduit** respecté ; sans support du flou (ou transparence réduite), surfaces quasi opaques.
* **Cibles** : 44 px minimum sur écran tactile, jamais moins de 24 px (WCAG 2.5.8).
* **Mobile conçu à part** : colonne unique, barre d'onglets à 3 entrées + « Plus » (5 au maximum : avec cinq,
  « Réservations » ne tient pas sur 360 px), fenêtres en feuilles basculantes, listes en cartes.

## 5. Vérification

`pnpm check:ui` construit l'application puis exécute, pour **2 thèmes × 4 tailles** (375, 768, 1024, 1440 px) :
rendu sans erreur console, aucun défilement horizontal, audit **axe-core WCAG 2.1 A/AA** ; puis 27 contrôles de
comportement (thème mémorisé sans flash, palette, validation du formulaire, tri et recherche, fenêtres, annulation,
barre latérale repliable, feuille mobile, mouvement réduit). Résultat actuel : **tout passe**.

Limites connues : axe-core ne peut pas évaluer le contraste sur fond translucide (≈ 300 éléments « à vérifier ») :
c'est `check:contrast` qui couvre ce cas. Le lecteur d'écran réel (VoiceOver, NVDA) n'a pas été testé.

## 6. Décisions et écarts

* **Racine à 16 px** (texte courant 15 px sur `body`) : une racine à 15 px réduisait de 6 % toutes les tailles
  Tailwind (cibles de 44 px réduites à 41 px) ; détecté par la vérification des cibles tactiles.
* **Barre supérieure adaptative par conteneur** (et non par fenêtre) : elle s'ajuste à la place réellement disponible.
* **Pas de bibliothèque d'animation** (Motion) à ce stade : les transitions CSS suffisent ; à reconsidérer en Phase 5
  pour les transitions de pages (View Transitions).
* **Poids** : ≈ 276 Ko gzippé (Recharts, Radix). Le découpage par route est prévu en Phase 5.
* La page de démonstration deviendra une route interne `/design` quand le routeur sera en place (Phase 5).
