// Lit les durées réelles des fichiers voix (ffprobe) ; estimation pour ceux qui manquent encore. Produit src/voice-data.ts
import { execFileSync } from 'node:child_process'; import { existsSync, writeFileSync, readFileSync } from 'node:fs';
const texts = JSON.parse(readFileSync('src/narration.json', 'utf8'));
const out = {};
for (const [id, text] of Object.entries(texts)) {
  const f = `public/voix/${id}.mp3`;
  if (existsSync(f)) { const d = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim()); out[id] = { seconds: d, real: true }; }
  else out[id] = { seconds: Math.round(text.length * 0.056 * 100) / 100, real: false };
}
writeFileSync('src/voice-data.ts', `// Généré par gen-voice-data.mjs — ne pas modifier à la main\nexport const VOICE: Record<string, { seconds: number; real: boolean }> = ${JSON.stringify(out, null, 2)};\n`);
console.log(Object.entries(out).map(([k, v]) => `${k}:${v.seconds}${v.real ? '' : '*'}`).join(' '), '| total parole', Object.values(out).reduce((a, v) => a + v.seconds, 0).toFixed(1) + 's');
