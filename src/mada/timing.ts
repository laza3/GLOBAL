// Calage voix off ↔ sous-titres ↔ scènes (frames à 30 fps).
// Calculé à partir des durées réelles de la voix (Piper, voix française « siwis »).
export const VOICE_FILE = "voix/mada.wav"; // voix + musique + effets sonores (13 s)
export const VOICE_FROM = 0;

// Début de chaque mot (frames)
export const W = {
  mada: 6,
  ebook: 16,
  la: 34,
  lecture: 39,
  malgache: 56,
  dans: 80,
  ta: 90,
  poche: 95,

  culture: 116,
  histoire: 131,
  contes: 149,
  et: 159,
  nature: 162,
  de: 173,
  la3: 176,
  grande: 179,
  ile: 188,

  lis: 206,
  decouvre: 216,
  partage: 236,
  ou: 254,
  que: 258,
  tu: 264,
  sois: 268,

  rejoins: 292,
  la2: 309,
  page: 314,
  mada2: 323,
  ebook2: 333,
};

// Fin de chaque phrase (frames)
export const E = { p1: 107, p2: 193, p3: 277, p4: 345 };

// Scènes : bornes de caméra / écrans
export const S = {
  homeIn: 14, // le téléphone monte
  coversIn: 40, // les couvertures apparaissent
  explode: 116, // les couvertures sortent du téléphone
  reader: 206, // écran de lecture
  profile: 288, // écran de la page
  tap: 327, // appui sur « Suivre »
};
