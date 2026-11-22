import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { api, isApiError } from '../../api/client';
import { useDocumentTitle } from '../../lib/use-title';
import { Button } from '../../ui/button';
import { Field, PasswordInput } from '../../ui/form';
import { AuthLayout, FormAlert } from './layout';

export function ResetPasswordPage() {
  useDocumentTitle('Nouveau mot de passe');
  const navigate = useNavigate();
  const token = useSearchParams()[0].get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 10) return setFieldError('Au moins 10 caractères, avec une lettre et un chiffre.');
    if (password !== confirm) return setFieldError('Les deux mots de passe ne sont pas identiques.');
    setFieldError(undefined);
    setBusy(true);
    try {
      await api.post('/auth/reset-password', { token, newPassword: password });
      toast.success('Mot de passe modifié. Connectez-vous avec le nouveau.');
      navigate('/connexion', { replace: true });
    } catch (err) {
      setError(isApiError(err) ? err.message : 'La réinitialisation a échoué. Réessayez.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Nouveau mot de passe" subtitle="Choisissez un mot de passe que vous n'utilisez nulle part ailleurs. Vos autres sessions seront fermées." footer={<Link to="/connexion" className="text-accent-ink underline-offset-4 hover:underline">Retour à la connexion</Link>}>
      {!token ? (
        <FormAlert>Ce lien est incomplet. Demandez-en un nouveau depuis « Mot de passe oublié ».</FormAlert>
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-col gap-5">
          {error && <FormAlert>{error}</FormAlert>}
          <Field label="Nouveau mot de passe" error={fieldError} hint="10 caractères au moins, avec une lettre et un chiffre." required>{(c) => <PasswordInput {...c} autoComplete="new-password" value={password} onChange={(ev) => setPassword(ev.target.value)} autoFocus />}</Field>
          <Field label="Confirmer le mot de passe" required>{(c) => <PasswordInput {...c} autoComplete="new-password" value={confirm} onChange={(ev) => setConfirm(ev.target.value)} />}</Field>
          <Button type="submit" variant="primary" size="lg" loading={busy}>Enregistrer le mot de passe</Button>
        </form>
      )}
    </AuthLayout>
  );
}
