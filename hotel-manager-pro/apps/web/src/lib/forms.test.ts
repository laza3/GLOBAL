import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { emailProblem, feedbackFrom, requiredProblem } from './forms';

describe('retour de formulaire', () => {
  it('place les erreurs de validation sous leur champ', () => {
    const e = new ApiError(422, 'validation_error', 'Champs invalides', [{ path: 'email', message: 'Adresse invalide' }, { path: 'email', message: 'doublon' }, { path: 'ownerName', message: 'Trop court' }]);
    expect(feedbackFrom(e)).toEqual({ fields: { email: 'Adresse invalide', ownerName: 'Trop court' } });
  });
  it('rattache un code d\'erreur à un champ', () => {
    const e = new ApiError(409, 'email_already_registered', 'Cette adresse possède déjà un compte.');
    expect(feedbackFrom(e, { email_already_registered: 'email' })).toEqual({ fields: { email: 'Cette adresse possède déjà un compte.' } });
  });
  it('affiche le reste comme message général, y compris une erreur non API', () => {
    expect(feedbackFrom(new ApiError(401, 'invalid_credentials', 'Identifiants incorrects.'))).toEqual({ fields: {}, general: 'Identifiants incorrects.' });
    expect(feedbackFrom(new Error('boom')).general).toMatch(/inattendue/);
  });
  it('valide l\'e-mail et les champs obligatoires', () => {
    expect(emailProblem('aina@hotel.mg')).toBeNull();
    expect(emailProblem(' aina@hotel.mg ')).toBeNull();
    expect(emailProblem('aina@hotel')).toMatch(/valide/);
    expect(emailProblem('')).toMatch(/valide/);
    expect(requiredProblem('  ', 'Le nom')).toBe('Le nom est obligatoire.');
    expect(requiredProblem('a', 'Le nom', 2)).toBe('Le nom doit contenir au moins 2 caractères.');
    expect(requiredProblem('ab', 'Le nom', 2)).toBeNull();
  });
});
