// Calage voix off ↔ sous-titres (frames à 30 fps). À ajuster après réception de la voix.
export const VOICE_FILE = "";
export const VOICE_FROM = 4;

// Début de chaque mot (frames)
export const W = {
  mada: 6,
  ebook: 14,
  la: 34,
  lecture: 40,
  malgache: 48,
  dans: 64,
  ta: 70,
  poche: 76,

  culture: 112,
  histoire: 128,
  contes: 146,
  nature: 168,

  lis: 206,
  decouvre: 226,
  partage: 252,

  rejoins: 298,
  la2: 312,
  page: 318,
  mada2: 338,
  ebook2: 346,
};

// Scènes : bornes de caméra / écrans
export const S = {
  homeIn: 14, // le téléphone monte
  coversIn: 40, // les couvertures apparaissent
  explode: 104, // les couvertures sortent du téléphone
  reader: 196, // écran de lecture
  profile: 286, // écran de la page
  tap: 338, // appui sur « Suivre »
};
