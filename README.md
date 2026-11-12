# Pourquoi les flamants roses sont roses ?

Vidéo motion design de 15 s (1080×1920, 30 fps, 450 frames), réalisée avec Remotion (React + TypeScript).
Tout est dessiné en SVG dans le code ; police Baloo 2 via `@remotion/google-fonts` ; voix off française.

- Rendu final : `out/flamants.mp4`
- Composition : `src/Flamants.tsx` (caméra continue, scènes, sous-titres)
- Personnage paramétrique poussin → adulte : `src/components/Flamingo.tsx`
- Voix off : `public/voix/*.wav` (synthèse Piper, voix « fr siwis medium »), calage dans `src/voice.ts`

```bash
npm install
npm run studio       # prévisualisation
npx remotion still Flamants stills/f120.png --frame=120
npm run render       # → out/flamants.mp4
```

## Mada ebook (13 s)

Vidéo de présentation de la page Mada ebook (1080×1920, 30 fps, 390 frames, voix off française + musique + effets).

- Rendu final : `out/mada-ebook.mp4` (`npm run render:mada`, prévisualisation : `npm run studio:mada`)
- Composition : `src/mada/Mada.tsx` (caméra, scènes, téléphone), décor `Scenery.tsx`, interface `Ui.tsx`
- Calage voix ↔ sous-titres ↔ scènes : `src/mada/timing.ts`
- Audio : `public/voix/mada.wav` (voix Piper « siwis » + musique + effets), `public/voix/mada-voix-seule.wav` (voix seule)
- Police Baloo 2 embarquée (`public/fonts`) : aucun accès réseau nécessaire au rendu
