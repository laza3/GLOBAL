import { app, BrowserWindow, dialog, ipcMain, session, shell, type WebContents } from 'electron';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { Db } from './core/db';
import { resetPasswordOffline } from './core/auth';
import { assertCanFactoryReset, deleteBackupFiles, resetBusinessData } from './core/reset';
import { App } from './core/api';
import { reportToCsv, reportToHtml, reportToXlsx, runReport } from './core/reports';
import { audit, nowIso } from './core/util';
import { DatabaseSync } from 'node:sqlite';
import { autoUpdater } from 'electron-updater';

// GP_FORCE_PROD=1 : exécute le build non empaqueté avec la configuration de production (CSP stricte) — utilisé par les tests e2e
const isDev = !app.isPackaged && process.env.GP_FORCE_PROD !== '1';
const dataDir = join(app.getPath('userData'), 'data');
const backupDir = join(app.getPath('userData'), 'backups');
const logFile = join(app.getPath('userData'), 'gp.log');
mkdirSync(dataDir, { recursive: true });
mkdirSync(backupDir, { recursive: true });

function log(msg: string, err?: unknown) {
  const line = `${new Date().toISOString()} ${msg}${err ? ' ' + (err instanceof Error ? err.stack : String(err)) : ''}\n`;
  try { appendFileSync(logFile, line); } catch { /* ignore */ }
  if (isDev) console.error(line);
}

const dbPath = process.env.GP_DB_PATH || join(dataDir, 'gp-business.db');
// Récupération : « GP Business Manager.exe --reset-password=NouveauMotDePasse [--user=identifiant] » (application fermée)
const cliArg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
if (cliArg('reset-password') !== undefined) {
  const showResult = (type: 'info' | 'error', message: string) => { if (process.env.GP_NO_DIALOG === '1') console.log(message); else dialog.showMessageBoxSync({ type, title: 'GP Business Manager', message }); };
  try {
    const d = new Db(dbPath);
    const r = resetPasswordOffline(d, cliArg('reset-password')!, cliArg('user'));
    d.close();
    log(`Mot de passe réinitialisé en ligne de commande pour « ${r.username} »`);
    showResult('info', `Mot de passe réinitialisé pour « ${r.username} ». Vous pouvez relancer GP Business Manager et vous connecter.`);
  } catch (e) {
    showResult('error', `Impossible de réinitialiser le mot de passe : ${(e as Error).message}`);
  }
  app.exit(0);
  process.exit(0);
}
let db = new Db(dbPath);
let core = new App(db, log);
const tokens = new Map<number, string>(); // webContents.id → jeton : le renderer ne voit JAMAIS le jeton
let win: BrowserWindow | null = null;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

function autoBackup() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const file = join(backupDir, `auto-${today}.db`);
    if (!existsSync(file)) db.backupTo(file);
    const old = readdirSync(backupDir).filter((f) => f.startsWith('auto-')).sort().slice(0, -14);
    for (const f of old) unlinkSync(join(backupDir, f));
  } catch (e) { log('Sauvegarde automatique impossible', e); }
}

function senderId(e: Electron.IpcMainInvokeEvent) { return e.sender.id; }
function assertTrusted(e: Electron.IpcMainInvokeEvent) {
  const url = e.senderFrame?.url ?? '';
  if (!(url.startsWith('file://') || (isDev && url.startsWith('http://localhost')))) throw new Error('Origine non autorisée');
}

ipcMain.handle('gp:call', async (e, method: string, params: unknown) => {
  assertTrusted(e);
  const id = senderId(e);
  const r = await core.call(method, params, tokens.get(id));
  if (r.ok && (method === 'auth.login' || method === 'app.setup')) {
    const d = r.data as { token: string; user: unknown };
    tokens.set(id, d.token);
    return { ok: true, data: d.user };
  }
  if (method === 'auth.logout') tokens.delete(id);
  if (!r.ok && r.error.code === 'UNAUTHENTICATED') tokens.delete(id);
  return r;
});

const ctxOf = (e: Electron.IpcMainInvokeEvent) => core.sessions.resolve(tokens.get(senderId(e)));
const need = (ctx: ReturnType<typeof ctxOf>, p: string) => { if (!ctx.user.permissions.has(p)) throw new Error(`Permission requise : ${p}`); };
const wrap = <T>(fn: () => Promise<T> | T) => Promise.resolve().then(fn).then((data) => ({ ok: true as const, data }), (e) => ({ ok: false as const, error: { code: e?.code ?? 'ERROR', message: e?.message ?? String(e) } }));

function printWindow(html: string) {
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  return w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)).then(() => w);
}

