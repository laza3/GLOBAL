import {
  ArrowDown,
  CircleCheck,
  Info,
  TriangleAlert,
  ArrowUp,
  ArrowUpDown,
  BedDouble,
  CalendarCheck,
  CircleX,
  Clock3,
  Crown,
  LogOut,
  UserX,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { cn } from '../lib/cn';

/* ---------------------------------------------------------------------------------------------
 * Badges de statut : TOUJOURS icône + libellé (la couleur ne porte jamais seule le sens).
 * ------------------------------------------------------------------------------------------- */
export type ReservationStatus = 'confirmed' | 'pending' | 'inhouse' | 'departed' | 'cancelled' | 'noshow';

const STATUS: Record<ReservationStatus, { label: string; icon: LucideIcon }> = {
  confirmed: { label: 'Confirmée', icon: CalendarCheck },
  pending: { label: 'En attente', icon: Clock3 },
  inhouse: { label: 'En séjour', icon: BedDouble },
  departed: { label: 'Parti', icon: LogOut },
  cancelled: { label: 'Annulée', icon: CircleX },
  noshow: { label: 'Absent', icon: UserX },
};

export const STATUS_LABELS: Record<ReservationStatus, string> = Object.fromEntries(
  Object.entries(STATUS).map(([k, v]) => [k, v.label]),
) as Record<ReservationStatus, string>;

const badgeBase = 'inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-medium whitespace-nowrap';

export function StatusBadge({ status, className }: { status: ReservationStatus; className?: string }) {
  const { label, icon: Icon } = STATUS[status];
  return (
    <span
      className={cn(badgeBase, className)}
      style={{ color: `var(--st-${status})`, background: `var(--st-${status}-soft)` }}
    >
      <Icon aria-hidden className="size-3.5" />
      {label}
    </span>
  );
}

export function Badge({
  tone = 'neutral',
  icon,
  children,
  className,
}: {
  tone?: 'neutral' | 'accent' | 'champagne';
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        badgeBase,
        tone === 'neutral' && 'bg-silver-soft text-ink-2',
        tone === 'accent' && 'bg-accent-soft text-accent-ink',
        tone === 'champagne' && 'bg-champagne-soft text-champagne-ink',
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

/** État générique (facture, paiement, abonnement, ticket) : toujours icône + libellé, couleur = ton sémantique. */
const TONES = {
  success: { icon: CircleCheck, token: 'inhouse' },
  warning: { icon: TriangleAlert, token: 'pending' },
  danger: { icon: CircleX, token: 'cancelled' },
  info: { icon: Info, token: 'confirmed' },
  neutral: { icon: Clock3, token: 'departed' },
} as const;

export function StateBadge({ tone, children, className }: { tone: keyof typeof TONES; children: ReactNode; className?: string }) {
  const { icon: Icon, token } = TONES[tone];
  return (
    <span className={cn(badgeBase, className)} style={{ color: `var(--st-${token})`, background: `var(--st-${token}-soft)` }}>
      <Icon aria-hidden className="size-3.5" />
      {children}
    </span>
  );
}

export const VipBadge = () => (
  <Badge tone="champagne" icon={<Crown aria-hidden className="size-3.5" />}>
    VIP
  </Badge>
);

/* ---------------------------------------------------------------------------------------------
 * Squelettes : annoncés comme « chargement » ; jamais de flash lors d'un simple rafraîchissement.
 * ------------------------------------------------------------------------------------------- */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('skeleton h-4 rounded-md', className)} />;
}

/* ---------------------------------------------------------------------------------------------
 * États vides : une invitation à agir, pas une impasse. Illustrations au trait, même langage graphique.
 * ------------------------------------------------------------------------------------------- */
function Illustration({ kind }: { kind: 'calendar' | 'search' | 'key' }) {
  const stroke = { stroke: 'var(--ink-3)', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' } as const;
  const gold = { stroke: 'var(--champagne)', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' } as const;
  return (
    <svg aria-hidden viewBox="0 0 120 96" className="h-24 w-[7.5rem]">
      <ellipse cx="60" cy="86" rx="38" ry="5" fill="var(--silver-soft)" />
      {kind === 'calendar' && (
        <>
          <rect x="26" y="22" width="68" height="58" rx="12" {...stroke} fill="var(--glass-data)" />
          <path d="M26 40h68" {...stroke} />
          <path d="M46 16v12M74 16v12" {...stroke} />
          <path d="M40 54h8M56 54h8M72 54h8M40 66h8M56 66h8" {...stroke} />
          <circle cx="90" cy="70" r="14" {...gold} fill="var(--glass-data)" />
          <path d="M90 63v14M83 70h14" {...gold} />
        </>
      )}
      {kind === 'search' && (
        <>
          <circle cx="54" cy="44" r="22" {...stroke} fill="var(--glass-data)" />
          <path d="M70 60l18 18" {...gold} strokeWidth={3} />
          <path d="M44 40h20M46 50h14" {...stroke} />
        </>
      )}
      {kind === 'key' && (
        <>
          <rect x="30" y="30" width="46" height="40" rx="14" {...stroke} fill="var(--glass-data)" />
          <circle cx="45" cy="50" r="6" {...gold} />
          <path d="M76 44h18l6 8-6 8H76" {...stroke} />
          <path d="M88 52h4" {...gold} />
        </>
      )}
    </svg>
  );
}

export function EmptyState({
  kind = 'calendar',
  title,
  description,
  action,
  className,
}: {
  kind?: 'calendar' | 'search' | 'key';
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center gap-3 px-6 py-12 text-center', className)}>
      <Illustration kind={kind} />
      <div className="flex max-w-sm flex-col gap-1">
        <p className="text-[16px] font-semibold text-ink">{title}</p>
        <p className="text-[14px] leading-snug text-ink-2">{description}</p>
      </div>
      {action}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Tableau de données : surface quasi opaque, en-têtes triables (aria-sort), chiffres tabulaires,
 * chargement par squelette, état vide. Sur mobile : liste de cartes (pas un tableau rétréci).
 * ------------------------------------------------------------------------------------------- */
export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number;
  align?: 'left' | 'right';
  className?: string;
}

type Direction = 'asc' | 'desc';

export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  loading,
  empty,
  mobileCard,
  skeletonRows = 5,
}: {
  caption: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  empty?: ReactNode;
  mobileCard?: (row: T) => ReactNode;
  skeletonRows?: number;
}) {
  const [sort, setSort] = useState<{ key: string; dir: Direction } | null>(null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const get = col.sortValue;
    return [...rows].sort((a, b) => {
      const [x, y] = [get(a), get(b)];
      const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'fr');
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sort, columns]);

  const toggle = (key: string) =>
    setSort((s) => (s?.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : null));

  const isEmpty = !loading && sorted.length === 0;

  return (
    <div className="surface glass-data overflow-hidden [--surface-radius:var(--r-card)]">
      {/* Mobile : cartes */}
      {mobileCard && (
        <ul className="divide-y divide-[var(--hairline)] md:hidden" aria-label={caption} aria-busy={loading || undefined}>
          {loading &&
            Array.from({ length: Math.min(skeletonRows, 3) }, (_, i) => (
              <li key={i} className="flex flex-col gap-2 p-4" aria-hidden>
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3.5 w-1/2" />
              </li>
            ))}
          {!loading && sorted.map((row) => <li key={rowKey(row)} className="p-4">{mobileCard(row)}</li>)}
          {isEmpty && <li>{empty}</li>}
        </ul>
      )}

      {/* Zone défilante : atteignable au clavier (sinon un tableau large est inaccessible sans souris) */}
      <div tabIndex={0} role="region" aria-label={caption} className={cn('overflow-x-auto', mobileCard && 'hidden md:block')}>
        <table className="w-full min-w-[40rem] border-collapse text-[14px]" aria-busy={loading || undefined}>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-hairline">
              {columns.map((c) => {
                const active = sort?.key === c.key;
                const ariaSort = active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : c.sortValue ? 'none' : undefined;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={ariaSort}
                    className={cn('px-4 py-3 text-[13px] font-medium text-ink-2', c.align === 'right' ? 'text-right' : 'text-left')}
                  >
                    {c.sortValue ? (
                      <button
                        type="button"
                        onClick={() => toggle(c.key)}
                        className={cn(
                          'inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-md px-1 -mx-1 hover:text-ink',
                          active && 'text-ink',
                          c.align === 'right' && 'flex-row-reverse',
                        )}
                      >
                        {c.header}
                        {active ? (
                          sort!.dir === 'asc' ? <ArrowUp aria-hidden className="size-3.5" /> : <ArrowDown aria-hidden className="size-3.5" />
                        ) : (
                          <ArrowUpDown aria-hidden className="size-3.5 opacity-60" />
                        )}
                        <span className="sr-only">{active ? `, trié ${sort!.dir === 'asc' ? 'croissant' : 'décroissant'}` : ', trier'}</span>
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: skeletonRows }, (_, i) => (
                <tr key={i} aria-hidden className="border-b border-hairline last:border-0">
                  {columns.map((c) => (
                    <td key={c.key} className="px-4 py-3.5">
                      <Skeleton className={cn('h-4', c.align === 'right' ? 'ml-auto w-20' : 'w-3/4')} />
                    </td>
                  ))}
                </tr>
              ))}
            {!loading &&
              sorted.map((row) => (
                <tr key={rowKey(row)} className="border-b border-hairline transition-colors last:border-0 hover:bg-accent-soft">
                  {columns.map((c) => (
                    <td key={c.key} className={cn('px-4 py-3', c.align === 'right' && 'num-col text-right', c.className)}>
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
            {isEmpty && (
              <tr>
                <td colSpan={columns.length}>{empty}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {loading && <p className="sr-only" role="status">Chargement en cours</p>}
    </div>
  );
}
