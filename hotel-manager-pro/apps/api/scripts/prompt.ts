/**
 * Saisie d'un mot de passe au terminal : chaque caractère tapé s'affiche sous forme d'étoile (*), jamais en clair.
 * (Une saisie totalement invisible déroute : on croit que le clavier ne répond pas.) Retour arrière et collage fonctionnent.
 * Sans terminal (entrée redirigée), on lit simplement une ligne.
 */
import { createInterface } from 'node:readline';

export function askHidden(label: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    return new Promise((resolve) => {
      const rl = createInterface({ input: stdin, output: process.stdout, terminal: false });
      process.stdout.write(label);
      rl.question('', (answer) => { rl.close(); resolve(answer); });
    });
  }
  return new Promise((resolve) => {
    process.stdout.write(label);
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const finish = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\n');
      resolve(value);
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return finish();
        if (ch === '\u0003') { process.stdout.write('\n'); process.exit(130); } // Ctrl+C
        if (ch === '\u007f' || ch === '\b') {
          if (value.length > 0) { value = value.slice(0, -1); process.stdout.write('\b \b'); }
          continue;
        }
        if (ch < ' ') continue; // autres touches de contrôle : ignorées
        value += ch;
        process.stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}
