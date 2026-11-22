import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { isApiError } from '../../api/client';
import { api } from '../../api/client';
import { RedirectIfAuthenticated } from '../../auth/session';
import { emailProblem } from '../../lib/forms';
import { useDocumentTitle } from '../../lib/use-title';
import { Button } from '../../ui/button';
import { Field, Input } from '../../ui/form';
import { Callout } from '../../ui/page';
import { AuthLayout, FormAlert } from './layout';

export function ForgotPasswordPage() {
  useDocumentTitle('Mot de passe oublié');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const problem = emailProblem(email);
    setFieldError(problem ?? undefined);
    if (problem) return;
    setBusy(true);
    try {
      await api.post('/auth/forgot-password', { email: email.trim() });
      setSent(true);
    } catch (err) {
      setError(isApiError(err) ? err.message : 'La demande a échoué. Réessayez.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <RedirectIfAuthenticated>
      <AuthLayout title="Mot de passe oublié" subtitle="Indiquez votre adresse e-mail : si elle correspond à un compte, un lien de réinitialisation y sera envoyé." footer={<Link to="/connexion" className="text-accent-ink underline-offset-4 hover:underline">Retour à la connexion</Link>}>
        {sent ? (
          <div className="flex flex-col gap-4" role="status">
            <Callout tone="info">Si un compte existe pour cette adresse, un e-mail avec un lien (valable 60 minutes) vient d&apos;être envoyé. Pensez à vérifier vos courriers indésirables.</Callout>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="flex flex-col gap-5">
            {error && <FormAlert>{error}</FormAlert>}
            <Field label="Adresse e-mail" error={fieldError} required>
              {(c) => <Input {...c} type="email" autoComplete="username" inputMode="email" value={email} onChange={(ev) => setEmail(ev.target.value)} autoFocus />}
            </Field>
            <Button type="submit" variant="primary" size="lg" loading={busy}>Envoyer le lien</Button>
          </form>
        )}
      </AuthLayout>
    </RedirectIfAuthenticated>
  );
}
