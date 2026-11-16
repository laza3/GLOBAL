import { useCallback, useEffect, useState } from 'react';
import { CircleCheck, Download, Loader2, RefreshCw, RotateCw } from 'lucide-react';
import { Button, ConfirmDialog, Card, useToast, cx } from './ui';
import { system } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useT } from '../lib/i18n';

export interface UpdateState { enabled?: boolean; status: 'idle' | 'checking' | 'available' | 'none' | 'downloading' | 'ready' | 'error'; version?: string; percent?: number; message?: string }

export function useUpdate() {
  const [st, setSt] = useState<UpdateState>({ status: 'idle' });
  const { push } = useToast();
  useEffect(() => {
    system<UpdateState>('update', { op: 'state' }).then(setSt).catch(() => {});
    return window.gp.onUpdate((s: UpdateState) => setSt((c) => ({ ...c, ...s, enabled: true })));
  }, []);
  const run = useCallback(async (op: 'check' | 'download' | 'install') => {
    try { await system('update', { op }); } catch (e) { push('error', (e as Error).message); }
  }, [push]);
  return { st, run };
}

/** Pastille dans l'en-tête : visible dès qu'une version est disponible, téléchargée ou en cours de téléchargement. */
export function UpdatePill() {
  const { t } = useT();
  const { can } = useAuth();
  const { st, run } = useUpdate();
  const [confirm, setConfirm] = useState(false);
  if (!['available', 'downloading', 'ready'].includes(st.status)) return null;
  const allowed = can('settings.manage');
  const label = st.status === 'available' ? t('Version {v} disponible', { v: st.version ?? '' }) : st.status === 'downloading' ? t('Téléchargement… {p} %', { p: st.percent ?? 0 }) : t('Redémarrer pour installer {v}', { v: st.version ?? '' });
  const Icon = st.status === 'downloading' ? Loader2 : st.status === 'ready' ? RotateCw : Download;
  return (
    <>
      <button disabled={!allowed || st.status === 'downloading'} onClick={() => (st.status === 'available' ? run('download') : st.status === 'ready' && setConfirm(true))}
        title={allowed ? undefined : t('Seul un administrateur peut installer une mise à jour.')}
        className={cx('flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition', st.status === 'ready' ? 'bg-emerald-500 text-white hover:bg-emerald-600' : 'bg-gold-400 text-ink-950 hover:bg-gold-300', (!allowed || st.status === 'downloading') && 'opacity-80')}>
        <Icon className={cx('size-3.5', st.status === 'downloading' && 'animate-spin')} /><span>{label}</span>
      </button>
      <ConfirmDialog open={confirm} title="Installer la mise à jour" message="L'application va se fermer puis se relancer automatiquement. Une sauvegarde de vos données est créée avant l'installation. Terminez d'abord la vente en cours." confirmLabel="Redémarrer et installer" onClose={() => setConfirm(false)} onConfirm={() => run('install')} />
    </>
  );
}

/** Carte « Mises à jour » (Administration → Sauvegardes). */
export function UpdateCard({ version }: { version?: string }) {
  const { t } = useT();
  const { can } = useAuth();
  const { st, run } = useUpdate();
  const [confirm, setConfirm] = useState(false);
  const busy = st.status === 'checking' || st.status === 'downloading';
  const msg = ({
    idle: t('Aucune vérification récente.'), checking: t('Recherche en cours…'), none: t('Vous utilisez la dernière version.'),
    available: t('Version {v} disponible.', { v: st.version ?? '' }), downloading: t('Téléchargement… {p} %', { p: st.percent ?? 0 }),
    ready: t('Version {v} prête à être installée.', { v: st.version ?? '' }), error: t('Vérification impossible (connexion Internet ?)'),
  } as Record<string, string>)[st.status];
  return (
    <Card className="p-5 lg:col-span-2">
      <h3 className="flex items-center gap-2 font-semibold"><RefreshCw className="size-4 text-gold-500" />{t('Mises à jour')}</h3>
      <p className="mt-1 text-sm text-ink-500">{t('Version installée')} : <b>{version ?? '—'}</b></p>
      {st.enabled === false ? <p className="mt-3 text-sm text-ink-400">{t('Les mises à jour automatiques sont disponibles dans l’application installée (pas en mode développement).')}</p> : (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className={cx('flex items-center gap-1.5 text-sm', st.status === 'error' && 'text-red-600', st.status === 'none' && 'text-emerald-600')}>{st.status === 'none' && <CircleCheck className="size-4" />}{msg}</span>
          {can('settings.manage') && <>
            {(st.status === 'idle' || st.status === 'none' || st.status === 'error') && <Button size="sm" onClick={() => run('check')} icon={<RefreshCw className="size-4" />}>{t('Rechercher les mises à jour')}</Button>}
            {st.status === 'available' && <Button size="sm" variant="gold" onClick={() => run('download')} icon={<Download className="size-4" />}>{t('Télécharger')}</Button>}
            {st.status === 'ready' && <Button size="sm" variant="gold" onClick={() => setConfirm(true)} icon={<RotateCw className="size-4" />}>{t('Redémarrer et installer')}</Button>}
            {busy && <Loader2 className="size-4 animate-spin text-ink-400" />}
          </>}
        </div>
      )}
      <p className="mt-3 text-xs text-ink-400">{t('Vos données ne sont jamais touchées par une mise à jour ; une sauvegarde est créée automatiquement avant l’installation.')}</p>
      <ConfirmDialog open={confirm} title="Installer la mise à jour" message="L'application va se fermer puis se relancer automatiquement. Une sauvegarde de vos données est créée avant l'installation. Terminez d'abord la vente en cours." confirmLabel="Redémarrer et installer" onClose={() => setConfirm(false)} onConfirm={() => run('install')} />
    </Card>
  );
}
