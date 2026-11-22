import { ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { isApiError } from '../../api/client';
import { usePlatformLogin } from '../../api/platform';
import { RedirectIfPlatformAuthenticated } from '../../auth/platform-session';
import { PageBackdrop } from '../../auth/screens';
import { emailProblem, feedbackFrom, requiredProblem, type FormFeedback } from '../../lib/forms';
import { useDocumentTitle } from '../../lib/use-title';
import { Button } from '../../ui/button';
import { Field, Input, PasswordInput } from '../../ui/form';
import { BrandMark } from '../../ui/shell';
import { FormAlert } from '../auth/layout';

export function PlatformLoginPage() {
  useDocumentTitle('Connexion à la console');
  return (
    <RedirectIfPlatformAuthenticated>
      <Form />
    </RedirectIfPlatformAuthenticated>
  );
}

function Form() {
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from;
  const login = usePlatformLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needCode, setNeedCode] = useState(false);
  const [feedback, setFeedback] = useState<FormFeedback>({ fields: {} });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const fields: Record<string, string> = {};
    const ep = emailProblem(email);
    if (ep) fields.email = ep;
    const pp = requiredProblem(password, 'Le mot de passe');
    if (pp) fields.password = pp;
    if (needCode && !code.trim()) fields.code = 'Saisissez le code de votre application (ou un code de secours).';
    if (Object.keys(fields).length) return setFeedback({ fields });
    setFeedback({ fields: {} });
    login.mutate(
      { email: email.trim(), password, code: needCode ? code.trim() : undefined },
      {
        onSuccess: () => navigate(from && from.startsWith('/platform') ? from : '/platform/dashboard', { replace: true }),
        onError: (err) => {
          if (isApiError(err) && err.code === 'totp_required') { setNeedCode(true); return setFeedback({ fields: {} }); }
          setFeedback(feedbackFrom(err));
        },
      },
    );
  };

  return (
    <PageBackdrop>
      <main id="main" className="grid min-h-dvh place-items-center p-4">
        <div className="surface glass-3 flex w-full max-w-md flex-col gap-6 p-8 [--surface-radius:var(--r-hero)]">
          <BrandMark label="Console" />
          <header className="flex flex-col gap-1.5">
            <h1 className="flex items-center gap-2.5 text-[24px] font-semibold tracking-[-0.02em] text-ink">
              <ShieldCheck aria-hidden className="size-6 text-champagne-ink" />
              Console de la plateforme
            </h1>
            <p className="text-[14px] leading-snug text-ink-2">Accès réservé aux administrateurs de Hotel Manager Pro. Chaque action est journalisée.</p>
          </header>
          <form onSubmit={submit} noValidate className="flex flex-col gap-5">
            {feedback.general && <FormAlert>{feedback.general}</FormAlert>}
            <Field label="Adresse e-mail" error={feedback.fields.email} required>
              {(c) => <Input {...c} type="email" autoComplete="username" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />}
            </Field>
            <Field label="Mot de passe" error={feedback.fields.password} required>
              {(c) => <PasswordInput {...c} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
            </Field>
            {needCode && (
              <Field label="Code de vérification" error={feedback.fields.code} hint="6 chiffres de votre application d'authentification, ou un code de secours." required>
                {(c) => <Input {...c} inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />}
              </Field>
            )}
            <Button type="submit" variant="primary" size="lg" loading={login.isPending}>
              Se connecter
            </Button>
          </form>
        </div>
      </main>
    </PageBackdrop>
  );
}
