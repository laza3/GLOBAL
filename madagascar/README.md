# 15 secondes pour connaître Madagascar

Vidéo TikTok verticale (1080×1920, 30 fps, 15 s) en motion design 3D isométrique, réalisée avec
[HyperFrames](https://hyperframes.heygen.com) (HTML + GSAP, rendu MP4 par le CLI `hyperframes`).

- Rendu final : `../out/madagascar.mp4`
- Composition : `index.html` — monde isométrique dessiné en SVG de façon déterministe
  (île de Madagascar extrudée, Afrique, port de Toamasina, mine d'Ambatovy, Allée des Baobabs,
  village, personnages), caméra avec zooms/pans, titres, puces et sous-titres en français.
- Voix off : `assets/audio/voix-fr.wav` (Higgsfield · Seed Audio, voix « Fraser »), calée sur 15 s ;
  `assets/audio/voix-celine.wav` est une prise alternative (voix féminine).
- Musique : `assets/audio/musique.mp3` (Higgsfield · ElevenLabs Music, instrumental afro-pop).
- Polices : Baloo 2 et Nunito (fichiers woff2 locaux dans `assets/fonts/`), GSAP local dans `assets/`.

```bash
npm run check                       # lint + validation runtime + mise en page
npx hyperframes snapshot --at 1,6,10  # captures PNG pour vérifier visuellement
npm run render -- -o ../out/madagascar.mp4   # rendu MP4
```

Script de la voix off : « 15 secondes pour connaître Madagascar ! Une île géante dans l'océan Indien,
à l'est de l'Afrique. Premier producteur mondial de vanille, terre de nickel, de cobalt et de saphirs.
Un savoir-faire unique, une nature exceptionnelle, et un peuple à la bonté légendaire.
Madagascar : à découvrir absolument ! »
