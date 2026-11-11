# Vidéos motion design (Remotion)

Deux compositions, toutes deux en 1080×1920 (9:16), 30 fps, dessinées en SVG dans le code (React + TypeScript).

```bash
npm install
npm run studio            # prévisualisation de toutes les compositions
```

## « Une journée catastrophique… mais pas inutile » — 80 s

Court-métrage stickman en six scènes, calé sur la voix off fournie (ElevenLabs, « Paul K – Deep French Narrator »).

- Rendu final : `out/journee.mp4`
- Composition : `src/journee/Journee.tsx` (scènes, transitions, titres, sous-titres, message final)
- Chronologie unique : `src/journee/timeline.json` — placement de chaque phrase de la voix off,
  sous-titres, événements (réveil, chute, café, tonnerre, bus, oranges…) et cadence des pas.
  Elle est lue à la fois par l'animation et par le script audio, d'où la synchronisation.
- Personnage : squelette articulé unique `src/journee/rig.ts` (cinématique directe + IK, cycles de marche/course)
  et rendu `src/journee/Stickman.tsx` (corps noir, tête ronde, visage expressif) — mêmes proportions dans toutes les scènes.
- Scènes : `src/journee/scenes/` — `Chambre` (1), `Rue` (2), `Arret` (3 à 5 : bus raté, rencontre, parapluie), `Final` (6)
- Décors et météo : `src/journee/decor/` (ville commune aux scènes 2 à 6, ambiances soleil / pluie / coucher de soleil)
- Polices embarquées (SIL OFL) : `public/journee/fonts/` — Baloo 2 et Fraunces, rendu sans accès réseau.

| Scène | Temps | Contenu |
|---|---|---|
| 1 | 0 – 12,6 s | Réveil, snooze, avance rapide de l'heure, réveil en sursaut, chute |
| 2 | 12,6 – 24,6 s | Course, feu rouge, réverbère, café renversé, orage |
| 3 | 24,6 – 36,4 s | Bus raté, assis épuisé sous l'abri |
| 4 | 36,4 – 48,3 s | Le vieil homme et ses oranges, hésitation, demi-tour |
| 5 | 48,3 – 59,6 s | Ramassage, le parapluie offert, la pluie s'arrête |
| 6 | 59,6 – 80 s | Marche au coucher de soleil, message final |

### Bande-son

`public/journee/bande-son.wav` est générée par `scripts/bande_son.py` (numpy + ffmpeg) :
voix off découpée et replacée selon la chronologie, musique synthétisée qui évolue
(pizzicati et basson humoristiques → piano et cordes sous la pluie → do majeur lumineux),
bruitages synthétisés (réveil, chute, café, pluie, tonnerre, bus, pas…), ducking de la musique
sous la voix, normalisation vers −16 LUFS.

```bash
npm run bande-son         # régénère public/journee/bande-son.wav
npx remotion still Journee stills/j.png --frame=1600
npm run render:journee    # → out/journee.mp4
```

## « Pourquoi les flamants roses sont roses ? » — 15 s

- Rendu final : `out/flamants.mp4`
- Composition : `src/Flamants.tsx` (caméra continue, scènes, sous-titres)
- Personnage paramétrique poussin → adulte : `src/components/Flamingo.tsx`
- Voix off : `public/voix/*.wav` (synthèse Piper, voix « fr siwis medium »), calage dans `src/voice.ts`

```bash
npm run render            # → out/flamants.mp4
```
