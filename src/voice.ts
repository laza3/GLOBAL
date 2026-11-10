// Voix off (synthèse Piper, voix française « siwis »), une phrase par fichier,
// calée sur les sous-titres. `from` est en frames (30 fps).
export const VOICE: { file: string; from: number }[] = [
  { file: "voix1.wav", from: 8 }, // Les flamants roses naissent… gris !
  { file: "voix2.wav", from: 84 }, // Leur couleur vient de leur assiette.
  { file: "voix3.wav", from: 174 }, // Algues et crevettes, pleines de pigments : les caroténoïdes !
  { file: "voix4.wav", from: 272 }, // Plus il en mange, plus il est rose !
  { file: "voix5.wav", from: 368 }, // Tu es ce que tu manges !
];
