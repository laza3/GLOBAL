/**
 * Pont « navigateur » : reproduit `window.gp` (normalement fourni par Electron) au-dessus de l'API HTTP du serveur.
 * Aucun jeton n'est lisible ici : la session vit dans un cookie HttpOnly posé par le serveur.
 * Sans effet dans l'application Windows (le préchargement a déjà défini window.gp).
 */
type Envelope = { ok: true; data: any } | { ok: false; error: { code: string; message: string; details?: unknown } };

async function post(path: string, body: unknown): Promise<Envelope> {
  let res: Response;
  try {
    res = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-GP-Request': '1' }, body: JSON.stringify(body) });
  } catch {
    return { ok: false, error: { code: 'NETWORK', message: 'Connexion au serveur impossible. Vérifiez votre accès Internet.' } };
  }
  try { return (await res.json()) as Envelope; } catch { return { ok: false, error: { code: 'HTTP_' + res.status, message: 'Réponse inattendue du serveur (' + res.status + ')' } }; }
}

function download(f: { filename: string; mime: string; base64: string }) {
  const bin = atob(f.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: f.mime }));
  const a = document.createElement('a');
  a.href = url; a.download = f.filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return f.filename;
}

/** Impression par le navigateur (ticket, facture, rapport) : « Enregistrer au format PDF » possible dans la boîte d'impression. */
function printHtml(html: string) {
  return new Promise<boolean>((resolve) => {
    const f = document.createElement('iframe');
    f.setAttribute('aria-hidden', 'true');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    f.srcdoc = html;
    f.onload = () => {
      const w = f.contentWindow;
      if (!w) { f.remove(); resolve(false); return; }
      w.onafterprint = () => { f.remove(); resolve(true); };
      setTimeout(() => { try { w.focus(); w.print(); } catch { /* ignore */ } }, 150);
      setTimeout(() => { f.remove(); resolve(true); }, 120_000);
    };
    document.body.appendChild(f);
  });
}

function pickImage(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = 'image/png,image/jpeg,image/webp,image/svg+xml';
    i.onchange = () => {
      const f = i.files?.[0];
      if (!f) return resolve(null);
      if (f.size > 400_000) return reject(new Error('Image trop volumineuse (400 Ko maximum)'));
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error('Lecture de l’image impossible'));
      r.readAsDataURL(f);
    };
    i.oncancel = () => resolve(null);
    i.click();
  });
}

const ok = (data: any): Envelope => ({ ok: true, data });
const err = (message: string): Envelope => ({ ok: false, error: { code: 'ERROR', message } });

async function system(op: string, params: any): Promise<Envelope> {
  try {
    switch (op) {
      case 'print': case 'savePdf': return ok(await printHtml(String(params.html)) ? (op === 'savePdf' ? 'impression' : true) : null);
      case 'pickImage': return ok(await pickImage());
      case 'backup': { const r = await post('/api/system', { op }); return r.ok ? ok(download(r.data)) : r; }
      case 'exportReport': {
        const r = await post('/api/system', { op, params });
        if (!r.ok) return r;
        if (r.data.printHtml) { await printHtml(r.data.printHtml); return ok('impression'); }
        return ok(download(r.data));
      }
    }
  } catch (e) { return err((e as Error).message); }
  return post('/api/system', { op, params });
}

if (!(window as any).gp) {
  (window as any).gp = {
    platform: 'web',
    call: (method: string, params?: unknown) => post('/api/call', { method, params }),
    system,
    onUpdate: () => () => {},
  };
}
export {};
