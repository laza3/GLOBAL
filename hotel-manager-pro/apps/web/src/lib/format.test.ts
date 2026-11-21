import { describe, expect, it } from 'vitest';
import { daysLabel, daysUntil, formatDate, initials } from './format';

describe('formats', () => {
  it('affiche la date dans le fuseau de l\'établissement (Madagascar = UTC+3)', () => {
    // 21 h UTC le 20 = minuit le 21 à Antananarivo
    expect(formatDate('2026-11-20T21:30:00Z')).toMatch(/^21 nov\.? 2026$/);
    expect(formatDate('2026-11-20T21:30:00Z', { timeZone: 'UTC' })).toMatch(/^20 nov\.? 2026$/);
    expect(formatDate('2026-11-20T21:30:00Z', { long: true })).toBe('21 novembre 2026');
    expect(formatDate('2026-11-20T21:30:00Z', { time: true })).toMatch(/00:30/);
  });
  it('tolère l\'absence ou l\'invalidité d\'une date', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate('pas une date')).toBe('—');
  });
  it('compte les jours restants, arrondis vers le haut', () => {
    const now = new Date('2026-11-21T10:00:00Z');
    expect(daysUntil('2026-11-22T09:00:00Z', now)).toBe(1);
    expect(daysUntil('2026-11-28T10:00:00Z', now)).toBe(7);
    expect(daysUntil('2026-11-20T10:00:00Z', now)).toBe(-1);
    expect(daysUntil(null, now)).toBeNull();
    expect(daysLabel(1)).toBe('1 jour');
    expect(daysLabel(14)).toBe('14 jours');
    expect(daysLabel(0)).toBe("aujourd'hui");
  });
  it('construit des initiales lisibles', () => {
    expect(initials('Hanitra Rasoamanana')).toBe('HR');
    expect(initials('  aina  ')).toBe('AI');
    expect(initials('Jean de la Fontaine')).toBe('JF');
    expect(initials('')).toBe('?');
  });
});
