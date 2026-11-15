import { describe, expect, it } from 'vitest';
import { allocate, formatMoney, roundDiv, toMilli, toMinor, mulQty } from '../src';

describe('money', () => {
  it('roundDiv arrondit half away from zero', () => {
    expect(roundDiv(5, 2)).toBe(3);
    expect(roundDiv(-5, 2)).toBe(-3);
    expect(roundDiv(4, 3)).toBe(1);
    expect(roundDiv(1, 3)).toBe(0);
    expect(roundDiv(10, 4)).toBe(3);
  });
  it('conversions sans erreur flottante', () => {
    expect(toMinor(19.99, 'EUR')).toBe(1999);
    expect(toMinor(0.1 + 0.2, 'EUR')).toBe(30);
    expect(toMinor(1500, 'MGA')).toBe(1500);
    expect(toMilli(0.1 + 0.2)).toBe(300);
    expect(toMilli(1.005)).toBe(1005);
  });
  it('mulQty', () => {
    expect(mulQty(1000, 1500)).toBe(1500);
    expect(mulQty(333, 1000)).toBe(333);
    expect(mulQty(1001, 500)).toBe(501); // 500.5 -> 501
  });
  it('formatMoney', () => {
    expect(formatMoney(15000, 'MGA')).toMatch(/15\s?000\s?Ar/);
    expect(formatMoney(1999, 'EUR', 'en-US')).toBe('19.99 €');
  });
  it('allocate conserve toujours le total', () => {
    for (const [t, w] of [[100, [1, 1, 1]], [1, [1, 1]], [0, [5, 5]], [7, [3, 0, 4]], [-100, [1, 2]], [99999, [333, 333, 334, 1]]] as [number, number[]][]) {
      const r = allocate(t, w);
      expect(r.reduce((a, b) => a + b, 0)).toBe(t);
    }
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(7, [3, 0, 4])[1]).toBe(0);
  });
});
