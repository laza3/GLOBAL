/**
 * Export CSV pour Excel (France / Madagascar) : séparateur « ; », fins de ligne CRLF, BOM UTF-8 (accents corrects à l'ouverture).
 * Protection contre l'injection de formule : une cellule commençant par = + - @ ou une tabulation est préfixée d'une apostrophe
 * (sinon Excel l'exécuterait) — y compris pour un nom de client saisi par un tiers.
 */
const FORMULA = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (FORMULA.test(s)) s = `'${s}`;
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}
