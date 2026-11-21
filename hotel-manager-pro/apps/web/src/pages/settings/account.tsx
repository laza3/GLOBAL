import { PASSWORD_HINT, passwordProblem } from '@hmp/shared';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useChangePassword } from '../../api/hotel';
import { useMe } from '../../auth/session';
import { feedbackFrom, requiredProblem, type FormFeedback } from '../../lib/forms';
import { useDocumentTitle } from '../../lib/use-title';
import { Button } from '../../ui/button';
import { Field, PasswordInput } from '../../ui/form';
import { Callout, DefinitionList, Panel } from '../../ui/page';
import { ThemeToggle } from '../../ui/theme';

export default function AccountPage() {
  useDocumentTitle('Mon compte');
  const me = useMe();
  const change = useChangePassword();
  const [v, setV] = useState({ current: '', next: '', confirm: '' });
  const [feedback, setFeedback] = useState<FormFeedback>({ fields: {} });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const fields: Record<string, string> = {};
    const cur = requiredProblem(v.current, 'Le mot de passe actuel');
    if (cur) fields.currentPassword = cur;
    const next = passwordProblem(v.next, me.user.email);
    if (next) fields.newPassword = next;
    else if (v.next === v.current) fields.newPassword = "Le nouveau mot de passe doit être différent de l'actuel.";
    if (!fields.newPassword && v.confirm !== v.next) fields.confirm = 'Les deux saisies ne correspondent pas.';
    if (Object.keys(fields).length) return setFeedback({ fields });
    setFeedback({ fields: {} });
    change.mutate(
      { currentPassword: v.current, newPassword: v.next },
      {
        onSuccess: () => {
          setV({ current: '', next: '', confirm: '' });
          toast.success('Mot de passe modifié. Vos autres appareils ont été déconnectés.');
        },
        onError: (err) => setFeedback(feedbackFrom(err, { wrong_current_password: 'currentPassword', weak_password: 'newPassword' })),
      },
    );
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Mon profil">
        <DefinitionList
          items={[
            { label: 'Nom', value: me.user.fullName },
            { label: 'Adresse e-mail', value: me.user.email },
            { label: 'Rôle', value: me.role.name },
            { label: 'Établissement', value: me.hotel.name },
          ]}
        />
      </Panel>

      <Panel title="Apparence" description="Le thème s'applique à cet appareil.">
        <ThemeToggle className="self-start" />
      </Panel>

      <Panel title="Changer mon mot de passe" description="Vos autres appareils seront déconnectés." className="lg:col-span-2">
        <form onSubmit={submit} noValidate className="flex max-w-xl flex-col gap-5">
          {feedback.general && <Callout tone="danger">{feedback.general}</Callout>}
          <Field label="Mot de passe actuel" error={feedback.fields.currentPassword} required>
            {(c) => <PasswordInput {...c} autoComplete="current-password" value={v.current} onChange={set('current')} />}
          </Field>
          <Field label="Nouveau mot de passe" hint={PASSWORD_HINT} error={feedback.fields.newPassword} required>
            {(c) => <PasswordInput {...c} autoComplete="new-password" value={v.next} onChange={set('next')} />}
          </Field>
          <Field label="Confirmer le nouveau mot de passe" error={feedback.fields.confirm} required>
            {(c) => <PasswordInput {...c} autoComplete="new-password" value={v.confirm} onChange={set('confirm')} />}
          </Field>
          <Button type="submit" variant="primary" loading={change.isPending} className="self-start">
            Modifier le mot de passe
          </Button>
        </form>
      </Panel>
    </div>
  );
}
