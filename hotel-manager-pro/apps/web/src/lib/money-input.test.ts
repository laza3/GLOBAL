import { describe, expect, it } from 'vitest';
import { moneyInputValue, parseMoneyInput } from './money-input';

describe('saisie des montants', () => {
  it('lit les formats français et anglais, espaces compris', () => {
    expect(parseMoneyInput('80000', 'MGA')).toBe(80000);
    expect(parseMoneyInput('80 000', 'MGA')).toBe(80000);
    expect(parseMoneyInput('80 000', 'MGA')).toBe(80000);
    expect(parseMoneyInput('12,50', 'EUR')).toBe(1250);
    expect(parseMoneyInput('12.5', 'EUR')).toBe(1250);
    expect(parseMoneyInput('0,1', 'USD')).toBe(10);
  });
  it('refuse ce qui n\'est pas un montant valide pour la devise', () => {
    expect(parseMoneyInput('', 'MGA')).toBeNull();
    expect(parseMoneyInput('abc', 'MGA')).toBeNull();
    expect(parseMoneyInput('-5', 'EUR')).toBeNull();
    expect(parseMoneyInput('12,505', 'EUR')).toBeNull(); // plus de centimes que la devise n'en a
    expect(parseMoneyInput('1,5', 'MGA')).toBeNull(); // l'ariary n'a pas de sous-unité
    expect(parseMoneyInput('1e3', 'MGA')).toBeNull();
  });
  it('affiche la valeur initiale d\'un champ', () => {
    expect(moneyInputValue(80000, 'MGA')).toBe('80000');
    expect(moneyInputValue(1250, 'EUR')).toBe('12,50');
    expect(parseMoneyInput(moneyInputValue(1999, 'USD'), 'USD')).toBe(1999);
  });
});
