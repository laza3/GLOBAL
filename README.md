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

---

## AutoCare — branding et étiquettes

Logo, couleurs et étiquettes d’impression (1 L, 5 L, 10 L) du shampooing carrosserie AutoCare : voir [`autocare/`](autocare/README.md).
