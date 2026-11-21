import { BedDouble, Copy, Info, Moon, Pencil, Plus, Search, Sparkles, Sun, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { cn } from '../lib/cn';
import { Button } from '../ui/button';
import { BarList, ChartFigure, Legend, Ring, SegmentedBar, StatTile, TrendChart, fmt, type TrendPoint } from '../ui/charts';
import { Badge, DataTable, EmptyState, Skeleton, StatusBadge, VipBadge, type Column, type ReservationStatus } from '../ui/data';
import { Checkbox, Field, Input, SegmentedControl, Select, Switch, Textarea } from '../ui/form';
import { CommandPalette, ConfirmDialog, Drawer, Menu, Modal, Tip, useCommandShortcut, type CommandEntry } from '../ui/overlay';
import { ALL_NAV, BrandMark, ConnectionIndicator, Sidebar, TabBar, Topbar, useOnline } from '../ui/shell';
import { Tabs } from '../ui/tabs';
import { ThemeToggle, useTheme } from '../ui/theme';

/* =============================================================================================
 * Données d'exemple (illustratives : aucune donnée réelle, rien n'est enregistré)
 * =========================================================================================== */
interface Reservation {
  ref: string;
  guest: string;
  vip?: boolean;
  room: string;
  from: string;
  to: string;
  status: ReservationStatus;
  due: number;
}

const RESERVATIONS: Reservation[] = [
  { ref: 'RES-2041', guest: 'Hanitra Rasoamanana', vip: true, room: 'Suite 301', from: '2026-11-21', to: '2026-11-25', status: 'inhouse', due: 0 },
  { ref: 'RES-2042', guest: 'Sophie Martin', room: 'Chambre 204', from: '2026-11-22', to: '2026-11-24', status: 'confirmed', due: 180000 },
  { ref: 'RES-2043', guest: 'Andry Rakotoarisoa', room: 'Bungalow 2', from: '2026-11-23', to: '2026-11-27', status: 'pending', due: 540000 },
  { ref: 'RES-2044', guest: 'Jean-Luc Dubois', room: 'Chambre 112', from: '2026-11-19', to: '2026-11-21', status: 'departed', due: 0 },
  { ref: 'RES-2045', guest: 'Mialy Randrianasolo', vip: true, room: 'Villa 1', from: '2026-11-24', to: '2026-11-30', status: 'confirmed', due: 1260000 },
  { ref: 'RES-2046', guest: 'Thomas Keller', room: 'Chambre 207', from: '2026-11-20', to: '2026-11-22', status: 'noshow', due: 0 },
  { ref: 'RES-2047', guest: 'Lalaina Ravelomanana', room: 'Chambre 105', from: '2026-11-25', to: '2026-11-26', status: 'cancelled', due: 0 },
  { ref: 'RES-2048', guest: 'Marie Lefèvre', room: 'Suite 302', from: '2026-11-26', to: '2026-11-29', status: 'pending', due: 720000 },
];

const dayFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const stay = (r: Reservation) => `${dayFmt.format(new Date(r.from))} – ${dayFmt.format(new Date(r.to))}`;

type Period = '7j' | '30j' | '12m';
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

function trendFor(period: Period): { data: TrendPoint[]; names: [string, string] } {
  if (period === '12m') {
    const cur = [41, 44, 49, 55, 61, 66, 74, 81, 69, 62, 67, 76];
    const prev = [38, 41, 43, 51, 56, 60, 67, 72, 66, 59, 61, 68];
    return { names: ['2026', '2025'], data: MONTHS.map((label, i) => ({ label, current: cur[i]! * 1e6, previous: prev[i]! * 1e6 })) };
  }
  if (period === '7j') {
    const days = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
    const cur = [2.8, 3.1, 3.4, 3.9, 5.2, 6.1, 4.4];
    const prev = [2.5, 2.9, 3.2, 3.6, 4.8, 5.5, 4.6];
    return { names: ['Actuel', 'Préc.'], data: days.map((label, i) => ({ label, current: cur[i]! * 1e6, previous: prev[i]! * 1e6 })) };
  }
  return {
    names: ['Actuel', 'Préc.'],
    data: Array.from({ length: 30 }, (_, i) => {
      const weekend = i % 7 >= 4 ? 0.9e6 : 0;
      const current = 3.3e6 + 1.1e6 * Math.sin(i / 2.2) + weekend;
      return { label: `${i + 1} nov.`, current: Math.round(current), previous: Math.round(current * 0.9 + 0.2e6 * Math.cos(i / 3)) };
    }),
  };
}

const sum = (d: TrendPoint[], k: 'current' | 'previous') => d.reduce((s, p) => s + p[k], 0);

const SECTIONS = [
  { id: 'couleurs', label: 'Couleurs et verre' },
  { id: 'typographie', label: 'Typographie' },
  { id: 'formes', label: 'Formes et mouvement' },
  { id: 'actions', label: 'Boutons' },
  { id: 'formulaires', label: 'Formulaires' },
  { id: 'donnees', label: 'Données et graphiques' },
  { id: 'retours', label: 'États et notifications' },
  { id: 'superpositions', label: 'Fenêtres et menus' },
  { id: 'navigation', label: 'Navigation' },
];

/* =============================================================================================
 * Mise en page
 * =========================================================================================== */
function Section({ id, title, lede, children }: { id: string; title: string; lede: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="flex flex-col gap-6">
      <header className="flex max-w-[62ch] flex-col gap-2">
        <h2 id={`${id}-h`} className="text-[28px] leading-tight font-semibold tracking-[-0.025em] text-ink">
          {title}
        </h2>
        <p className="text-[15px] leading-relaxed text-ink-2">{lede}</p>
      </header>
      {children}
    </section>
  );
}

const Card = ({ className, children }: { className?: string; children: ReactNode }) => (
  <div className={cn('surface glass-1 p-5 sm:p-6', className)}>{children}</div>
);

const H3 = ({ children }: { children: ReactNode }) => <h3 className="mb-3 text-[16px] font-semibold text-ink">{children}</h3>;

function Swatch({ token, name, role, dark }: { token: string; name: string; role: string; dark?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        className={cn('size-11 shrink-0 rounded-[12px] ring-1 ring-[var(--hairline)]', dark && 'ring-[var(--edge-lit)]')}
        style={{ background: `var(${token})` }}
      />
      <div className="flex min-w-0 flex-col">
        <span className="text-[14px] font-medium text-ink">{name}</span>
        <span className="text-[13px] leading-snug text-ink-2">{role}</span>
      </div>
    </div>
  );
}

/* =============================================================================================
 * Page
 * =========================================================================================== */
export function DesignSystemPage() {
  const online = useOnline();
  const { resolved, setPreference } = useTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const togglePalette = useCallback(() => setPaletteOpen((o) => !o), []);
  useCommandShortcut(togglePalette);

  const [modal, setModal] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [drawer, setDrawer] = useState(false);

  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ block: 'start' });

  const openConfirmCancel = () => setConfirm(true);
  const doCancel = () => {
    setConfirming(true);
    setTimeout(() => {
      setConfirming(false);
      setConfirm(false);
      toast('Réservation RES-2043 annulée', {
        description: 'Le séjour du 23 au 27 nov. est libéré.',
        action: { label: 'Annuler', onClick: () => toast.success('Annulation retirée', { description: 'La réservation RES-2043 est de nouveau en attente.' }) },
      });
    }, 1100);
  };

  const entries: CommandEntry[] = [
    ...SECTIONS.map<CommandEntry>((s) => ({ id: `go-${s.id}`, label: s.label, group: 'Aller à une section', hint: 'Section', icon: <Sparkles aria-hidden />, keywords: [s.id], onSelect: () => jump(s.id) })),
    { id: 't-light', label: 'Thème clair', group: 'Apparence', icon: <Sun aria-hidden />, onSelect: () => setPreference('light') },
    { id: 't-dark', label: 'Thème sombre', group: 'Apparence', icon: <Moon aria-hidden />, onSelect: () => setPreference('dark') },
    { id: 't-system', label: 'Thème automatique', group: 'Apparence', hint: 'Suit votre appareil', icon: <Sparkles aria-hidden />, onSelect: () => setPreference('system') },
    { id: 'a-modal', label: 'Modifier les dates d\'un séjour', group: 'Actions', hint: 'Fenêtre', icon: <Pencil aria-hidden />, onSelect: () => setModal(true) },
    { id: 'a-toast', label: 'Afficher une notification', group: 'Actions', icon: <Info aria-hidden />, onSelect: () => toast.success('Notification affichée', { description: 'Elle disparaît seule après quelques secondes.' }) },
  ];

  return (
    <div className="min-h-dvh">
      <div className="ambient" aria-hidden />
      <a
        href="#main"
        className="sr-only-focusable fixed top-3 left-3 z-50 rounded-control bg-[var(--glass-data)] px-4 py-2 text-[14px] font-medium text-ink shadow-[var(--shadow-2)]"
      >
        Aller au contenu
      </a>

      <div className="sticky top-3 z-20 mx-auto max-w-[1200px] px-4">
        <header className="surface glass-1 flex min-h-16 items-center gap-3 px-4 [--surface-radius:var(--r-card)]">
          <BrandMark className="mr-auto" />
          <span className="hidden text-[14px] text-ink-2 md:inline">Système de design</span>
          <button
            type="button"
            onClick={togglePalette}
            className="flex h-10 cursor-pointer items-center gap-2.5 rounded-control border border-hairline bg-[var(--glass-data)] px-3 text-[14px] text-ink-3 transition-colors hover:border-field-border max-sm:w-10 max-sm:justify-center max-sm:px-0 sm:min-w-52"
          >
            <Search aria-hidden className="size-4" />
            <span className="flex-1 text-left max-sm:sr-only">Rechercher…</span>
            <kbd aria-hidden className="hidden rounded-md border border-hairline px-1.5 py-0.5 text-[12px] text-ink-3 sm:inline">⌘K</kbd>
          </button>
          <ThemeToggle />
        </header>
      </div>

      <main id="main" className="mx-auto flex max-w-[1200px] flex-col gap-20 px-4 pt-10 pb-28">
        {/* ------------------------------------------------------------------ Introduction */}
        <section aria-labelledby="intro-h" className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
          <div className="surface glass-1 flex flex-col justify-between gap-10 p-7 sm:p-10 [--surface-radius:var(--r-hero)]">
            <div className="flex flex-col gap-5">
              <h1 id="intro-h" className="text-balance text-[clamp(2.1rem,5.2vw,3.4rem)] leading-[1.04] font-semibold tracking-[-0.04em] text-ink">
                Le calme d'un hall d'hôtel, la précision d'un outil de travail.
              </h1>
              <p className="max-w-[56ch] text-[17px] leading-relaxed text-ink-2">
                Le verre structure l'interface ; les données, elles, restent sur des surfaces nettes. Chaque couleur est mesurée,
                chaque composant se commande au clavier, en clair comme en sombre.
              </p>
            </div>
            <ul className="grid gap-4 sm:grid-cols-3">
              {[
                ['Lisibilité d\'abord', 'Contrastes vérifiés par script, au pire endroit du fond.'],
                ['Une seule lumière', 'Champagne en haut à gauche, jour bleuté en bas à droite.'],
                ['Clair et sombre', 'Deux thèmes dessinés ensemble, pas un simple inversé.'],
              ].map(([t, d]) => (
                <li key={t} className="flex flex-col gap-1">
                  <span className="text-[15px] font-semibold text-ink">{t}</span>
                  <span className="text-[14px] leading-snug text-ink-2">{d}</span>
                </li>
              ))}
            </ul>
          </div>
          <nav aria-label="Sommaire" className="surface glass-1 flex flex-col gap-1 p-4 [--surface-radius:var(--r-hero)]">
            <p className="px-3 pt-2 pb-2 text-[14px] font-medium text-ink-2">Sommaire</p>
            {SECTIONS.map((s, i) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="group flex min-h-11 items-center justify-between rounded-[12px] px-3 text-[15px] font-medium text-ink transition-colors hover:bg-accent-soft"
              >
                {s.label}
                <span className="num-col text-[13px] text-ink-3">{i + 1}</span>
              </a>
            ))}
          </nav>
        </section>

        {/* ------------------------------------------------------------------ Couleurs et verre */}
        <Section
          id="couleurs"
          title="Couleurs et verre"
          lede="Une palette sobre : encre profonde, bleu électrique pour l'action, champagne pour le prestige, argent pour le neutre. Aucune couleur brute dans les composants, uniquement ces jetons."
        >
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card>
              <H3>Encre</H3>
              <div className="flex flex-col gap-4">
                <Swatch token="--ink" name="Principal" role="Titres, valeurs, texte courant" />
                <Swatch token="--ink-2" name="Secondaire" role="Descriptions, libellés" />
                <Swatch token="--ink-3" name="Discret" role="Aides, légendes (sur verre uniquement)" />
              </div>
            </Card>
            <Card>
              <H3>Accent</H3>
              <div className="flex flex-col gap-4">
                <Swatch token="--accent" name="Bleu électrique" role="Action principale, focus, jauge" />
                <Swatch token="--accent-hover" name="Survol" role="Bouton principal sous le pointeur" />
                <Swatch token="--accent-soft" name="Teinte douce" role="Sélection, survol de ligne" />
              </div>
            </Card>
            <Card>
              <H3>Champagne et argent</H3>
              <div className="flex flex-col gap-4">
                <Swatch token="--champagne" name="Champagne" role="Prestige : clients VIP, liseré lumineux" />
                <Swatch token="--champagne-soft" name="Champagne doux" role="Fond des badges VIP" />
                <Swatch token="--silver" name="Argent" role="Neutre, tendances, rails" />
              </div>
            </Card>
          </div>

          <Card>
            <H3>Statuts de réservation</H3>
            <p className="mb-4 max-w-[60ch] text-[14px] leading-snug text-ink-2">
              La couleur ne porte jamais seule le sens : chaque statut associe une icône et un libellé.
            </p>
            <div className="flex flex-wrap gap-2.5">
              {(['confirmed', 'pending', 'inhouse', 'departed', 'cancelled', 'noshow'] as const).map((s) => (
                <StatusBadge key={s} status={s} />
              ))}
              <VipBadge />
              <Badge tone="accent">Nouveau</Badge>
              <Badge>Brouillon</Badge>
            </div>
          </Card>

          <div>
            <H3>Quatre niveaux de verre</H3>
            <div className="relative isolate overflow-hidden rounded-hero border border-hairline bg-[var(--glass-hover)] p-5 sm:p-8">
              {/* Formes nettes derrière les surfaces : sans elles, le flou serait invisible. Chacune passe sous une surface. */}
              <div aria-hidden className="absolute inset-0 -z-10 hidden sm:block">
                <span className="absolute top-1/2 left-[9%] size-24 -translate-y-1/2 rounded-full bg-champagne" />
                <span className="absolute top-1/2 left-[34%] size-24 -translate-y-1/2 rounded-full bg-accent" />
                <span className="absolute top-1/2 left-[59%] size-24 -translate-y-1/2 rounded-full ring-[14px] ring-[var(--silver)]" />
                <span className="absolute top-1/2 left-[84%] size-20 -translate-y-1/2 rounded-full bg-accent" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ['glass-1', 'Niveau 1', 'Cartes, barre latérale, barre supérieure.'],
                  ['glass-2', 'Niveau 2', 'Menus, infobulles, notifications.'],
                  ['glass-3', 'Niveau 3', 'Fenêtres modales, palette de commandes.'],
                  ['glass-data', 'Données', 'Tableaux et graphiques : presque opaque.'],
                ].map(([cls, t, d]) => (
                  <div key={cls} className={cn('surface flex min-h-36 flex-col justify-end gap-1 p-5 [--surface-radius:var(--r-card)]', cls)}>
                    <span className="text-[15px] font-semibold text-ink">{t}</span>
                    <span className="text-[14px] leading-snug text-ink-2">{d}</span>
                  </div>
                ))}
              </div>
            </div>
            <p className="mt-3 max-w-[70ch] text-[14px] leading-snug text-ink-2">
              Les contrastes de chaque paire texte/fond sont mesurés par <code className="rounded bg-silver-soft px-1.5 py-0.5 text-[13px]">pnpm check:contrast</code>,
              dans le pire cas sous chaque halo, en clair et en sombre. Les couleurs des graphiques sont validées pour le daltonisme.
            </p>
          </div>
        </Section>

        {/* ------------------------------------------------------------------ Typographie */}
        <Section
          id="typographie"
          title="Typographie"
          lede="Inter, auto-hébergée, avec SF Pro sur les appareils Apple. Une échelle courte, des graisses qui hiérarchisent, des chiffres tabulaires seulement dans les colonnes."
        >
          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <Card className="flex flex-col gap-5">
              {[
                ['Titre de page', 'text-[28px] leading-tight font-semibold tracking-[-0.025em]', '28 / 600'],
                ['Titre de section', 'text-[20px] leading-snug font-semibold tracking-[-0.015em]', '20 / 600'],
                ['Titre de carte', 'text-[16px] leading-snug font-semibold', '16 / 600'],
                ['Texte courant pour les descriptions et les formulaires', 'text-[15px] leading-relaxed', '15 / 400'],
                ['Texte secondaire pour les aides et les détails', 'text-[14px] leading-snug text-ink-2', '14 / 400'],
                ['Légende et information discrète', 'text-[13px] leading-snug text-ink-3', '13 / 400'],
              ].map(([sample, cls, meta]) => (
                <div key={meta} className="grid items-baseline gap-1 sm:grid-cols-[1fr_5.5rem] sm:gap-4">
                  <span className={cn('text-ink', cls)}>{sample}</span>
                  <span className="num-col text-[13px] text-ink-3 sm:text-right">{meta}</span>
                </div>
              ))}
            </Card>
            <div className="flex flex-col gap-4">
              <Card>
                <H3>Chiffre héros</H3>
                <p className="num-display text-[56px] leading-none font-light text-ink">74 %</p>
                <p className="mt-2 text-[14px] leading-snug text-ink-2">Un seul par écran, chiffres proportionnels, graisse légère.</p>
              </Card>
              <Card>
                <H3>Colonnes de montants</H3>
                <dl className="flex flex-col gap-1.5 text-[14px]">
                  {[['Chambre 204', 360000], ['Petit-déjeuner', 24000], ['Taxe de séjour', 12000]].map(([k, v]) => (
                    <div key={k as string} className="flex justify-between gap-4 border-b border-hairline pb-1.5 last:border-0">
                      <dt className="text-ink-2">{k}</dt>
                      <dd className="num-col m-0 text-ink">{fmt.ar.format(v as number)}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
            </div>
          </div>
        </Section>

        {/* ------------------------------------------------------------------ Formes et mouvement */}
        <FormsAndMotion />

        {/* ------------------------------------------------------------------ Boutons */}
        <Buttons />

        {/* ------------------------------------------------------------------ Formulaires */}
        <FormsDemo />

        {/* ------------------------------------------------------------------ Données */}
        <DataDemo />

        {/* ------------------------------------------------------------------ États et notifications */}
        <Feedback online={online} />

        {/* ------------------------------------------------------------------ Fenêtres et menus */}
        <Section
          id="superpositions"
          title="Fenêtres et menus"
          lede="Le flou signale la mise à l'arrière-plan, jamais une décoration. Échap ferme, le focus est piégé puis restitué, et sur mobile les fenêtres deviennent des feuilles basculantes."
        >
          <Card className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={() => setModal(true)}>
              <Pencil aria-hidden className="size-4" />
              Modifier les dates
            </Button>
            <Button onClick={() => setDrawer(true)}>
              <BedDouble aria-hidden className="size-4" />
              Fiche de la chambre
            </Button>
            <Menu
              trigger={<Button>Actions sur la réservation</Button>}
              align="start"
              items={[
                { label: 'Modifier', icon: <Pencil />, onSelect: () => setModal(true) },
                { label: 'Dupliquer', icon: <Copy />, onSelect: () => toast.success('Réservation dupliquée', { description: 'Un brouillon RES-2049 est prêt (démonstration).' }) },
                { label: 'Annuler la réservation', icon: <Trash2 />, destructive: true, separated: true, onSelect: openConfirmCancel },
              ]}
            />
            <Tip label="Raccourci : ⌘K ou /">
              <Button variant="secondary" onClick={togglePalette}>
                <Search aria-hidden className="size-4" />
                Palette de commandes
              </Button>
            </Tip>
          </Card>
        </Section>

        {/* ------------------------------------------------------------------ Navigation */}
        <NavigationDemo togglePalette={togglePalette} online={online} />
      </main>

      <footer className="mx-auto max-w-[1200px] px-4 pb-14 text-[14px] text-ink-2">
        <p className="max-w-[70ch] leading-relaxed">
          Thème actuel : <strong className="font-medium text-ink">{resolved === 'dark' ? 'sombre' : 'clair'}</strong>. Raccourcis : ⌘K / Ctrl+K ou « / » ouvrent la palette de commandes.
          Les données de cette page sont des exemples : rien n'est enregistré.
        </p>
      </footer>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} entries={entries} />

      <Modal
        open={modal}
        onOpenChange={setModal}
        title="Modifier les dates du séjour"
        description="Réservation RES-2042 · Chambre 204. La disponibilité sera vérifiée avant l'enregistrement."
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(false)}>
              Annuler
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setModal(false);
                toast.success('Dates modifiées', { description: 'Le séjour est maintenant du 22 au 25 nov. (démonstration).' });
              }}
            >
              Enregistrer
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Arrivée" required>
            {(p) => <Input type="date" defaultValue="2026-11-22" {...p} />}
          </Field>
          <Field label="Départ" required hint="Au moins une nuit.">
            {(p) => <Input type="date" defaultValue="2026-11-25" {...p} />}
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Annuler la réservation RES-2043 ?"
        description="Andry Rakotoarisoa · Bungalow 2 · 23 au 27 nov. La chambre sera libérée immédiatement. Vous pourrez annuler cette action pendant quelques secondes."
        confirmLabel="Annuler la réservation"
        loading={confirming}
        onConfirm={doCancel}
      />

      <Drawer open={drawer} onOpenChange={setDrawer} title="Suite 301" description="Étage 3 · 2 adultes · 1 lit king size">
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status="inhouse" />
            <VipBadge />
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[14px]">
            {[['Tarif de la nuit', fmt.ar.format(450000)], ['Départ prévu', '25 nov.'], ['Ménage', 'Inspectée'], ['Solde dû', fmt.ar.format(0)]].map(([k, v]) => (
              <div key={k}>
                <dt className="text-ink-2">{k}</dt>
                <dd className="num-col m-0 font-medium text-ink">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap gap-2">
            {['Climatisation', 'Balcon', 'Baignoire', 'Wi-Fi'].map((a) => (
              <Badge key={a}>{a}</Badge>
            ))}
          </div>
        </div>
      </Drawer>
    </div>
  );
}

/* =============================================================================================
 * Formes et mouvement
 * =========================================================================================== */
function FormsAndMotion() {
  const [played, setPlayed] = useState(false);
  return (
    <Section
      id="formes"
      title="Formes et mouvement"
      lede="Les rayons suivent la taille de l'objet : un petit contrôle ne porte pas le rayon d'une carte. Chaque niveau d'élévation a sa propre ombre, teintée par la lumière ambiante."
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <H3>Rayons</H3>
          <div className="flex items-end gap-4">
            {[['10', 'Contrôles', 'rounded-[10px] size-12'], ['16', 'Petites cartes', 'rounded-[16px] size-14'], ['22', 'Cartes', 'rounded-[22px] size-16'], ['30', 'Héros', 'rounded-[30px] size-20']].map(([px, name, cls]) => (
              <div key={px} className="flex flex-col items-center gap-2 text-center">
                <span aria-hidden className={cn('border border-field-border bg-[var(--glass-data)]', cls)} />
                <span className="num-col text-[13px] font-medium text-ink">{px} px</span>
                <span className="text-[12.5px] leading-tight text-ink-2">{name}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <H3>Élévation</H3>
          <div className="flex gap-4">
            {[['1', 'shadow-1'], ['2', 'shadow-2'], ['3', 'shadow-3']].map(([n, cls]) => (
              <div key={n} className="flex flex-1 flex-col items-center gap-3 text-center">
                <span aria-hidden className={cn('h-14 w-full rounded-[14px] bg-[var(--glass-data)]', cls === 'shadow-1' ? 'shadow-1' : cls === 'shadow-2' ? 'shadow-2' : 'shadow-3')} />
                <span className="text-[13px] font-medium text-ink">Niveau {n}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <H3>Mouvement</H3>
          <div className="flex items-center gap-4">
            <div className="relative h-12 flex-1 rounded-control bg-silver-soft" aria-hidden>
              <span
                className="absolute top-1.5 left-1.5 size-9 rounded-[10px] bg-accent shadow-[var(--shadow-1)] transition-transform duration-[var(--d-slow)] ease-out"
                style={{ transform: played ? 'translateX(var(--travel, 8rem))' : 'translateX(0)' }}
              />
            </div>
            <Button size="sm" onClick={() => setPlayed((p) => !p)}>
              Rejouer
            </Button>
          </div>
          <p className="mt-3 text-[14px] leading-snug text-ink-2">
            140, 220 et 340 ms, courbe en ressort doux. Tout s'arrête si votre appareil demande de réduire les animations.
          </p>
        </Card>
      </div>
    </Section>
  );
}

/* =============================================================================================
 * Boutons
 * =========================================================================================== */
function Buttons() {
  const [saving, setSaving] = useState(false);
  const save = () => {
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      toast.success('Réservation confirmée', { description: 'Le client reçoit son récapitulatif (démonstration).' });
    }, 1400);
  };
  return (
    <Section
      id="actions"
      title="Boutons"
      lede="Une seule action principale par écran. Le rouge est réservé aux actions destructives. Pendant une opération, le bouton se désactive et l'état est annoncé."
    >
      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Card className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={save} loading={saving}>
              {saving ? 'Enregistrement…' : 'Confirmer la réservation'}
            </Button>
            <Button variant="secondary">Enregistrer en brouillon</Button>
            <Button variant="ghost">Annuler</Button>
            <Button variant="danger">Supprimer</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" size="sm">
              Petit
            </Button>
            <Button variant="primary" size="md">
              Moyen
            </Button>
            <Button variant="primary" size="lg">
              Grand
            </Button>
            <Button variant="primary" disabled>
              Indisponible
            </Button>
          </div>
        </Card>
        <Card className="flex flex-wrap items-center gap-3">
          <Tip label="Nouvelle réservation">
            <Button variant="primary" size="icon" aria-label="Nouvelle réservation" onClick={() => toast('Nouvelle réservation', { description: 'Le formulaire s\'ouvrira ici (module Réservations).' })}>
              <Plus aria-hidden className="size-[18px]" />
            </Button>
          </Tip>
          <Tip label="Rechercher">
            <Button size="icon" aria-label="Rechercher">
              <Search aria-hidden className="size-[18px]" />
            </Button>
          </Tip>
          <Tip label="Supprimer">
            <Button variant="ghost" size="icon" aria-label="Supprimer">
              <Trash2 aria-hidden className="size-[18px]" />
            </Button>
          </Tip>
          <p className="basis-full text-[14px] leading-snug text-ink-2">
            Un bouton qui n'affiche qu'une icône porte toujours un nom accessible et une infobulle.
          </p>
        </Card>
      </div>
    </Section>
  );
}

/* =============================================================================================
 * Formulaires
 * =========================================================================================== */
interface FormValues {
  name: string;
  email: string;
  category: string;
  arrival: string;
  departure: string;
  adults: string;
}
type FormErrors = Partial<Record<keyof FormValues, string>>;

function validate(v: FormValues): FormErrors {
  const e: FormErrors = {};
  if (!v.name.trim()) e.name = 'Indiquez le nom du client.';
  if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email)) e.email = 'Cette adresse e-mail semble incorrecte. Exemple : nom@exemple.com';
  if (!v.category) e.category = 'Choisissez une catégorie de chambre.';
  if (!v.arrival) e.arrival = "Indiquez la date d'arrivée.";
  if (!v.departure) e.departure = 'Indiquez la date de départ.';
  else if (v.arrival && v.departure <= v.arrival) e.departure = "Le départ doit être après l'arrivée (au moins une nuit).";
  const n = Number(v.adults);
  if (!Number.isInteger(n) || n < 1 || n > 8) e.adults = 'Entre 1 et 8 adultes.';
  return e;
}

function FormsDemo() {
  const [values, setValues] = useState<FormValues>({ name: '', email: '', category: '', arrival: '', departure: '', adults: '2' });
  const [touched, setTouched] = useState<Partial<Record<keyof FormValues, boolean>>>({});
  const [source, setSource] = useState('direct');
  const [deposit, setDeposit] = useState(true);
  const formRef = useRef<HTMLFormElement>(null);
  const errors = useMemo(() => validate(values), [values]);
  const show = (k: keyof FormValues) => (touched[k] ? errors[k] : undefined);

  const set = (k: keyof FormValues) => (v: string) => setValues((s) => ({ ...s, [k]: v }));
  const blur = (k: keyof FormValues) => () => setTouched((t) => ({ ...t, [k]: true }));

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    setTouched({ name: true, email: true, category: true, arrival: true, departure: true, adults: true });
    if (Object.keys(errors).length > 0) {
      // Après une erreur : le focus va au premier champ invalide
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    toast.success('Formulaire valide', { description: 'Démonstration : rien n\'est enregistré.' });
  };

  return (
    <Section
      id="formulaires"
      title="Formulaires"
      lede="Étiquette toujours visible, aide persistante sous le champ, erreur claire avec la façon de la corriger. La validation se fait quand on quitte le champ, pas à chaque frappe."
    >
      <Card className="max-w-3xl">
        <form ref={formRef} onSubmit={submit} noValidate className="flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <h3 className="text-[18px] font-semibold tracking-[-0.01em] text-ink">Nouvelle réservation</h3>
            <p className="text-[14px] leading-snug text-ink-2">Formulaire de démonstration : rien n'est enregistré.</p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Nom du client" required error={show('name')}>
              {(p) => <Input autoComplete="name" value={values.name} onChange={(e) => set('name')(e.target.value)} onBlur={blur('name')} placeholder="Prénom Nom" {...p} />}
            </Field>
            <Field label="E-mail" hint="Facultatif. Sert à envoyer la confirmation." error={show('email')}>
              {(p) => <Input type="email" autoComplete="email" value={values.email} onChange={(e) => set('email')(e.target.value)} onBlur={blur('email')} placeholder="nom@exemple.com" {...p} />}
            </Field>
            <Field label="Catégorie de chambre" required error={show('category')}>
              {(p) => (
                <Select
                  value={values.category}
                  onValueChange={(v) => {
                    set('category')(v);
                    blur('category')();
                  }}
                  placeholder="Choisir une catégorie"
                  options={[
                    { value: 'standard', label: 'Standard' },
                    { value: 'superieure', label: 'Supérieure' },
                    { value: 'suite', label: 'Suite' },
                    { value: 'bungalow', label: 'Bungalow' },
                  ]}
                  {...p}
                />
              )}
            </Field>
            <Field label="Adultes" required error={show('adults')}>
              {(p) => <Input type="number" inputMode="numeric" min={1} max={8} value={values.adults} onChange={(e) => set('adults')(e.target.value)} onBlur={blur('adults')} {...p} />}
            </Field>
            <Field label="Arrivée" required error={show('arrival')}>
              {(p) => <Input type="date" value={values.arrival} onChange={(e) => set('arrival')(e.target.value)} onBlur={blur('arrival')} {...p} />}
            </Field>
            <Field label="Départ" required error={show('departure')}>
              {(p) => <Input type="date" value={values.departure} onChange={(e) => set('departure')(e.target.value)} onBlur={blur('departure')} {...p} />}
            </Field>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-medium text-ink" id="source-label">
              Source de la réservation
            </span>
            <SegmentedControl
              label="Source de la réservation"
              value={source}
              onValueChange={setSource}
              className="self-start"
              options={[
                { value: 'direct', label: 'Direct' },
                { value: 'phone', label: 'Téléphone' },
                { value: 'web', label: 'Site web' },
              ]}
            />
          </div>

          <Field label="Demandes spéciales" hint="Allergies, arrivée tardive, lit bébé…">
            {(p) => <Textarea placeholder="Aucune demande particulière" {...p} />}
          </Field>

          <div className="flex flex-col gap-1">
            <Switch label="Demander un acompte" description="Le solde restant sera suivi sur la facture." checked={deposit} onCheckedChange={setDeposit} />
            <Checkbox label="Client VIP" />
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="ghost"
              onClick={() => {
                setValues({ name: '', email: '', category: '', arrival: '', departure: '', adults: '2' });
                setTouched({});
              }}
            >
              Effacer
            </Button>
            <Button type="submit" variant="primary">
              Enregistrer la réservation
            </Button>
          </div>
        </form>
      </Card>
    </Section>
  );
}

/* =============================================================================================
 * Données : tuiles, graphiques, tableau
 * =========================================================================================== */
function DataDemo() {
  const [period, setPeriod] = useState<Period>('12m');
  const { data, names } = useMemo(() => trendFor(period), [period]);
  const cur = sum(data, 'current');
  const prev = sum(data, 'previous');
  const delta = (cur / prev - 1) * 100;
  const scale = cur / 756e6;
  const categories = [
    { label: 'Standard', value: Math.round(62.4e6 * scale) },
    { label: 'Supérieure', value: Math.round(48.1e6 * scale) },
    { label: 'Suite', value: Math.round(38.7e6 * scale) },
    { label: 'Bungalow', value: Math.round(29.5e6 * scale) },
    { label: 'Villa', value: Math.round(22.3e6 * scale) },
  ];
  const periodLabel = { '7j': '7 derniers jours', '30j': '30 derniers jours', '12m': '12 derniers mois' }[period];

  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const rows = useMemo(() => RESERVATIONS.filter((r) => `${r.guest} ${r.ref} ${r.room}`.toLowerCase().includes(query.trim().toLowerCase())), [query]);
  const simulate = () => {
    setLoading(true);
    setTimeout(() => setLoading(false), 1300);
  };

  const columns: Column<Reservation>[] = [
    { key: 'ref', header: 'Référence', cell: (r) => <span className="num-col text-ink-2">{r.ref}</span>, sortValue: (r) => r.ref },
    {
      key: 'guest',
      header: 'Client',
      sortValue: (r) => r.guest,
      cell: (r) => (
        <span className="flex items-center gap-2">
          <span className="font-medium text-ink">{r.guest}</span>
          {r.vip && <VipBadge />}
        </span>
      ),
    },
    { key: 'room', header: 'Chambre', cell: (r) => <span className="text-ink-2">{r.room}</span> },
    { key: 'stay', header: 'Séjour', cell: (r) => <span className="text-ink-2">{stay(r)}</span>, sortValue: (r) => r.from },
    { key: 'status', header: 'Statut', cell: (r) => <StatusBadge status={r.status} /> },
    { key: 'due', header: 'Solde dû', align: 'right', sortValue: (r) => r.due, cell: (r) => (r.due === 0 ? <span className="text-ink-3">—</span> : fmt.ar.format(r.due)) },
  ];

  return (
    <Section
      id="donnees"
      title="Données et graphiques"
      lede="Les données restent sur des surfaces quasi opaques. Un seul chiffre héros par écran, des courbes fines, une vue tableau pour chaque graphique, et un filtre unique placé au-dessus des graphiques."
    >
      {/* Filtre unique, au-dessus des graphiques */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[14px] font-medium text-ink">Période</span>
        <SegmentedControl<Period>
          label="Période des graphiques"
          value={period}
          onValueChange={setPeriod}
          options={[
            { value: '7j', label: '7 jours' },
            { value: '30j', label: '30 jours' },
            { value: '12m', label: '12 mois' },
          ]}
        />
      </div>

      {/* Tuiles : hiérarchie réelle (un héros, deux tuiles, une tuile large) */}
      <div className="grid gap-4 lg:grid-cols-4">
        <div className="surface glass-1 flex flex-col justify-between gap-6 p-6 sm:p-7 lg:col-span-2 lg:row-span-2 [--surface-radius:var(--r-hero)]">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-3">
              <span className="text-[15px] text-ink-2">Taux d'occupation aujourd'hui</span>
              <span className="num-display text-[56px] leading-none font-light text-ink">74 %</span>
              <span className="text-[14px] leading-snug text-ink-2">31 chambres occupées sur 42</span>
            </div>
            <Ring value={74} size={124} label="Taux d'occupation : 74 %">
              <BedDouble aria-hidden className="size-7 text-accent-ink" strokeWidth={1.6} />
            </Ring>
          </div>
          <dl className="grid grid-cols-3 divide-x divide-[var(--hairline)] text-center">
            {[['Arrivées', '8'], ['Départs', '5'], ['Disponibles', '11']].map(([k, v]) => (
              <div key={k} className="flex flex-col gap-0.5 px-2">
                <dd className="num-display m-0 text-[24px] leading-tight font-semibold text-ink">{v}</dd>
                <dt className="text-[13px] text-ink-2">{k}</dt>
              </div>
            ))}
          </dl>
        </div>
        <StatTile label="Chiffre d'affaires" value={`${fmt.compact.format(cur)} Ar`} delta={delta} deltaLabel={`vs ${period === '12m' ? 'année précédente' : 'période précédente'}`} trend={data.slice(-12).map((p) => p.current)} className="lg:col-span-1" />
        <StatTile label="Arrivées du jour" value="8" delta={14.3} deltaLabel="vs hier" trend={[4, 6, 5, 7, 6, 5, 8, 7, 6, 9, 7, 8]} className="lg:col-span-1" />
        <StatTile label="Paiements en attente" value={fmt.ar.format(2520000)} delta={-8.5} deltaLabel="vs semaine dernière" upIsGood={false} trend={[3, 3.4, 3.1, 3.6, 3.3, 3.1, 2.9, 3, 2.8, 2.7, 2.6, 2.5]} className="lg:col-span-2" />
      </div>

      {/* Graphiques */}
      <div className="grid gap-4 lg:grid-cols-[1.7fr_1fr]">
        <ChartFigure
          title="Évolution du chiffre d'affaires"
          summary={`${periodLabel} : ${fmt.compact.format(cur)} Ar, ${delta >= 0 ? '+' : '−'}${fmt.pct1.format(Math.abs(delta))} % par rapport à la période précédente.`}
          legend={<Legend items={[{ label: names[0] === 'Actuel' ? 'Période actuelle' : names[0], color: 'var(--series-1)' }, { label: names[1] === 'Préc.' ? 'Période précédente' : names[1], color: 'var(--series-2)' }]} />}
          table={{ columns: ['Période', names[0], names[1]], rows: data.map((p) => [p.label, fmt.ar.format(p.current), fmt.ar.format(p.previous)]) }}
        >
          <TrendChart data={data} names={names} />
        </ChartFigure>
        <div className="flex flex-col gap-4">
          <ChartFigure
            title="Revenus par catégorie"
            summary={`Standard en tête avec ${fmt.pct1.format((categories[0]!.value / categories.reduce((s, c) => s + c.value, 0)) * 100)} % du total.`}
            table={{ columns: ['Catégorie', 'Revenu'], rows: categories.map((c) => [c.label, fmt.ar.format(c.value)]) }}
          >
            <BarList rows={categories} format={(v) => `${fmt.compact.format(v)} Ar`} />
          </ChartFigure>
          <ChartFigure
            title="Sources des réservations"
            summary="Les réservations directes représentent près de la moitié des séjours."
            table={{ columns: ['Source', 'Réservations'], rows: [['Direct', 46], ['Site web', 24], ['Téléphone', 18], ['Agences', 12]] }}
          >
            <SegmentedBar
              label="Sources des réservations"
              parts={[
                { label: 'Direct', value: 46, color: 'var(--series-1)' },
                { label: 'Site web', value: 24, color: 'var(--series-2)' },
                { label: 'Téléphone', value: 18, color: 'var(--series-3)' },
                { label: 'Agences', value: 12, color: 'var(--series-4)' },
              ]}
            />
          </ChartFigure>
        </div>
      </div>

      {/* Tableau */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h3 className="text-[18px] font-semibold tracking-[-0.01em] text-ink">Réservations récentes</h3>
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-64 max-w-full">
              <label htmlFor="q" className="sr-only">
                Rechercher une réservation
              </label>
              <Input id="q" type="search" leading={<Search className="size-4" />} placeholder="Client ou référence" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <Button size="md" onClick={simulate}>
              Simuler un premier chargement
            </Button>
          </div>
        </div>
        <DataTable
          caption="Réservations récentes"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.ref}
          loading={loading}
          empty={
            <EmptyState
              kind="search"
              title="Aucune réservation ne correspond"
              description={`Rien ne correspond à « ${query} ». Vérifiez l'orthographe ou cherchez par référence.`}
              action={<Button onClick={() => setQuery('')}>Effacer la recherche</Button>}
            />
          }
          mobileCard={(r) => (
            <div className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-3">
                <span className="flex flex-col">
                  <span className="flex items-center gap-2 font-medium text-ink">
                    {r.guest}
                    {r.vip && <VipBadge />}
                  </span>
                  <span className="text-[13px] text-ink-2">
                    <span className="num-col">{r.ref}</span> · {r.room}
                  </span>
                </span>
                <StatusBadge status={r.status} />
              </div>
              <div className="flex items-center justify-between text-[14px]">
                <span className="text-ink-2">{stay(r)}</span>
                <span className="num-col font-medium text-ink">{r.due === 0 ? '—' : fmt.ar.format(r.due)}</span>
              </div>
            </div>
          )}
        />
      </div>
    </Section>
  );
}

/* =============================================================================================
 * États et notifications
 * =========================================================================================== */
function Feedback({ online }: { online: boolean }) {
  return (
    <Section
      id="retours"
      title="États et notifications"
      lede="Chargement, vide, erreur, réussite : chaque état dit où l'on en est et quoi faire ensuite. Les erreurs ne s'excusent pas et ne restent jamais vagues."
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <H3>Chargement</H3>
          <div className="flex flex-col gap-3" role="status" aria-label="Chargement des réservations">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <div className="mt-2 flex gap-2">
              <Skeleton className="h-8 w-24 rounded-full" />
              <Skeleton className="h-8 w-20 rounded-full" />
            </div>
          </div>
        </Card>
        <Card className="lg:col-span-2">
          <H3>Notifications</H3>
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => toast.success('Paiement enregistré', { description: '180 000 Ar reçus en espèces sur RES-2042.' })}>Réussite</Button>
            <Button
              onClick={() =>
                toast.error('Paiement non enregistré', {
                  description: 'La référence Mobile Money est déjà utilisée. Vérifiez le numéro de transaction.',
                })
              }
            >
              Erreur
            </Button>
            <Button
              onClick={() =>
                toast('Chambre 204 déplacée', {
                  description: 'De 204 vers 206, pour le même séjour.',
                  action: { label: 'Annuler', onClick: () => toast.success('Déplacement annulé') },
                })
              }
            >
              Avec annulation
            </Button>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <span className="text-[14px] text-ink-2">Connexion :</span>
            <ConnectionIndicator online />
            <ConnectionIndicator online={false} />
            <span className="text-[13px] text-ink-3">
              État réel de votre navigateur : <strong className="font-medium text-ink-2">{online ? 'en ligne' : 'hors ligne'}</strong>
            </span>
          </div>
        </Card>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="surface glass-1 [--surface-radius:var(--r-card)]">
          <EmptyState kind="calendar" title="Aucune arrivée aujourd'hui" description="Les prochaines arrivées apparaîtront ici dès qu'une réservation sera confirmée." action={<Button variant="primary">Nouvelle réservation</Button>} />
        </div>
        <div className="surface glass-1 [--surface-radius:var(--r-card)]">
          <EmptyState kind="key" title="Aucune chambre à nettoyer" description="Toutes les chambres sont prêtes. Les départs du jour s'afficheront ici." />
        </div>
        <div className="surface glass-1 [--surface-radius:var(--r-card)]">
          <EmptyState kind="search" title="Aucun client trouvé" description="Essayez le nom de famille, le téléphone ou l'adresse e-mail." action={<Button>Voir tous les clients</Button>} />
        </div>
      </div>
    </Section>
  );
}

/* =============================================================================================
 * Navigation : aperçus interactifs
 * =========================================================================================== */
function NavigationDemo({ togglePalette, online }: { togglePalette: () => void; online: boolean }) {
  const [active, setActive] = useState('overview');
  const [collapsed, setCollapsed] = useState(false);
  const title = ALL_NAV.find((n) => n.id === active)?.label ?? '';
  const preview = (id: string) => {
    setActive(id);
  };
  const MockContent = () => (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-6 w-1/2" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-4/5" />
      <p className="pt-2 text-[13px] text-ink-3">Aperçu : le contenu du module « {title} » arrive avec les phases suivantes.</p>
    </div>
  );
  const accountItems = [
    { label: 'Mon profil', onSelect: () => toast('Mon profil', { description: 'Aperçu : cette page arrive avec l\'authentification.' }) },
    { label: 'Se déconnecter', destructive: true, separated: true, onSelect: () => toast('Déconnexion', { description: 'Aperçu : aucune session n\'est ouverte.' }) },
  ];
  const notifItems = [
    { label: 'Paiement reçu · RES-2042', onSelect: () => toast.success('Paiement reçu', { description: 'Aperçu de notification.' }) },
    { label: 'Chambre 112 prête', onSelect: () => toast('Chambre 112 prête') },
  ];

  return (
    <Section
      id="navigation"
      title="Navigation"
      lede="Sur grand écran, une barre latérale repliable ; sur mobile, une barre d'onglets de cinq entrées au plus, le reste dans « Plus ». L'état actif est visible partout, et tout se commande au clavier."
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_19.5rem]">
        <div className="hidden flex-col gap-3 lg:flex">
          <H3>Bureau</H3>
          <div className="relative flex h-[34rem] gap-3 overflow-hidden rounded-hero border border-hairline bg-[var(--glass-hover)] p-3">
            <Sidebar active={active} onNavigate={preview} collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <Topbar title={title} online={online} onOpenPalette={togglePalette} notifications={notifItems} account={accountItems} />
              <div className="surface glass-data flex-1 overflow-auto p-6 [--surface-radius:var(--r-card)]">
                <MockContent />
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <H3>Mobile</H3>
          <div className="relative mx-auto h-[34rem] w-[19.5rem] max-w-full overflow-hidden rounded-[2.4rem] border border-hairline bg-[var(--glass-hover)] p-3">
            <div className="flex h-full flex-col gap-3 pb-20">
              <Topbar title={title} online={online} onOpenPalette={togglePalette} notifications={notifItems} account={accountItems} className="min-h-14 px-3" />
              <div className="surface glass-data flex-1 overflow-auto p-4 [--surface-radius:var(--r-card)]">
                <MockContent />
              </div>
            </div>
            <TabBar active={active} onNavigate={preview} className="!absolute inset-x-3 bottom-3" />
          </div>
        </div>
      </div>

      <Card>
        <H3>Onglets</H3>
        <Tabs
          label="Détails de la réservation"
          tabs={[
            { value: 'resume', label: 'Résumé', content: <p className="text-[14px] leading-relaxed text-ink-2">Séjour du 22 au 24 nov. · Chambre 204 · 2 adultes. Les flèches gauche et droite changent d'onglet.</p> },
            { value: 'paiements', label: 'Paiements', content: <p className="text-[14px] leading-relaxed text-ink-2">Acompte de 180 000 Ar reçu en espèces. Solde dû : 180 000 Ar.</p> },
            { value: 'historique', label: 'Historique', content: <p className="text-[14px] leading-relaxed text-ink-2">Créée par la réception le 18 nov. à 14:32. Aucune modification depuis.</p> },
          ]}
        />
      </Card>
    </Section>
  );
}
