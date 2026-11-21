/**
 * Mesure le contraste WCAG 2.1 de chaque paire texte/fond du design system, en clair ET en sombre.
 *
 * Le verre est translucide : la couleur réelle d'une surface dépend de ce qu'il y a DERRIÈRE.
 * On teste donc chaque paire sur le pire cas : le plan nu ET le plan sous chaque halo à pleine opacité
 * (les halos s'estompent avec la distance, le pire cas est donc conservateur).
 *
 * Usage : pnpm check:contrast   (code de sortie 1 si une paire échoue)
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type RGBA = { r: number; g: number; b: number; a: number };
type Tokens = Record<string, string>;

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/styles/tokens.css'), 'utf8');

function block(selector: string): Tokens {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`Bloc introuvable : ${selector}`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('\n}', open);
  const body = css.slice(open + 1, close);
  const out: Tokens = {};
  for (const m of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

function parse(value: string): RGBA {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/.exec(value);
  if (rgba) return { r: +rgba[1]!, g: +rgba[2]!, b: +rgba[3]!, a: rgba[4] === undefined ? 1 : +rgba[4] };
  throw new Error(`Couleur non reconnue : ${value}`);
}

const over = (top: RGBA, bottom: RGBA): RGBA => {
  const a = top.a + bottom.a * (1 - top.a);
  const mix = (t: number, b: number) => (t * top.a + b * bottom.a * (1 - top.a)) / a;
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a };
};

const lum = ({ r, g, b }: RGBA) => {
  const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a: RGBA, b: RGBA) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

interface Rule {
  fg: string;
  bg: string | string[]; // surfaces testées (jetons) posées sur chaque fond de pire cas
  min: number;
  why: string;
  /** Pour un texte sur sa propre teinte douce (badge) : la teinte est posée sur la surface. */
  tint?: string;
}

const SURFACES = ['glass-1', 'glass-2', 'glass-3', 'glass-data'];
// Texte principal et secondaire : lisibles même posés directement sur le plan.
const TEXT_SURFACES = [...SURFACES, 'canvas'];
// Règle de pose : les teintes plus discrètes (discret, accent, champagne, erreur) se posent TOUJOURS sur une surface
// vitrée, jamais directement sur le plan sous un halo. Les composants le respectent (titres de page en `ink`).

const rules: Rule[] = [
  { fg: 'ink', bg: TEXT_SURFACES, min: 7, why: 'texte principal (AAA)' },
  { fg: 'ink-2', bg: TEXT_SURFACES, min: 4.5, why: 'texte secondaire' },
  { fg: 'ink-3', bg: SURFACES, min: 4.5, why: 'texte discret (légendes, aides)' },
  { fg: 'accent-ink', bg: SURFACES, min: 4.5, why: 'liens et texte d\'accent' },
  { fg: 'champagne-ink', bg: SURFACES, min: 4.5, why: 'texte champagne (VIP, prestige)' },
  { fg: 'danger-ink', bg: SURFACES, min: 4.5, why: 'messages d\'erreur' },
  { fg: 'ink-inverse', bg: 'accent', min: 4.5, why: 'texte du bouton principal' },
  { fg: 'ink-inverse', bg: 'accent-hover', min: 4.5, why: 'bouton principal au survol' },
  { fg: 'ink-inverse', bg: 'danger', min: 4.5, why: 'bouton destructif' },
  { fg: 'ink-inverse', bg: 'danger-hover', min: 4.5, why: 'bouton destructif au survol' },
  { fg: 'focus-ring', bg: SURFACES, min: 3, why: 'anneau de focus (WCAG 1.4.11)' },
  { fg: 'field-border', bg: ['field-bg'], min: 3, why: 'bordure des champs de saisie (WCAG 1.4.11)' },
  { fg: 'accent-ink', bg: 'glass-1', tint: 'accent-soft', min: 4.5, why: 'navigation active / badge accent' },
  { fg: 'accent-ink', bg: 'glass-data', tint: 'accent-soft', min: 4.5, why: 'badge accent sur donnée' },
  { fg: 'champagne-ink', bg: 'glass-data', tint: 'champagne-soft', min: 4.5, why: 'badge VIP' },
  { fg: 'ink-2', bg: 'glass-data', tint: 'silver-soft', min: 4.5, why: 'badge neutre' },
  { fg: 'ink', bg: 'glass-data', tint: 'accent-soft', min: 7, why: 'texte sur ligne de tableau survolée' },
  { fg: 'ink-2', bg: 'glass-data', tint: 'accent-soft', min: 4.5, why: 'texte secondaire sur ligne survolée' },
  { fg: 'danger-ink', bg: 'glass-2', tint: 'st-cancelled-soft', min: 4.5, why: 'action destructive du menu (survol)' },
  ...['confirmed', 'pending', 'inhouse', 'departed', 'cancelled', 'noshow'].map(
    (s): Rule => ({ fg: `st-${s}`, bg: 'glass-data', tint: `st-${s}-soft`, min: 4.5, why: `badge « ${s} »` }),
  ),
];

function check(mode: 'light' | 'dark', t: Tokens): number {
  const canvas = parse(t['canvas']!);
  const opaque = (c: RGBA): RGBA => over(c, canvas);
  // Fonds de pire cas : plan nu, puis plan sous chaque halo à pleine opacité
  const backdrops: Record<string, RGBA> = {
    plan: canvas,
    'halo champagne': over(parse(t['orb-champagne']!), canvas),
    'halo bleu': over(parse(t['orb-blue']!), canvas),
    'halo argent': over(parse(t['orb-silver']!), canvas),
  };

  let failures = 0;
  const rows: string[] = [];
  for (const rule of rules) {
    const bgs = Array.isArray(rule.bg) ? rule.bg : [rule.bg];
    let worst = Infinity;
    let worstWhere = '';
    for (const bgToken of bgs) {
      for (const [bdName, bd] of Object.entries(backdrops)) {
        // Surfaces opaques (accent, champ…) : on ignore le fond ; translucides : composition sur le fond
        const base: RGBA = bgToken === 'canvas' ? bd : over(parse(t[bgToken]!), bd);
        // Surface nue ET surface sous le reflet (--sheen-a) : on retient le pire des deux
        const variants = bgToken.startsWith('glass-') ? [base, over(parse(t['sheen-a']!), base)] : [base];
        for (const [vi, v] of variants.entries()) {
          const surface = rule.tint ? over(parse(t[rule.tint]!), v) : v;
          const fg = over(parse(t[rule.fg]!), surface);
          const r = ratio(fg, surface);
          if (r < worst) {
            worst = r;
            worstWhere = `${bgToken}${vi ? ' + reflet' : ''} sur ${bdName}`;
          }
        }
      }
    }
    const ok = worst >= rule.min;
    if (!ok) failures++;
    rows.push(`${ok ? 'OK  ' : 'ÉCHEC'}  ${worst.toFixed(2).padStart(5)} (min ${rule.min})  ${rule.fg.padEnd(14)} ${rule.why}  [pire cas : ${worstWhere}]`);
  }
  void opaque;
  console.log(`\n=== Thème ${mode} ===`);
  for (const r of rows) console.log(r);
  return failures;
}

const light = block(':root');
const dark = { ...light, ...block("[data-theme='dark']") };
const failures = check('light', light) + check('dark', dark);
console.log(failures === 0 ? '\nTous les contrastes sont conformes.' : `\n${failures} paire(s) sous le seuil.`);
process.exit(failures === 0 ? 0 : 1);
