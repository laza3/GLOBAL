import { PASSWORD_HINT, passwordProblem } from '@hmp/shared';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useRegisterHotel } from '../../api/hotel';
import { RedirectIfAuthenticated } from '../../auth/session';
import { emailProblem, feedbackFrom, requiredProblem, type FormFeedback } from '../../lib/forms';
import { Button } from '../../ui/button';
import { Checkbox, Field, Input, PasswordInput } from '../../ui/form';
import { AuthLayout, FormAlert } from './layout';

export function RegisterPage() {
  return (
    <RedirectIfAuthenticated>
      <RegisterForm />
    </RedirectIfAuthenticated>
  );
}

function RegisterForm() {
  const navigate = useNavigate();
  const register = useRegisterHotel();
  const [v, setV] = useState({ hotelName: '', city: '', ownerName: '', email: '', password: '' });
  const [accepted, setAccepted] = useState(false);
  const [feedback, setFeedback] = useState<FormFeedback>({ fields: {} });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const fields: Record<string, string> = {};
    const checks: Array<[string, string | null]> = [
      ['hotelName', requiredProblem(v.hotelName, "Le nom de l'établissement", 2)],
      ['ownerName', requiredProblem(v.ownerName, 'Votre nom', 2)],
      ['email', emailProblem(v.email)],
      ['password', passwordProblem(v.password, v.email.trim())],
      ['acceptTerms', accepted ? null : "Vous devez accepter les conditions d'utilisation pour continuer."],
    ];
    for (const [k, problem] of checks) if (problem) fields[k] = problem;
    if (Object.keys(fields).length) return setFeedback({ fields });
    setFeedback({ fields: {} });
    register.mutate(
      { hotelName: v.hotelName.trim(), city: v.city.trim() || undefined, ownerName: v.ownerName.trim(), email: v.email.trim(), password: v.password, acceptTerms: true },
      {
        onSuccess: (me) => {
          toast.success(me.trialStarted ? 'Votre établissement est créé. Votre essai gratuit a commencé.' : 'Votre établissement est créé.');
          navigate('/overview', { replace: true });
        },
        onError: (err) => setFeedback(feedbackFrom(err, { email_already_registered: 'email', weak_password: 'password' })),
      },
    );
  };

  return (
    <AuthLayout
      title="Créer mon établissement"
      subtitle="Quelques informations suffisent pour commencer. Vous pourrez tout compléter ensuite."
      footer={
        <p>
          Déjà un compte ?{' '}
          <Link to="/connexion" className="font-medium text-accent-ink underline underline-offset-4">
            Se connecter
          </Link>
        </p>
      }
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        {feedback.general && <FormAlert>{feedback.general}</FormAlert>}
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Nom de l'établissement" error={feedback.fields.hotelName} required className="sm:col-span-2">
            {(c) => <Input {...c} autoComplete="organization" value={v.hotelName} onChange={set('hotelName')} autoFocus />}
          </Field>
          <Field label="Ville (facultatif)" error={feedback.fields.city}>
            {(c) => <Input {...c} autoComplete="address-level2" value={v.city} onChange={set('city')} />}
          </Field>
          <Field label="Votre nom" error={feedback.fields.ownerName} required>
            {(c) => <Input {...c} autoComplete="name" value={v.ownerName} onChange={set('ownerName')} />}
          </Field>
        </div>
        <Field label="Adresse e-mail" hint="Elle sert d'identifiant de connexion." error={feedback.fields.email} required>
          {(c) => <Input {...c} type="email" autoComplete="username" inputMode="email" value={v.email} onChange={set('email')} />}
        </Field>
        <Field label="Mot de passe" hint={PASSWORD_HINT} error={feedback.fields.password} required>
          {(c) => <PasswordInput {...c} autoComplete="new-password" value={v.password} onChange={set('password')} />}
        </Field>
        <div className="flex flex-col gap-1.5">
          <Checkbox
            label="J'accepte les conditions d'utilisation et la politique de confidentialité"
            checked={accepted}
            onCheckedChange={(c) => setAccepted(c === true)}
            aria-invalid={feedback.fields.acceptTerms ? true : undefined}
            aria-describedby={feedback.fields.acceptTerms ? 'terms-error' : undefined}
          />
          {feedback.fields.acceptTerms && (
            <p id="terms-error" role="alert" className="text-[13px] text-danger-ink">
              {feedback.fields.acceptTerms}
            </p>
          )}
          <p className="text-[13px] text-ink-3">
            Lire les{' '}
            <Link to="/conditions" target="_blank" className="underline underline-offset-4">
              conditions d&apos;utilisation
            </Link>{' '}
            et la{' '}
            <Link to="/confidentialite" target="_blank" className="underline underline-offset-4">
              politique de confidentialité
            </Link>
            .
          </p>
        </div>
        <Button type="submit" variant="primary" size="lg" loading={register.isPending}>
          Créer mon établissement
        </Button>
      </form>
    </AuthLayout>
  );
}