ipcMain.handle('gp:system', (e, op: string, p: any) => {
  assertTrusted(e);
  return wrap(async () => {
    const parent = BrowserWindow.fromWebContents(e.sender) ?? undefined;
    switch (op) {
      case 'info': return { version: app.getVersion(), dataDir, backupDir, dbPath, platform: process.platform };
      case 'factoryReset': {
        // Remise à zéro du CONTENU de gestion (comptes et paramètres conservés) : profil Administrateur, mot de passe + phrase exigés ICI
        const ctx = ctxOf(e);
        assertCanFactoryReset(ctx, String(p?.password ?? ''), String(p?.confirm ?? ''));
        log(`Réinitialisation des données demandée par ${ctx.user.username} (sauvegardes supprimées : ${!!p?.deleteBackups})`);
        // copie de sécurité automatique (sauf si l'administrateur demande aussi la suppression des sauvegardes)
        if (!p?.deleteBackups) db.backupTo(join(backupDir, `avant-reinitialisation-${Date.now()}.db`));
        const r = resetBusinessData(db);
        if (p?.deleteBackups) deleteBackupFiles(backupDir);
        return { ok: true, ...r };
      }
      case 'update': {
        const ctx = ctxOf(e);
        if (p?.op === 'state') return { enabled: updaterOn, ...updateState };
        need(ctx, 'settings.manage');
        if (!updaterOn) throw new Error('Mises à jour automatiques non disponibles dans cette version (installation de développement).');
        if (p?.op === 'check') { pushUpdate({ status: 'checking' }); await autoUpdater.checkForUpdates().catch((err) => pushUpdate({ status: 'error', message: err?.message ?? String(err) })); return { ...updateState }; }
        if (p?.op === 'download') { if (updateState.status !== 'available') throw new Error('Aucune mise à jour à télécharger'); void autoUpdater.downloadUpdate().catch((err) => pushUpdate({ status: 'error', message: err?.message ?? String(err) })); return true; }
        if (p?.op === 'install') {
          if (updateState.status !== 'ready') throw new Error('La mise à jour n’est pas encore téléchargée');
          // sauvegarde de sécurité, puis fermeture propre de la base avant l'installateur
          db.backupTo(join(backupDir, `avant-mise-a-jour-${updateState.version}-${Date.now()}.db`));
          audit(ctx, 'app.update_install', 'app', undefined, { to: updateState.version });
          db.close();
          setImmediate(() => autoUpdater.quitAndInstall(true, true));
          return true;
        }
        throw new Error('Opération inconnue');
      }
      case 'print': {
        ctxOf(e);
        const w = await printWindow(String(p.html));
        await new Promise<void>((res) => w.webContents.print({ silent: !!p.silent, printBackground: true, deviceName: p.deviceName || undefined, pageSize: p.pageSize }, () => res()));
        w.close();
        return true;
      }
      case 'savePdf': {
        ctxOf(e);
        const w = await printWindow(String(p.html));
        const buf = await w.webContents.printToPDF({ printBackground: true, pageSize: p.pageSize ?? 'A4', landscape: !!p.landscape });
        w.close();
        const r = await dialog.showSaveDialog(parent!, { defaultPath: p.filename ?? 'document.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] });
        if (r.canceled || !r.filePath) return null;
        writeFileSync(r.filePath, buf);
        return r.filePath;
      }
      case 'exportReport': {
        const ctx = ctxOf(e);
        need(ctx, 'report.export');
        const rep = runReport(ctx, p.query);
        const fmt = p.format as 'csv' | 'xlsx' | 'pdf';
        const base = `${rep.type}-${new Date().toISOString().slice(0, 10)}`;
        const filters = { csv: [{ name: 'CSV', extensions: ['csv'] }], xlsx: [{ name: 'Excel', extensions: ['xlsx'] }], pdf: [{ name: 'PDF', extensions: ['pdf'] }] }[fmt];
        const r = await dialog.showSaveDialog(parent!, { defaultPath: `${base}.${fmt}`, filters });
        if (r.canceled || !r.filePath) return null;
        if (fmt === 'csv') writeFileSync(r.filePath, reportToCsv(ctx, rep), 'utf8');
        else if (fmt === 'xlsx') writeFileSync(r.filePath, await reportToXlsx(ctx, rep));
        else {
          const w = await printWindow(reportToHtml(ctx, rep));
          writeFileSync(r.filePath, await w.webContents.printToPDF({ printBackground: true, pageSize: 'A4', landscape: rep.columns.length > 6 }));
          w.close();
        }
        return r.filePath;
      }
      case 'backup': {
        need(ctxOf(e), 'backup.manage');
        const r = await dialog.showSaveDialog(parent!, { defaultPath: `gp-sauvegarde-${new Date().toISOString().slice(0, 10)}.gpbak`, filters: [{ name: 'Sauvegarde GP', extensions: ['gpbak'] }] });
        if (r.canceled || !r.filePath) return null;
        if (existsSync(r.filePath)) unlinkSync(r.filePath);
        db.backupTo(r.filePath);
        return r.filePath;
      }
      case 'restore': {
        need(ctxOf(e), 'backup.manage');
        const r = await dialog.showOpenDialog(parent!, { properties: ['openFile'], filters: [{ name: 'Sauvegarde GP', extensions: ['gpbak', 'db'] }] });
        if (r.canceled || !r.filePaths[0]) return null;
        // contrôle d'intégrité avant de remplacer la base
        const probe = new DatabaseSync(r.filePaths[0], { readOnly: true });
        try {
          const ok = probe.prepare('PRAGMA integrity_check').get() as any;
          const has = probe.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('company','sales','users')").get() as any;
          if (Object.values(ok)[0] !== 'ok' || has.n < 3) throw new Error("Fichier de sauvegarde invalide ou corrompu");
        } finally { probe.close(); }
        const safety = join(backupDir, `avant-restauration-${Date.now()}.db`);
        db.backupTo(safety);
        db.close();
        for (const ext of ['', '-wal', '-shm']) if (existsSync(dbPath + ext)) unlinkSync(dbPath + ext);
        copyFileSync(r.filePaths[0], dbPath);
        app.relaunch();
        app.exit(0);
        return true;
      }
      case 'pickImage': {
        ctxOf(e);
        const r = await dialog.showOpenDialog(parent!, { properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }] });
        if (r.canceled || !r.filePaths[0]) return null;
        const f = r.filePaths[0];
        if (statSync(f).size > 400_000) throw new Error('Image trop volumineuse (400 Ko maximum)');
        const ext = extname(f).slice(1).toLowerCase().replace('jpg', 'jpeg').replace('svg', 'svg+xml');
        return `data:image/${ext};base64,${readFileSync(f).toString('base64')}`;
      }
      case 'openDataFolder': { await shell.openPath(dataDir); return true; }
      case 'listPrinters': { const list = await e.sender.getPrintersAsync(); return list.map((x: any) => ({ name: x.name, isDefault: !!x.isDefault })); }
      case 'listBackups': return readdirSync(backupDir).sort().reverse().map((f) => ({ name: f, size: statSync(join(backupDir, f)).size }));
    }
    throw new Error('Opération inconnue');
  });
});

