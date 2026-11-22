import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from '../src/lib/csv';

describe('export CSV', () => {
  it('échappe les guillemets, séparateurs et retours à la ligne', () => {
    expect(csvCell('simple')).toBe('simple');
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('dit "oui"')).toBe('"dit ""oui"""');
    expect(csvCell('l1\nl2')).toBe('"l1\nl2"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(42)).toBe('42');
    expect(csvCell(new Date('2026-11-22T10:00:00Z'))).toBe('2026-11-22T10:00:00.000Z');
  });
  it('neutralise l\'injection de formule', () => {
    for (const evil of ['=HYPERLINK("http://x")', '+cmd|calc', '-2+3', '@SUM(A1)', '\tTAB']) expect(csvCell(evil).replace(/^"/, '')).toMatch(/^'/);
  });
  it('produit un fichier lisible par Excel : BOM, CRLF, séparateur point-virgule', () => {
    const csv = toCsv(['Nom', 'Ville'], [['Rakoto', 'Nosy Be'], ['Élise', null]]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toBe('﻿Nom;Ville\r\nRakoto;Nosy Be\r\nÉlise;\r\n');
  });
});
