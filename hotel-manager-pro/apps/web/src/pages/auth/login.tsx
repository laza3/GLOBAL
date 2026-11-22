import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useLogin } from '../../api/hotel';
import { useT } from '../../i18n';
import { RedirectIfAuthenticated } from '../../auth/session';
import { emailProblem, feedbackFrom, requiredProblem, type FormFeedback } from '../../lib/forms';
import { Button } from '../../ui/button';
import { Field, Input, PasswordInput } from '../../ui/form';
import { AuthLayout, FormAlert } from './layout';

export function LoginPage() {
  return (
    <RedirectIfAuthenticated>
      <LoginForm />
    </RedirectIfAuthenticated>
  );
}

function LoginForm() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const t = useT();
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [feedback, setFeedback] = useState<FormFeedback>({ fields: {} });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const fields: Record<string, string> = {};
    const ep = emailProblem(email);
    if (ep) fields.email = ep;
    const pp = requiredProblem(password, 'Le mot de passe');
    if (pp) fields.password = pp;
    if (Object.keys(fields).length) return setFeedback({ fields });
    setFeedback({ fields: {} });
    login.mutate(
      { email: email.trim(), password },
      {
        onSuccess: () => navigate(from && from.startsWith('/') && !from.startsWith('//') ? from : '/overview', { replace: true }),
        onError: (err) => setFeedback(feedbackFrom(err)),
      },
    );
  };

  return (
    <AuthLayout
      title="Connexion"
      subtitle="Accédez à l'espace de votre établissement."
      footer={
        <p>
          Pas encore de compte ?{' '}
          <Link to="/inscription" className="font-medium text-accent-ink underline underline-offset-4">
            Créer mon établissement
          </Link>
        </p>
      }
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        {feedback.general && <FormAlert>{feedback.general}</FormAlert>}
        <Field label={t('auth.email')} error={feedback.fields.email} required>
          {(c) => <Input {...c} type="email" autoComplete="username" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />}
        </Field>
        <Field label={t('auth.password')} error={feedback.fields.password} required>
          {(c) => <PasswordInput {...c} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={login.isPending}>
          {t('auth.login.submit')}
        </Button>
        <p className="text-[13px] leading-snug text-ink-3">
          <Link to="/mot-de-passe-oublie" className="font-medium text-accent-ink underline-offset-4 hover:underline">{t('auth.forgot')}</Link>{' '}
          Vous recevrez un lien par e-mail, si le service d&apos;e-mail est configuré sur ce serveur ; sinon, un administrateur de votre établissement peut le réinitialiser.
        </p>
      </form>
    </AuthLayout>
  );
}
