import nodemailer from 'nodemailer';

export interface MailMessage { to: string; subject: string; text: string }
export interface Mailer {
  /** `true` si le message est réellement parti vers un fournisseur ; `false` s'il n'y en a pas (rien n'est simulé). */
  readonly configured: boolean;
  send(message: MailMessage): Promise<boolean>;
}

/**
 * E-mails transactionnels. Sans `SMTP_URL`, AUCUN e-mail ne part : l'API le dit dans ses journaux (sans le contenu, qui porte un lien secret)
 * et l'interface n'affirme jamais « un e-mail vous a été envoyé » comme une certitude.
 */
export function createMailer(opts: { smtpUrl?: string; from: string; log: (msg: string) => void }): Mailer {
  if (!opts.smtpUrl) {
    return {
      configured: false,
      async send(m) { opts.log(`E-mail non envoyé (SMTP_URL non configuré) : « ${m.subject} » pour ${m.to.replace(/^(.).*(@.*)$/, '$1***$2')}`); return false; },
    };
  }
  const transport = nodemailer.createTransport(opts.smtpUrl);
  return {
    configured: true,
    async send(m) {
      await transport.sendMail({ from: opts.from, to: m.to, subject: m.subject, text: m.text });
      return true;
    },
  };
}