// ---------- mises à jour automatiques (GitHub Releases) ----------
type UpdateState = { status: 'idle' | 'checking' | 'available' | 'none' | 'downloading' | 'ready' | 'error'; version?: string; percent?: number; message?: string };
let updateState: UpdateState = { status: 'idle' };
let updaterOn = false;
const pushUpdate = (s: UpdateState) => { updateState = s; win?.webContents.send('gp:update', s); };
/** GP_UPDATE_URL (tests) : source générique à la place de GitHub, utilisable hors application empaquetée. */
function setupUpdater() {
  const url = process.env.GP_UPDATE_URL;
  if (process.env.GP_NO_UPDATE === '1' || (!app.isPackaged && !url)) return;
  updaterOn = true;
  autoUpdater.autoDownload = false; // l'utilisateur décide (une vente ne doit jamais être interrompue)
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = { info: (m: unknown) => log(`[maj] ${m}`), warn: (m: unknown) => log(`[maj] ${m}`), error: (m: unknown) => log(`[maj] ${m}`) };
  if (url) { autoUpdater.forceDevUpdateConfig = true; autoUpdater.setFeedURL({ provider: 'generic', url }); }
  autoUpdater.on('checking-for-update', () => pushUpdate({ status: 'checking' }));
  autoUpdater.on('update-available', (i) => pushUpdate({ status: 'available', version: i.version }));
  autoUpdater.on('update-not-available', () => pushUpdate({ status: 'none' }));
  autoUpdater.on('download-progress', (p) => pushUpdate({ status: 'downloading', version: updateState.version, percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => pushUpdate({ status: 'ready', version: i.version }));
  autoUpdater.on('error', (e) => pushUpdate({ status: 'error', message: e?.message ?? String(e) }));
  const check = (manual = false) => autoUpdater.checkForUpdates().catch((e) => { if (manual) pushUpdate({ status: 'error', message: e?.message ?? String(e) }); else { log('[maj] vérification impossible (hors ligne ?)', e); pushUpdate({ status: 'idle' }); } });
  setTimeout(() => check(), 20_000);
  setInterval(() => { if (!['downloading', 'ready'].includes(updateState.status)) void check(); }, 6 * 3600_000);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1024, minHeight: 640, show: false, backgroundColor: '#0f1424', title: 'GP Business Manager',
    icon: join(__dirname, '../../build/icon.png'),
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false },
  });
  win.removeMenu();
  win.once('ready-to-show', () => win?.show());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (ev, url) => { if (!url.startsWith('file://') && !(isDev && url.startsWith('http://localhost'))) ev.preventDefault(); });
  win.on('closed', () => { if (win) tokens.delete(win.webContents.id); win = null; });
  if (isDev && process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else win.loadFile(join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [isDev ? "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: http://localhost:* ws://localhost:*" : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"] } });
  });
  session.defaultSession.setPermissionRequestHandler((_wc: WebContents, _perm, cb) => cb(false));
  autoBackup();
  createWindow();
  setupUpdater();
  log(`Démarrage v${app.getVersion()} — base : ${dbPath}`);
  void nowIso;
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { try { db.close(); } catch { /* déjà fermée */ } });
void core; void db;
